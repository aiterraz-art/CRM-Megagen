const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ksrlrqrqjqknobqdumzq.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
    console.error('Missing VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTable() {
    console.log('Checking table "inventory"...');
    try {
        const { data, error } = await supabase
            .from('inventory')
            .select('*')
            .limit(1);

        if (error) {
            console.error('Error fetching inventory:', error.message);
            if (error.code === 'PGRST116' || error.message.includes('not found')) {
                console.log('Table "inventory" seems to be missing.');
            }
        } else {
            console.log('Table "inventory" exists. Data count:', data.length);
        }

        // List all tables we CAN see
        console.log('\nChecking all visible tables...');
        const { data: tables, error: tableError } = await supabase
            .rpc('get_tables'); // This might not exist, fallback to a known table

        if (tableError) {
            console.log('RPC get_tables failed (expected if not defined).');
        }

        // Try a known table to verify connection
        const { data: clients, error: clientError } = await supabase
            .from('clients')
            .select('id')
            .limit(1);

        if (clientError) {
            console.error('Error fetching clients:', clientError.message);
        } else {
            console.log('Successfully connected and queried "clients" table.');
        }

    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

checkTable();
