-- FIX: Prevent Matcher engine from crashing against NULL geolocations during prototyping.
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
                   (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) as available_units,
                   calc_distance_km(
                       COALESCE(v_sender_lat, 0), 
                       COALESCE(v_sender_lon, 0), 
                       COALESCE(h.latitude, 0), 
                       COALESCE(h.longitude, 0)
                   ) as dist
            FROM inventory_batches ib
            JOIN hospitals h ON ib.hospital_id = h.id
            WHERE ib.hospital_id != v_req.hospital_id
              AND ib.is_recalled = false
              AND ib.expiry_date >= CURRENT_DATE
              AND (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) > 0
              AND (
                   ib.blood_group = v_req.blood_group 
                   OR (v_req.priority_level = 'Emergency' AND ib.blood_group = 'O-') 
                   OR (v_req.blood_group LIKE '%+' AND ib.blood_group = REPLACE(v_req.blood_group, '+', '-'))
              )
              -- BYPASS: If geols are totally empty, universally allow matching. Otherwise, enforce radius.
              AND (
                  v_sender_lat IS NULL 
                  OR h.latitude IS NULL 
                  OR calc_distance_km(v_sender_lat, v_sender_lon, h.latitude, h.longitude) <= v_current_radius
              )
            ORDER BY available_units DESC, ib.expiry_date ASC, dist ASC
            FOR UPDATE SKIP LOCKED
        LOOP
            IF v_remaining_units <= 0 THEN EXIT; END IF;

            DECLARE
                v_take INTEGER;
                v_available INTEGER := v_batch.available_units;
            BEGIN
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

NOTIFY pgrst, 'reload schema';
