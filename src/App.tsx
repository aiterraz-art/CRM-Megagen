import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { supabase } from './services/supabase';
import { Session } from '@supabase/supabase-js';
import { UserProvider } from './contexts/UserContext';
import { useUser } from './contexts/UserContext';
import { VisitProvider } from './contexts/VisitContext';
import { startLocationQueueWorker } from './services/locationQueue';

const MapView = lazy(() => import('./pages/MapView'));
const VisitLog = lazy(() => import('./pages/VisitLog'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Login = lazy(() => import('./pages/Login'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Clients = lazy(() => import('./pages/Clients'));
const Inventory = lazy(() => import('./pages/Inventory'));
const TeamStats = lazy(() => import('./pages/TeamStats'));
const Quotations = lazy(() => import('./pages/Quotations'));
const SellerRoutes = lazy(() => import('./pages/SellerRoutes'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const LeadPipeline = lazy(() => import('./pages/LeadPipeline'));
const LeadMessages = lazy(() => import('./pages/LeadMessages'));
const MetaLeads = lazy(() => import('./pages/MetaLeads'));
const ColdVisit = lazy(() => import('./pages/ColdVisit'));
const Dispatch = lazy(() => import('./pages/Dispatch'));
const DeliveryRoute = lazy(() => import('./pages/DeliveryRoute'));
const DriverDashboard = lazy(() => import('./pages/DriverDashboard'));
const SellerDashboard = lazy(() => import('./pages/SellerDashboard'));
const AdministrativeDashboard = lazy(() => import('./pages/AdministrativeDashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const VisitHistory = lazy(() => import('./pages/VisitHistory'));
const OperationsCenter = lazy(() => import('./pages/OperationsCenter'));
const Collections = lazy(() => import('./pages/Collections'));
const MyDeliveries = lazy(() => import('./pages/MyDeliveries'));
const ConversionsRanking = lazy(() => import('./pages/ConversionsRanking'));

const ScreenLoader = () => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-dental-600"></div>
    </div>
);

const DashboardWrapper = () => {
    const { effectiveRole } = useUser();
    if (effectiveRole === 'driver') return <DriverDashboard />;
    if (effectiveRole === 'seller') return <SellerDashboard />;
    if (effectiveRole === 'administrativo') return <AdministrativeDashboard />;
    return <Dashboard />;
};

const NonSellerGuard = ({ children }: { children: JSX.Element }) => {
    const { effectiveRole, loading } = useUser();
    if (loading) return <div className="p-10 text-center">Cargando perfil...</div>;
    if (effectiveRole === 'seller') return <Navigate to="/" replace />;
    return children;
};

const NonAdministrativeGuard = ({ children }: { children: JSX.Element }) => {
    const { effectiveRole, loading } = useUser();
    if (loading) return <div className="p-10 text-center">Cargando perfil...</div>;
    if (effectiveRole === 'administrativo') return <Navigate to="/" replace />;
    return children;
};

const LeadModuleGuard = ({ children }: { children: JSX.Element }) => {
    const { effectiveRole, loading } = useUser();
    if (loading) return <div className="p-10 text-center">Cargando perfil...</div>;
    if (!(effectiveRole === 'admin' || effectiveRole === 'jefe' || effectiveRole === 'seller')) {
        return <Navigate to="/" replace />;
    }
    return children;
};

function App() {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setLoading(false);
        }, 4000);

        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setLoading(false);
        });

        return () => {
            subscription.unsubscribe();
            clearTimeout(timeout);
        };
    }, []);

    useEffect(() => {
        const stopWorker = startLocationQueueWorker();
        return () => stopWorker();
    }, []);

    if (loading) {
        return <ScreenLoader />;
    }

    const RoleBasedDashboard = () => {
        return <DashboardWrapper />;
    };

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

        if (profile?.status === 'disabled' || profile?.status === 'suspended') {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
                    <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md text-center">
                        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl">🚫</span>
                        </div>
                        <h2 className="text-2xl font-black text-gray-900 mb-2">Acceso Restringido</h2>
                        <p className="text-gray-500 mb-6">Tu cuenta está deshabilitada o suspendida. Contacta al administrador.</p>
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
                    <Suspense fallback={<ScreenLoader />}>
                        <Routes>
                            <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />

                            <Route path="/" element={session ? (
                                <AuthGuard>
                                    <Layout />
                                </AuthGuard>
                            ) : <Navigate to="/login" />}>
                                <Route index element={<RoleBasedDashboard />} />
                                <Route path="cold-visit" element={<NonAdministrativeGuard><ColdVisit /></NonAdministrativeGuard>} />
                                <Route path="map" element={<NonAdministrativeGuard><MapView /></NonAdministrativeGuard>} />
                                <Route path="visit/:clientId" element={<VisitLog />} />
                                <Route path="visits" element={<NonAdministrativeGuard><NonSellerGuard><VisitHistory /></NonSellerGuard></NonAdministrativeGuard>} />
                                <Route path="schedule" element={<Schedule />} />
                                <Route path="clients" element={<Clients />} />
                                <Route path="quotations" element={<Quotations />} />
                                <Route path="conversions" element={<ConversionsRanking />} />
                                <Route path="routes" element={<NonAdministrativeGuard><SellerRoutes /></NonAdministrativeGuard>} />
                                <Route path="inventory" element={<Inventory />} />
                                <Route path="team" element={<NonAdministrativeGuard><NonSellerGuard><TeamStats /></NonSellerGuard></NonAdministrativeGuard>} />
                                <Route path="pipeline" element={<NonAdministrativeGuard><Pipeline /></NonAdministrativeGuard>} />
                                <Route path="lead-pipeline" element={<LeadModuleGuard><LeadPipeline /></LeadModuleGuard>} />
                                <Route path="meta-leads" element={<LeadModuleGuard><MetaLeads /></LeadModuleGuard>} />
                                <Route path="lead-messages" element={<LeadModuleGuard><LeadMessages /></LeadModuleGuard>} />
                                <Route path="dispatch" element={<Dispatch />} />
                                <Route path="delivery" element={<DeliveryRoute />} />
                                <Route path="my-deliveries" element={<MyDeliveries />} />
                                <Route path="operations" element={<OperationsCenter />} />
                                <Route path="collections" element={<NonAdministrativeGuard><Collections /></NonAdministrativeGuard>} />
                                <Route path="settings" element={<Settings />} />
                            </Route>

                            <Route path="*" element={<Navigate to="/" />} />
                        </Routes>
                    </Suspense>
                </Router>
            </VisitProvider>
        </UserProvider>
    );
}

export default App;
