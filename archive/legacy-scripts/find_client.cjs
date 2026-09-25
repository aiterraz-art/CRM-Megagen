const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ksrlrqrqjqknobqdumzq.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listClients() {
    console.log('--- LISTING CLIENTS ---');
    // Using simple select without order to avoid error
    const { data: clients, error } = await supabase
        .from('clients')
        .select('*')
        .limit(20);

    if (error) {
        console.error('Error listing clients:', error);
    } else {
        console.log('First client keys:', Object.keys(clients[0] || {}));
        console.log('Clients found:');
        clients.forEach(c => {
            console.log(`- [${c.id}] ${c.name} | Comuna: ${c.comuna} | Zone: ${c.zone}`);
        });
    }
}

listClients();
