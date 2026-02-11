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

async function fixData() {
    console.log('--- FIXING DATA ---');

    // 1. Fix "Dentista San Miguel" Comuna
    console.log('Searching for "Dentista San Miguel"...');
    const { data: clients, error: searchError } = await supabase
        .from('clients')
        .select('id, name, comuna')
        .ilike('name', '%Dentista San Miguel%');

    if (searchError) {
        console.error('Error searching client:', searchError);
    } else if (clients.length > 0) {
        const client = clients[0];
        console.log('Found client:', client);
        if (client.comuna !== 'San Miguel') {
            const { error: updateError } = await supabase
                .from('clients')
                .update({ comuna: 'San Miguel' })
                .eq('id', client.id);

            if (updateError) console.error('Error updating client:', updateError);
            else console.log('SUCCESS: Updated client comuna to San Miguel');
        } else {
            console.log('Client already has correct comuna.');
        }
    } else {
        console.log('Client "Dentista San Miguel" NOT FOUND.');
    }

    // 2. Fix Admin Profile Name
    const adminEmail = 'aterraza@3dental.cl';
    console.log(`Updating profile for ${adminEmail}...`);

    // First get the ID
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', adminEmail)
        .single();

    if (profiles) {
        const { error: profileError } = await supabase
            .from('profiles')
            .update({ full_name: 'aterraza' })
            .eq('id', profiles.id);

        if (profileError) console.error('Error updating profile:', profileError);
        else console.log('SUCCESS: Updated admin profile name to "aterraza"');
    } else {
        console.log('Admin profile not found.');
    }
}

fixData();
