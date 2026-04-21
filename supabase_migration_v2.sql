-- ============================================================
-- Blood Buddy: Intelligent Blood Request Matching System
-- Add these tables and alter inventory table for the matching engine
-- ============================================================

-- 1. Modify inventory table to include expiry date
-- By default, it will just start tracking NULL for old ones, new updates can set it.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- 2. Create blood_requests table
CREATE TABLE IF NOT EXISTS blood_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    blood_group TEXT NOT NULL,
    units_required INTEGER NOT NULL,
    priority_level TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create request_matches table
CREATE TABLE IF NOT EXISTS request_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES blood_requests(id) ON DELETE CASCADE,
    supplier_hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    match_type INTEGER NOT NULL,
    expiry_days INTEGER,
    distance_km NUMERIC,
    available_units INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Set generic public policies
ALTER TABLE blood_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all blood_requests" ON blood_requests FOR ALL USING (true);

ALTER TABLE request_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all request_matches" ON request_matches FOR ALL USING (true);
