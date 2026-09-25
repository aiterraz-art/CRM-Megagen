-- Add created_at column if it does not exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Optional: If you want to confirm columns, this is just for your info, no action needed by script
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders';
