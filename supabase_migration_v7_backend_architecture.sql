-- Migrate the hospital coordination dashboard to a strict backend architectural framework.
-- Requires all allocations, requests, and logic gating to occur exclusively across these PLPGSQL endpoints.

-- 1. Create wrapper function for form submission
DROP FUNCTION IF EXISTS public.create_request_and_match(UUID, TEXT, INT, TEXT);
CREATE OR REPLACE FUNCTION public.create_request_and_match(
    p_hospital_id UUID,
    p_blood_group TEXT,
    p_units INT,
    p_priority TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_req_id UUID;
BEGIN
    -- Insert into blood_requests
    INSERT INTO public.blood_requests (
        hospital_id,
        blood_group,
        units_required,
        priority_level,
        status
    )
    VALUES (
        p_hospital_id,
        p_blood_group,
        p_units,
        COALESCE(p_priority, 'Normal'),
        'PENDING'
    )
    RETURNING id INTO new_req_id;

    -- Trigger matchmaking engine immediately
    PERFORM public.rpc_match_and_allocate_blood(new_req_id);

    RETURN new_req_id;
END;
$$;


-- 2. Modify Matching Engine strictly matching exact frontend specs
DROP FUNCTION IF EXISTS public.rpc_match_and_allocate_blood(UUID);
CREATE OR REPLACE FUNCTION public.rpc_match_and_allocate_blood(req_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
    v_req RECORD;
    v_remaining_units INTEGER;
    v_allocated_total INTEGER := 0;
    v_batch RECORD;
    v_allocation_id UUID;
    v_results JSONB := '[]'::JSONB;
    v_current_radius INTEGER;
    v_sender_lat NUMERIC;
    v_sender_lon NUMERIC;
BEGIN
    SELECT * INTO v_req FROM blood_requests WHERE id = req_id FOR UPDATE;
    
    IF v_req IS NULL OR v_req.status IN ('FULFILLED', 'TIMEOUT', 'CANCELLED') THEN
        RETURN jsonb_build_object('error', 'Request not viable for matching.');
    END IF;

    SELECT COALESCE(SUM(units_allocated), 0) INTO v_allocated_total 
    FROM request_allocations 
    WHERE request_id = req_id AND status NOT IN ('CANCELLED', 'REJECTED');
    
    v_remaining_units := v_req.units_required - v_allocated_total;

    IF v_remaining_units <= 0 THEN
        UPDATE blood_requests SET status = 'FULFILLED' WHERE id = req_id;
        RETURN jsonb_build_object('status', 'Already Fulfilled');
    END IF;

    SELECT latitude, longitude INTO v_sender_lat, v_sender_lon 
    FROM hospitals WHERE id = v_req.hospital_id;
    
    v_current_radius := COALESCE(v_req.search_radius, 40);

    -- Expand Search Radius
    WHILE v_current_radius <= 200 AND v_remaining_units > 0 LOOP
        FOR v_batch IN 
            SELECT ib.id as batch_id, ib.hospital_id, ib.blood_group, h.latitude, h.longitude,
                   -- Strict computation rule:
                   (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) as available_units,
                   calc_distance_km(v_sender_lat, v_sender_lon, h.latitude, h.longitude) as dist
            FROM inventory_batches ib
            JOIN hospitals h ON ib.hospital_id = h.id
            WHERE ib.hospital_id != v_req.hospital_id
              AND ib.is_recalled = false
              AND ib.expiry_date >= CURRENT_DATE
              -- STRICT RULE: ONLY include > 0 surplus
              AND (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) > 0
              AND (
                   ib.blood_group = v_req.blood_group 
                   OR (v_req.priority_level = 'Emergency' AND ib.blood_group = 'O-') 
                   OR (v_req.blood_group LIKE '%+' AND ib.blood_group = REPLACE(v_req.blood_group, '+', '-'))
              )
              AND calc_distance_km(v_sender_lat, v_sender_lon, h.latitude, h.longitude) <= v_current_radius
            -- EXACT RANKING OUTLINED: highest surplus -> earliest expiry -> best response (here implied via distance)
            ORDER BY available_units DESC, ib.expiry_date ASC, dist ASC
            FOR UPDATE SKIP LOCKED
        LOOP
            IF v_remaining_units <= 0 THEN EXIT; END IF;

            DECLARE
                v_take INTEGER;
                v_available INTEGER := v_batch.available_units;
            BEGIN
                -- Distribute cleanly
                IF v_available > v_remaining_units THEN v_take := v_remaining_units;
                ELSE v_take := v_available; END IF;

                INSERT INTO request_allocations (
                    request_id, supplier_hospital_id, batch_id, blood_group, units_allocated, status
                ) VALUES (
                    req_id, v_batch.hospital_id, v_batch.batch_id, v_batch.blood_group, v_take, 'PENDING'
                ) RETURNING id INTO v_allocation_id;

                v_results := v_results || jsonb_build_object(
                    'allocation_id', v_allocation_id,
                    'supplier_id', v_batch.hospital_id,
                    'batch_id', v_batch.batch_id,
                    'units_allocated', v_take
                );

                v_remaining_units := v_remaining_units - v_take;
                v_allocated_total := v_allocated_total + v_take;
            END;
        END LOOP;

        IF v_remaining_units > 0 THEN
            v_current_radius := v_current_radius + 40;
            UPDATE blood_requests SET search_radius = v_current_radius WHERE id = req_id;
        ELSE EXIT; END IF;
    END LOOP;
    
    IF v_remaining_units <= 0 THEN UPDATE blood_requests SET status = 'FULFILLED' WHERE id = req_id;
    ELSIF v_allocated_total > 0 THEN UPDATE blood_requests SET status = 'PARTIAL' WHERE id = req_id;
    END IF;

    RETURN jsonb_build_object(
        'request_id', req_id,
        'allocated', v_allocated_total,
        'remaining', v_remaining_units,
        'details', v_results
    );
END;
$function$;


-- 3. Accept Logic Flow 
CREATE OR REPLACE FUNCTION public.rpc_accept_allocation(p_allocation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_alloc RECORD;
    v_req RECORD;
    v_transfer_id UUID;
BEGIN
    -- Validate Allocation
    SELECT * INTO v_alloc FROM request_allocations WHERE id = p_allocation_id FOR UPDATE;
    IF v_alloc IS NULL OR v_alloc.status != 'PENDING' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Allocation is not pending.');
    END IF;

    -- Fetch receiver info
    SELECT * INTO v_req FROM blood_requests WHERE id = v_alloc.request_id;
    
    -- Update Status
    UPDATE request_allocations SET status = 'ACCEPTED' WHERE id = p_allocation_id;

    -- Insert IN_TRANSIT transfer
    INSERT INTO blood_transfers (
        sender_id, receiver_id, request_id, allocation_id, batch_id, blood_group, units, status
    ) VALUES (
        v_alloc.supplier_hospital_id, v_req.hospital_id, v_alloc.request_id, p_allocation_id, 
        v_alloc.batch_id, v_alloc.blood_group, v_alloc.units_allocated, 'IN_TRANSIT'
    ) RETURNING id INTO v_transfer_id;

    -- Explicitly increment reserved_units
    UPDATE inventory_batches 
    SET reserved_units = COALESCE(reserved_units, 0) + v_alloc.units_allocated 
    WHERE id = v_alloc.batch_id;

    RETURN jsonb_build_object('success', true, 'transfer_id', v_transfer_id);
END;
$$;


-- 4. Reject Logic Flow
CREATE OR REPLACE FUNCTION public.rpc_reject_allocation(p_allocation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_alloc RECORD;
BEGIN
    SELECT * INTO v_alloc FROM request_allocations WHERE id = p_allocation_id FOR UPDATE;
    IF v_alloc IS NULL OR v_alloc.status != 'PENDING' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Allocation is not pending.');
    END IF;

    UPDATE request_allocations SET status = 'REJECTED' WHERE id = p_allocation_id;
    
    RETURN jsonb_build_object('success', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
