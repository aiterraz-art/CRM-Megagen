
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ksrlrqrqjqknobqdumzq.supabase.co'
const supabaseKey = 'sb_publishable_Tqm5NhWzsQF_XLo7pwlTwg_v7jCO08i'

const supabase = createClient(supabaseUrl, supabaseKey)

async function diagnostic() {
    console.log('Final verification of profiles and quotations...')
    try {
        const { data: profiles } = await supabase.from('profiles').select('id, email').in('id', ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'])
        console.log('Mock profiles in DB:', profiles)

        const { data: quotations } = await supabase.from('quotations').select('id, folio, seller_id').order('created_at', { ascending: false }).limit(5)
        console.log('Recent quotations:', quotations)
    } catch (err) {
        console.error('Unexpected error:', err)
    }
}

diagnostic()
