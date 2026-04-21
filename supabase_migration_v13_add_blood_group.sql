-- Migration V13: Add blood_group column to request_allocations if missing
-- This ensures the column exists for legacy compatibility.

ALTER TABLE IF EXISTS public.request_allocations
    ADD COLUMN IF NOT EXISTS blood_group TEXT NOT NULL DEFAULT 'UNKNOWN';

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
