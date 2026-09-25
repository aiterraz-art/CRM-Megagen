const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Manually parse .env
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

if (!supabaseKey) {
    console.error('Missing VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateClient() {
    console.log('Searching for "dental alfredo"...');

    // List all clients to check visibility and names
    const { data: clients, error: findError } = await supabase
        .from('clients')
        .select('id, name, comua, zone') // Intentionally typo comua -> comuna? No, be careful.
        .select('id, name, comuna, zone')
        .limit(20);

    if (findError) {
        console.error('Error listing clients:', findError);
        return;
    }

    console.log('Available clients:', clients.map(c => ({ name: c.name, comuna: c.comuna, zone: c.zone })));

    // Try finding close match
    const target = clients.find(c => c.name.toLowerCase().includes('alfredo'));
    if (target) {
        console.log('Found match in list:', target.name);
        // Update the found match
        const { data: updated, error: updateError } = await supabase
            .from('clients')
            .update({ comuna: 'San Miguel' })
            .eq('id', target.id)
            .select();

        if (updateError) {
            console.error('Error updating client:', updateError);
        } else {
            console.log('SUCCESS: Client updated.', updated);
        }
    } else {
        console.log('No client matching "alfredo" found in the first 20 records.');
    }
}

updateClient();
