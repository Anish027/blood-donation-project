-- Ensure min_reserve_units exists on hospitals table
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS min_reserve_units INTEGER DEFAULT 10;

-- Ensure reserved_units exists on inventory_batches to lock supplies
ALTER TABLE public.inventory_batches ADD COLUMN IF NOT EXISTS reserved_units INTEGER DEFAULT 0;

-- Add batch_id to request_allocations so the Accept flow knows WHICH batch to increment
ALTER TABLE public.request_allocations ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES inventory_batches(id);

-- Drop previous matching engine if exists
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
    -- 1. Load Request Context
    SELECT * INTO v_req FROM blood_requests WHERE id = req_id FOR UPDATE;
    
    IF v_req IS NULL OR v_req.status IN ('FULFILLED', 'TIMEOUT', 'CANCELLED') THEN
        RETURN jsonb_build_object('error', 'Request not viable for engine matching.');
    END IF;

    -- Look up previously fulfilled allocations for this request
    SELECT COALESCE(SUM(units_allocated), 0) INTO v_allocated_total 
    FROM request_allocations 
    WHERE request_id = req_id AND status != 'CANCELLED';
    
    v_remaining_units := v_req.units_required - v_allocated_total;

    IF v_remaining_units <= 0 THEN
        UPDATE blood_requests SET status = 'FULFILLED' WHERE id = req_id;
        RETURN jsonb_build_object('status', 'Already Fulfilled');
    END IF;

    -- Look up location
    SELECT latitude, longitude INTO v_sender_lat, v_sender_lon 
    FROM hospitals WHERE id = v_req.hospital_id;
    
    v_current_radius := COALESCE(v_req.search_radius, 40);

    -- 2. Expand Search Radius Algorithm (Sender-Centric Focus)
    WHILE v_current_radius <= 200 AND v_remaining_units > 0 LOOP
        
        FOR v_batch IN 
            SELECT ib.id as batch_id, ib.hospital_id, ib.units, COALESCE(ib.reserved_units, 0) as reserved_units, ib.blood_group, h.latitude, h.longitude,
                   -- SENDER CENTRIC MATHEMATICS
                   (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) as available_units,
                   CASE 
                     WHEN ib.blood_group = v_req.blood_group THEN 1
                     WHEN ib.blood_group = 'O-' THEN 3
                     ELSE 2 
                   END as match_type,
                   calc_distance_km(v_sender_lat, v_sender_lon, h.latitude, h.longitude) as dist
            FROM inventory_batches ib
            JOIN hospitals h ON ib.hospital_id = h.id
            WHERE ib.hospital_id != v_req.hospital_id
              AND ib.is_recalled = false
              AND ib.expiry_date >= CURRENT_DATE
              -- STRICT RULE: Must have surplus above reservations AND hospital safety minimums
              AND (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) > 0
              AND (
                   ib.blood_group = v_req.blood_group 
                   OR (v_req.priority_level = 'Emergency' AND ib.blood_group = 'O-') 
                   OR (v_req.blood_group LIKE '%+' AND ib.blood_group = REPLACE(v_req.blood_group, '+', '-'))
              )
              AND calc_distance_km(v_sender_lat, v_sender_lon, h.latitude, h.longitude) <= v_current_radius
            -- RANK SENDER-OPTIMAL FIRST: highest available surplus -> nearest expiry -> closest dist
            ORDER BY match_type ASC, available_units DESC, ib.expiry_date ASC, dist ASC
            FOR UPDATE SKIP LOCKED
        LOOP
            IF v_remaining_units <= 0 THEN
                EXIT;
            END IF;

            DECLARE
                v_take INTEGER;
                v_available INTEGER := v_batch.available_units;
            BEGIN
                -- Prevent overallocation
                IF v_available > v_remaining_units THEN
                    v_take := v_remaining_units;
                ELSE
                    v_take := v_available;
                END IF;

                -- Insert Allocation Record strictly mapping batch_id for tracking
                INSERT INTO request_allocations (request_id, supplier_hospital_id, batch_id, blood_group, units_allocated, status)
                VALUES (req_id, v_batch.hospital_id, v_batch.batch_id, v_batch.blood_group, v_take, 'PENDING')
                RETURNING id INTO v_allocation_id;

                v_results := v_results || jsonb_build_object(
                    'allocation_id', v_allocation_id,
                    'supplier_id', v_batch.hospital_id,
                    'batch_id', v_batch.batch_id,
                    'blood_group', v_batch.blood_group,
                    'units_allocated', v_take,
                    'available_units_evaluated', v_batch.available_units,
                    'distance_km', round(v_batch.dist::numeric, 2)
                );

                v_remaining_units := v_remaining_units - v_take;
                v_allocated_total := v_allocated_total + v_take;
            END;
        END LOOP;

        IF v_remaining_units > 0 THEN
            v_current_radius := v_current_radius + 40;
            UPDATE blood_requests SET search_radius = v_current_radius WHERE id = req_id;
        ELSE
            EXIT;
        END IF;

    END LOOP;
    
    -- Finalize Request Status
    IF v_remaining_units <= 0 THEN
       UPDATE blood_requests SET status = 'FULFILLED' WHERE id = req_id;
    ELSIF v_allocated_total > 0 THEN
       UPDATE blood_requests SET status = 'PARTIAL' WHERE id = req_id;
    END IF;

    RETURN jsonb_build_object(
        'request_id', req_id,
        'requested', v_req.units_required,
        'allocated', v_allocated_total,
        'remaining', v_remaining_units,
        'details', v_results
    );
END;
$function$;

-- Reload schema explicitly
NOTIFY pgrst, 'reload schema';
