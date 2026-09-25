
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ksrlrqrqjqknobqdumzq.supabase.co'
const supabaseKey = 'sb_publishable_Tqm5NhWzsQF_XLo7pwlTwg_v7jCO08i'

const supabase = createClient(supabaseUrl, supabaseKey)

async function verifyData() {
    const danielaId = '11111111-1111-1111-1111-111111111111';
    console.log('Searching data for Daniela:', danielaId);

    try {
        // 1. Check Quotations
        const { data: quotations, error: qError } = await supabase
            .from('quotations')
            .select('*')
            .eq('seller_id', danielaId);

        if (qError) console.error('Error fetching quotations:', qError.message);
        else console.log(`Found ${quotations.length} quotations for Daniela.`);

        // 2. Check Locations
        const { data: locations, error: lError } = await supabase
            .from('seller_locations')
            .select('*')
            .eq('seller_id', danielaId);

        if (lError) console.error('Error fetching locations:', lError.message);
        else console.log(`Found ${locations.length} locations for Daniela.`);

        // 3. Try Insert
        console.log('Attempting manual insertion into seller_locations...');
        const { data: insData, error: insError } = await supabase
            .from('seller_locations')
            .insert({
                seller_id: danielaId,
                lat: -33.4489,
                lng: -70.6693,
                created_at: new Date().toISOString()
            });

        if (insError) {
            console.error('INSERT ERROR in seller_locations:', insError);
            console.error('Code:', insError.code);
            console.error('Message:', insError.message);
            console.error('Details:', insError.details);
        } else {
            console.log('Insert success!', insData);
        }

    } catch (err) {
        console.error('Unexpected error:', err)
    }
}

verifyData()
