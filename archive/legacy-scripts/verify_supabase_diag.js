
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ksrlrqrqjqknobqdumzq.supabase.co'
const supabaseKey = 'sb_publishable_Tqm5NhWzsQF_XLo7pwlTwg_v7jCO08i'

const supabase = createClient(supabaseUrl, supabaseKey)

async function diagnostic() {
    console.log('Inspecting profiles table columns...')
    try {
        const { data, error } = await supabase.from('profiles').select('*').limit(1)
        if (error) {
            console.error('Error fetching profile:', error.message)
        } else if (data && data.length > 0) {
            console.log('Columns found in profiles:', Object.keys(data[0]))
        } else {
            console.log('No profiles found to inspect.')
        }
    } catch (err) {
        console.error('Unexpected error:', err)
    }
}

diagnostic()
