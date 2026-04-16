-- ============================================================
-- Blood Buddy: Hospital Registration with License Verification
-- Run this ENTIRE script in your Supabase SQL Editor
-- ============================================================

-- 1. Add new data columns to hospitals table
--    (These are for the new registration fields only.
--     The `verified` boolean column already exists and is NOT modified.)
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS contact_number TEXT;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS license_number TEXT;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS license_doc_url TEXT;

-- 2. Create storage bucket for license documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('license-docs', 'license-docs', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Allow anyone to upload to the license-docs bucket (for registration)
CREATE POLICY "Allow public uploads to license-docs"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'license-docs');

-- 4. Allow anyone to read from the license-docs bucket (for admin review)
CREATE POLICY "Allow public reads from license-docs"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'license-docs');

-- ============================================================
-- DONE. The existing `verified` boolean column is used as-is:
--   verified = false → Pending approval
--   verified = true  → Approved (full access)
--
-- Verify by running:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'hospitals';
-- ============================================================
