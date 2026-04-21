-- Migration V14: Ensure supplier_id column exists on request_allocations
-- This fixes the missing column error in the PostgREST schema cache.

ALTER TABLE IF EXISTS public.request_allocations
    ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES hospitals(id) ON DELETE CASCADE;

-- Force PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
