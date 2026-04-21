-- Migration V12: Database Architectural Scrubbing
-- As requested, this file formally ablates the match computing logic from the Supabase environment, permanently relegating it to the Node Application structure.

DROP FUNCTION IF EXISTS public.rpc_match_and_allocate_blood(UUID);
DROP FUNCTION IF EXISTS public.create_request_and_match(UUID, TEXT, INT, TEXT);

-- Retaining the basic 'ACCEPT' and 'REJECT' flow handlers here for data-integrity transaction safety, 
-- or they can be shifted to Node in future iterations. 
-- The core requirement focused on 'Remove old logic inside rpc_match_and_allocate_blood'.

NOTIFY pgrst, 'reload schema';
