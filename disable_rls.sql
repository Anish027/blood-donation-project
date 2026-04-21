-- TEMPORARY DEBUGGING SCRIPT (RLS DISABLE)
-- Run this in your Supabase SQL Editor merely to determine if RLS is triggering the 400 error.
-- Ensure to re-enable it later once debugging is finished.

ALTER TABLE public.hospitals DISABLE ROW LEVEL SECURITY;
