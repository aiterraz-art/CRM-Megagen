const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env');
const env = {};
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            env[key.trim()] = value.trim();
        }
    });
}

const supabaseUrl = env.VITE_SUPABASE_URL;

if (!supabaseUrl) {
    console.error('ERROR: VITE_SUPABASE_URL not found in .env');
    process.exit(1);
}

let dbHost = '';
try {
    const url = new URL(supabaseUrl);
    dbHost = url.hostname;
} catch (e) {
    console.error('Invalid Supabase URL:', supabaseUrl);
    process.exit(1);
}

const dbPassword = env.SUPABASE_DB_PASSWORD;
if (!dbPassword) {
    console.error('ERROR: SUPABASE_DB_PASSWORD not found in .env');
    process.exit(1);
}

const client = new Client({
    user: 'postgres',
    host: dbHost,
    database: 'postgres',
    password: dbPassword,
    port: 5432,
    ssl: false
});

async function applyFixes() {
    try {
        console.log(`Connecting to ${dbHost}:5432...`);
        await client.connect();
        console.log('Connected!');

        console.log('Applying: check_client_ownership Function...');
        await client.query(`
            CREATE OR REPLACE FUNCTION check_client_ownership(check_rut text)
            RETURNS TABLE (owner_name text) 
            LANGUAGE plpgsql 
            SECURITY DEFINER
            AS $$
            BEGIN
            RETURN QUERY
            SELECT p.full_name
            FROM clients c
            JOIN profiles p ON c.created_by = p.id
            WHERE c.rut = check_rut;
            END;
            $$;
        `);

        console.log('Applying: Missing Columns (giro, comuna)...');
        await client.query(`
            ALTER TABLE public.clients 
            ADD COLUMN IF NOT EXISTS giro text,
            ADD COLUMN IF NOT EXISTS comuna text;
        `);

        console.log('Applying: Missing Geo Columns (lat, lng)...');
        await client.query(`
            ALTER TABLE public.clients 
            ADD COLUMN IF NOT EXISTS lat float8,
            ADD COLUMN IF NOT EXISTS lng float8;
        `);

        console.log('SUCCESS: ALL FIXES APPLIED.');
    } catch (err) {
        console.error('DATABASE ERROR:', err);
    } finally {
        await client.end();
    }
}

applyFixes();
