import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { GOOGLE_SIGN_IN_UNAVAILABLE_MESSAGE, startGoogleSignIn } from '../services/googleService';

const Login = () => {
    const [signingIn, setSigningIn] = useState(false);
    const [signInFailed, setSignInFailed] = useState(false);

    // Coming back from Google via the back button restores this page from the bfcache
    // with the spinner still on; reset it so the button is usable again.
    useEffect(() => {
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) setSigningIn(false);
        };
        window.addEventListener('pageshow', onPageShow);
        return () => window.removeEventListener('pageshow', onPageShow);
    }, []);

    const handleGoogleLogin = async () => {
        if (signingIn) return;
        setSigningIn(true);
        setSignInFailed(false);
        // Force frontend callback target (prevents falling back to Supabase host root)
        const authRedirectUrl = (import.meta.env.VITE_AUTH_REDIRECT_URL || `${window.location.origin}/`).trim();
        const { ok } = await startGoogleSignIn(authRedirectUrl);
        // On success the browser is already navigating to Google; keep the spinner.
        if (!ok) {
            setSignInFailed(true);
            setSigningIn(false);
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
                        <img src={import.meta.env.VITE_COMPANY_LOGO || "/logo_megagen.png"} alt={import.meta.env.VITE_COMPANY_NAME || "Megagen"} className="w-full h-full object-contain" />
                    </div>
                </div>

                <div className="text-center space-y-2 mb-8">
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">{import.meta.env.VITE_APP_TITLE || "Megagen CRM"}</h1>
                    <p className="text-gray-500 font-medium">Plataforma de Gestión Comercial</p>
                </div>

                <div className="space-y-4">
                    {signInFailed && (
                        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left animate-in fade-in duration-300">
                            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-sm font-bold text-amber-800">Conexión interrumpida</p>
                                <p className="text-xs font-medium text-amber-700">{GOOGLE_SIGN_IN_UNAVAILABLE_MESSAGE}</p>
                            </div>
                        </div>
                    )}
                    <button
                        onClick={handleGoogleLogin}
                        disabled={signingIn}
                        className="w-full disabled:opacity-70 disabled:cursor-wait flex items-center justify-center space-x-4 bg-white border border-gray-100 py-5 px-8 rounded-[2rem] font-bold text-gray-700 hover:bg-gray-50 transition-all active:scale-95 shadow-sm hover:shadow-xl hover:shadow-indigo-50 border-gray-100"
                    >
                        {signingIn ? (
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        ) : signInFailed ? (
                            <RefreshCw className="w-6 h-6 text-gray-500" />
                        ) : (
                            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
                        )}
                        <span>{signingIn ? 'Conectando...' : signInFailed ? 'Reintentar' : 'Inicio de Sesión'}</span>
                    </button>

                    <p className="text-[10px] text-center text-gray-400 font-bold uppercase tracking-[0.1em] mt-4">
                        Acceso corporativo o por invitacion aprobada
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
