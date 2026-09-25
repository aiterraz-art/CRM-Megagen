-- Add quotation_id column to orders table if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES quotations(id);

-- Optional: Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_quotation_id ON orders(quotation_id);
