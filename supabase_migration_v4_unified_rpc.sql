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
    -- 1. Insert into blood_requests
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

    -- 2. Call existing rpc_match_and_allocate_blood cleanly
    PERFORM public.rpc_match_and_allocate_blood(new_req_id);

    -- 3. Return the generated request_id
    RETURN new_req_id;
END;
$$;
