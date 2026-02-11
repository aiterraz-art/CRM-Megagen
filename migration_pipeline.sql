-- Add stage column to quotations table
ALTER TABLE quotations 
ADD COLUMN IF NOT EXISTS stage text DEFAULT 'new';

-- Create an index for performance
CREATE INDEX IF NOT EXISTS idx_quotations_stage ON quotations(stage);

-- Optional: If we want strict stage names, we can add a check constraint
-- ALTER TABLE quotations ADD CONSTRAINT check_stage CHECK (stage IN ('new', 'negotiation', 'won', 'lost'));
-- For now, we'll keep it flexible or handle it in the UI/App logic.

-- Update existing quotations to 'new' (already handled by DEFAULT, but good to be explicit for non-nulls)
UPDATE quotations SET stage = 'new' WHERE stage IS NULL;
