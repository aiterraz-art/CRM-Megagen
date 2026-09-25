-- 1. Add coordinates columns to visits table
ALTER TABLE visits 
ADD COLUMN IF NOT EXISTS check_out_lat float8,
ADD COLUMN IF NOT EXISTS check_out_lng float8;

-- 2. Create visit_photos table
CREATE TABLE IF NOT EXISTS visit_photos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    visit_id UUID REFERENCES visits(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL, -- Will store Base64 string as requested for now
    category TEXT DEFAULT 'fachada',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    taken_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    latitude float8,
    longitude float8
);

-- 3. Enable RLS
ALTER TABLE visit_photos ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies for visit_photos
-- Allow users to see only photos from visits they created
CREATE POLICY "Users can view photos of their own visits" ON visit_photos
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM visits 
            WHERE visits.id = visit_photos.visit_id 
            AND visits.sales_rep_id = auth.uid()
        )
    );

-- Allow admins to see all photos
CREATE POLICY "Admins can view all photos" ON visit_photos
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() 
            AND profiles.role = 'admin'
        )
    );

-- Allow users to insert photos for their own active visits
CREATE POLICY "Users can insert photos for their own visits" ON visit_photos
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM visits 
            WHERE visits.id = visit_photos.visit_id 
            AND visits.sales_rep_id = auth.uid()
        )
    );

-- Allow users to delete their own photos
CREATE POLICY "Users can delete their own photos" ON visit_photos
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM visits 
            WHERE visits.id = visit_photos.visit_id 
            AND visits.sales_rep_id = auth.uid()
        )
    );
