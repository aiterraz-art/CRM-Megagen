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
const dbPassword = env.SUPABASE_DB_PASSWORD;

if (!supabaseUrl || !dbPassword) {
    console.error('Missing env vars');
    process.exit(1);
}

const dbHost = new URL(supabaseUrl).hostname;

const client = new Client({
    user: 'postgres',
    host: dbHost,
    database: 'postgres',
    password: dbPassword,
    port: 5432,
    ssl: false
});

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'clients'");
        console.log(JSON.stringify(res.rows, null, 2));

        console.log('\n--- SAMPLE DATA (1 row) ---');
        const data = await client.query("SELECT * FROM clients LIMIT 1");
        console.log(data.rows[0]);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

check();
