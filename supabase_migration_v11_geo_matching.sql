-- Migration V11: Complete Geo-Based Distance Redesign
-- Implements the primary requested Haversine trigonometric distance tracking algorithm
-- Drops explicit Search Radius WHILE loops and relies on physical global sorting limited to Top 10 returns.

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
    v_req_lat NUMERIC;
    v_req_lon NUMERIC;
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

    -- Fetch exact latitude and longitude mapped parameters
    SELECT latitude, longitude INTO v_req_lat, v_req_lon 
    FROM hospitals WHERE id = v_req.hospital_id;

    -- Complete core rewrite executing Haversine mathematics per specification
    FOR v_batch IN 
        SELECT ib.id as batch_id, ib.hospital_id, ib.blood_group, 
               (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) as available_units,
               
               -- Trigonometric Distance parsing wrapping GREATEST/LEAST to avert fatal math errors on floating points.
               (6371 * acos(
                   LEAST(1.0, GREATEST(-1.0,
                       cos(radians(COALESCE(v_req_lat, 0))) * cos(radians(COALESCE(h.latitude, 0))) *
                       cos(radians(COALESCE(h.longitude, 0) - COALESCE(v_req_lon, 0))) +
                       sin(radians(COALESCE(v_req_lat, 0))) * sin(radians(COALESCE(h.latitude, 0)))
                   ))
               )) as distance

        FROM inventory_batches ib
        JOIN hospitals h ON ib.hospital_id = h.id
        WHERE ib.hospital_id != v_req.hospital_id
          AND ib.is_recalled = false
          AND (ib.units - COALESCE(ib.reserved_units, 0) - COALESCE(h.min_reserve_units, 0)) > 0
          AND (
               ib.blood_group = v_req.blood_group 
               OR (v_req.priority_level = 'Emergency' AND ib.blood_group = 'O-') 
               OR (v_req.blood_group LIKE '%+' AND ib.blood_group = REPLACE(v_req.blood_group, '+', '-'))
          )
        -- Order logic strictly mapped:
        -- Distance mapping globally (Primary)
        -- Highest inventory retention (Secondary)
        ORDER BY distance ASC, available_units DESC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
    LOOP
        IF v_remaining_units <= 0 THEN EXIT; END IF;

        DECLARE
            v_take INTEGER;
            v_available INTEGER := v_batch.available_units;
        BEGIN
            -- Min(available_units, remaining_needed_units) specification explicitly implemented
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
                'distance_calculated', v_batch.distance
            );

            v_remaining_units := v_remaining_units - v_take;
            v_allocated_total := v_allocated_total + v_take;
        END;
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
