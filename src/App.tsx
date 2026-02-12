import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import MapView from './pages/MapView';
import VisitLog from './pages/VisitLog';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Schedule from './pages/Schedule';
import Clients from './pages/Clients';
import Inventory from './pages/Inventory';
import TeamStats from './pages/TeamStats';
import Quotations from './pages/Quotations';
import SellerRoutes from './pages/SellerRoutes';
import Pipeline from './pages/Pipeline';
import ColdVisit from './pages/ColdVisit';
import Dispatch from './pages/Dispatch';
import DeliveryRoute from './pages/DeliveryRoute';
import DriverDashboard from './pages/DriverDashboard';
import Settings from './pages/Settings';
import VisitHistory from './pages/VisitHistory';
import { supabase } from './services/supabase';
import { Session } from '@supabase/supabase-js';
import { UserProvider } from './contexts/UserContext';
import { useUser } from './contexts/UserContext';
import { VisitProvider } from './contexts/VisitContext';

const DashboardWrapper = () => {
    const { effectiveRole } = useUser();
    return effectiveRole === 'driver' ? <DriverDashboard /> : <Dashboard />;
};

function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Safe timeout to prevent infinite loading
        const timeout = setTimeout(() => {
            if (loading) {
                console.warn("App: Session check timed out. Forcing UI load.");
                setLoading(false);
            }
        }, 4000);

        supabase.auth.getSession().then(({ data: { session } }) => {
            console.log("App: Session retrieved", session?.user?.id);
            setSession(session);
            setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            console.log("App: Auth State Changed", _event);
            setSession(session);
            // Also ensure loading is off on change
            setLoading(false);
        });

        return () => {
            subscription.unsubscribe();
            clearTimeout(timeout);
        };
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-dental-600"></div>
            </div>
        );
    }

    // Role based Dashboard wrapper
    const RoleBasedDashboard = () => {
        return <DashboardWrapper />;
    };

    // Auth Guard Component to check status
    const AuthGuard = ({ children }: { children: JSX.Element }) => {
        const { profile, loading } = useUser();

        if (loading) return <div className="p-10 text-center">Cargando perfil...</div>;

        if (profile?.status === 'pending') {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
                    <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md text-center">
                        <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl">⏳</span>
                        </div>
                        <h2 className="text-2xl font-black text-gray-900 mb-2">Cuenta Pendiente</h2>
                        <p className="text-gray-500 mb-6">Tu cuenta ha sido creada pero requiere aprobación de un administrador para acceder al sistema.</p>
                        <button onClick={() => window.location.reload()} className="text-indigo-600 font-bold hover:underline">
                            Verificar nuevamente
                        </button>
                        <div className="mt-6 border-t pt-4">
                            <button onClick={() => supabase.auth.signOut()} className="text-sm text-gray-400 hover:text-red-500 transition-colors">
                                Cerrar Sesión
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        if (profile?.status === 'suspended') {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
                    <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md text-center">
                        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl">🚫</span>
                        </div>
                        <h2 className="text-2xl font-black text-gray-900 mb-2">Acceso Suspendido</h2>
                        <p className="text-gray-500 mb-6">Tu cuenta ha sido suspendida. Contacta al administrador.</p>
                        <button onClick={() => supabase.auth.signOut()} className="text-indigo-600 font-bold hover:underline">
                            Cerrar Sesión
                        </button>
                    </div>
                </div>
            );
        }

        return children;
    };

    return (
        <UserProvider>
            <VisitProvider>
                <Router>
                    <Routes>
                        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />

                        <Route path="/" element={session ? (
                            <AuthGuard>
                                <Layout />
                            </AuthGuard>
                        ) : <Navigate to="/login" />}>
                            {/* Role Based Dash */}
                            <Route index element={<RoleBasedDashboard />} />
                            <Route path="cold-visit" element={<ColdVisit />} />
                            <Route path="map" element={<MapView />} />
                            <Route path="visit/:clientId" element={<VisitLog />} />
                            <Route path="visits" element={<VisitHistory />} />
                            <Route path="schedule" element={<Schedule />} />
                            <Route path="clients" element={<Clients />} />
                            <Route path="quotations" element={<Quotations />} />
                            <Route path="routes" element={<SellerRoutes />} />
                            <Route path="inventory" element={<Inventory />} />
                            <Route path="team" element={<TeamStats />} />
                            <Route path="pipeline" element={<Pipeline />} />
                            <Route path="dispatch" element={<Dispatch />} />
                            <Route path="delivery" element={<DeliveryRoute />} />
                            <Route path="settings" element={<Settings />} />
                        </Route>

                        <Route path="*" element={<Navigate to="/" />} />
                    </Routes>
                </Router>
            </VisitProvider>
        </UserProvider>
    );
}

export default App;
