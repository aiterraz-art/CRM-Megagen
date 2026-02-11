import { supabase } from '../services/supabase';

const Login = () => {
    const handleGoogleLogin = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/`,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'select_account',
                },
                scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send'
            }
        });

        if (error) {
            console.error('Error al iniciar sesión con Google:', error.message);
        }
    };

    return (
        <div className="flex min-h-screen bg-side-gradient items-center justify-center p-6 sm:p-12 overflow-hidden relative">
            {/* Background Accents (Glassmorphism blobs) */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/10 rounded-full blur-3xl animate-pulse"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-400/20 rounded-full blur-3xl"></div>

            <div className="w-full max-w-lg bg-white/95 backdrop-blur-xl rounded-[3rem] shadow-2xl p-10 md:p-16 space-y-10 relative z-10 animate-in fade-in zoom-in duration-700">
                <div className="flex justify-center mb-8">
                    <div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center p-4 animate-in zoom-in duration-500">
                        <img src="/logo_megagen.png" alt="Megagen Logo" className="w-full h-full object-contain" />
                    </div>
                </div>

                <div className="text-center space-y-2 mb-8">
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">CRM Megagen</h1>
                    <p className="text-gray-500 font-medium">Plataforma de Gestión Comercial</p>
                </div>

                <div className="space-y-4">
                    <button
                        onClick={handleGoogleLogin}
                        className="w-full flex items-center justify-center space-x-4 bg-white border border-gray-100 py-5 px-8 rounded-[2rem] font-bold text-gray-700 hover:bg-gray-50 transition-all active:scale-95 shadow-sm hover:shadow-xl hover:shadow-indigo-50 border-gray-100"
                    >
                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
                        <span className="text-lg">Inicio de Sesión</span>
                    </button>

                    <p className="text-[10px] text-center text-gray-300 font-bold uppercase tracking-[0.2em]">
                        Endpoint Security Active
                    </p>
                </div>

                <div className="pt-8 border-t border-gray-50">
                    <div className="flex justify-center space-x-6 text-[10px] font-black text-gray-300 uppercase tracking-widest">
                        <span className="hover:text-dental-400 cursor-pointer">Support</span>
                        <span>•</span>
                        <span className="hover:text-dental-400 cursor-pointer">Security</span>
                        <span>•</span>
                        <span className="hover:text-dental-400 cursor-pointer">Privacy</span>
                    </div>
                </div>
            </div>
            <div className="absolute bottom-6 text-center w-full z-10 opacity-70">
                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">
                    Diseñado y ejecutado por Alfredo Terraza
                </p>
            </div>
        </div>
    );
};

export default Login;
