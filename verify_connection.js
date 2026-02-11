import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.VITE_SUPABASE_URL || 'http://crm-megagen.100.66.33.103.sslip.io';
const key = process.env.VITE_SUPABASE_ANON_KEY;

if(!key) {
    console.error("Falta la anon key");
    process.exit(1);
}

const supabase = createClient(url, key);

async function check() {
    console.log(`Conectando a ${url}...`);
    try {
        // Intenta obtener un perfil publico o fallar auth, solo queremos ver si llega al server
        // Usamos una funcion RPC o tabla que exista. 'profiles' suele ser estandar.
        // Si falla con 401 es buena señal de red, mala señal de auth.
        // Si falla con ECONNREFUSED es mala señal de red.
        const { data, error } = await supabase.from('profiles').select('count', { count: 'exact', head: true });
        
        if (error) {
            console.log('Respuesta del servidor (posible error lógico, pero hay conexión):', error.message);
            // Si el error es de conexión, lo dirá explicitamente
            if (error.message.includes('fetch') || error.message.includes('network')) {
                console.error('❌ FALLO DE RED');
            } else {
                console.log('✅ CONEXIÓN EXITOSA (El servidor respondió)');
            }
        } else {
            console.log('✅ CONEXIÓN EXITOSA Y DATOS RECIBIDOS');
        }
    } catch (e) {
        console.error('Excepción:', e);
    }
}

check();
