-- Drop the existing constraint
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_user_id_fkey;

-- Re-add the constraint with ON DELETE CASCADE
ALTER TABLE goals
    ADD CONSTRAINT goals_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES profiles(id)
    ON DELETE CASCADE;
