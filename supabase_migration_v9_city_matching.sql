-- Replace Complex Geolocation Coordinates with Simple City-Based Matching
-- 1. Drops the WHILE expansion radius.
-- 2. Sorts purely by (Same City -> Highest Surplus -> Earliest Expiry).

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
    v_sender_city TEXT;
BEGIN
    -- 1. Lock the request
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

    -- 2. Pull Requester's City Data (Replaces lat/long)
    SELECT city INTO v_sender_city 
    FROM hospitals WHERE id = v_req.hospital_id;
    
    -- 3. Run a Single Native Scan Loop
    FOR v_batch IN 
        SELECT ib.id as batch_id, ib.hospital_id, ib.blood_group, h.city,
               (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) as available_units,
               -- Virtual 'Distance': 0 for same city, 1 for different city
               (CASE WHEN LOWER(TRIM(h.city)) = LOWER(TRIM(v_sender_city)) THEN 0 ELSE 1 END) as city_distance
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
        -- RANKING TIERS: 
        -- Tier 1: Same City Matches First (city_distance = 0)
        -- Tier 2: Highest Surplus amount
        -- Tier 3: Earliest Expiry Date (Reduce waste)
        ORDER BY city_distance ASC, available_units DESC, ib.expiry_date ASC
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
                'units_allocated', v_take,
                'supplier_city', v_batch.city
            );

            v_remaining_units := v_remaining_units - v_take;
            v_allocated_total := v_allocated_total + v_take;
        END;
    END LOOP;
    
    -- 4. Status Resolutions
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

NOTIFY pgrst, 'reload schema';
