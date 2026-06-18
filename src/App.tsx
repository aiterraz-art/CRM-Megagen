import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { supabase } from './services/supabase';
import { googleService } from './services/googleService';
import { Session } from '@supabase/supabase-js';
import { UserProvider } from './contexts/UserContext';
import { useUser } from './contexts/UserContext';
import { VisitProvider } from './contexts/VisitContext';
import { startLocationQueueWorker } from './services/locationQueue';
import { lazyRetry } from './utils/lazyRetry';

const loadable = <T extends React.ComponentType<any>>(importer: () => Promise<{ default: T }>) =>
    lazy(() => lazyRetry(importer));

const MapView = loadable(() => import('./pages/MapView'));
const VisitLog = loadable(() => import('./pages/VisitLog'));
const Dashboard = loadable(() => import('./pages/Dashboard'));
const Login = loadable(() => import('./pages/Login'));
const Schedule = loadable(() => import('./pages/Schedule'));
const Clients = loadable(() => import('./pages/Clients'));
const Inventory = loadable(() => import('./pages/Inventory'));
const TeamStats = loadable(() => import('./pages/TeamStats'));
const Quotations = loadable(() => import('./pages/Quotations'));
const QuotationOrderProof = loadable(() => import('./pages/QuotationOrderProof'));
const SizeChanges = loadable(() => import('./pages/SizeChanges'));
const Orders = loadable(() => import('./pages/Orders'));
const SellerRoutes = loadable(() => import('./pages/SellerRoutes'));
const Pipeline = loadable(() => import('./pages/Pipeline'));
const LeadPipeline = loadable(() => import('./pages/LeadPipeline'));
const LeadMessages = loadable(() => import('./pages/LeadMessages'));
const MetaLeads = loadable(() => import('./pages/MetaLeads'));
const ColdVisit = loadable(() => import('./pages/ColdVisit'));
const Dispatch = loadable(() => import('./pages/Dispatch'));
const DeliveryRoute = loadable(() => import('./pages/DeliveryRoute'));
const DeliveryProofCapture = loadable(() => import('./pages/DeliveryProofCapture'));
const DriverDashboard = loadable(() => import('./pages/DriverDashboard'));
const SellerDashboard = loadable(() => import('./pages/SellerDashboard'));
const AdministrativeDashboard = loadable(() => import('./pages/AdministrativeDashboard'));
const Settings = loadable(() => import('./pages/Settings'));
const VisitHistory = loadable(() => import('./pages/VisitHistory'));
const OperationsCenter = loadable(() => import('./pages/OperationsCenter'));
const Collections = loadable(() => import('./pages/Collections'));
const MyDeliveries = loadable(() => import('./pages/MyDeliveries'));
const ConversionsRanking = loadable(() => import('./pages/ConversionsRanking'));
const Procurement = loadable(() => import('./pages/Procurement'));
const KitLoans = loadable(() => import('./pages/KitLoans'));
const PurchaseOrders = loadable(() => import('./pages/PurchaseOrders'));

const ScreenLoader = () => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-dental-600"></div>
    </div>
);

const LAST_APP_ROUTE_KEY = 'crm_last_app_route';

const isBillingBackofficeRole = (role: string | null | undefined) =>
    role === 'facturador' || role === 'tesorero';

const DashboardWrapper = () => {
    const { effectiveRole } = useUser();
    if (effectiveRole === 'driver') return <DriverDashboard />;
    if (effectiveRole === 'seller') return <SellerDashboard />;
    if (isBillingBackofficeRole(effectiveRole)) return <AdministrativeDashboard />;
    return <Dashboard />;
};

const NonSellerGuard = ({ children }: { children: JSX.Element }) => {
    const { effectiveRole, loading } = useUser();
    if (loading) return <div className="p-10 text-center">Cargando perfil...</div>;
    if (effectiveRole === 'seller') return <Navigate to="/" replace />;
    return children;
};

const NonFacturadorGuard = ({ children }: { children: JSX.Element }) => {
    const { effectiveRole, loading } = useUser();
    if (loading) return <div className="p-10 text-center">Cargando perfil...</div>;
    if (isBillingBackofficeRole(effectiveRole)) return <Navigate to="/" replace />;
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

const MetaLeadsGuard = ({ children }: { children: JSX.Element }) => {
    const { effectiveRole, loading } = useUser();
    if (loading) return <div className="p-10 text-center">Cargando perfil...</div>;
    if (!(effectiveRole === 'admin' || effectiveRole === 'seller')) {
        return <Navigate to="/" replace />;
    }
    return children;
};

const PermissionGuard = ({ permission, children }: { permission: string; children: JSX.Element }) => {
    const { hasPermission, loading } = useUser();
    if (loading) return <div className="p-10 text-center">Cargando perfil...</div>;
    if (!hasPermission(permission)) {
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
            if (session) {
                void googleService.storeRefreshTokenIfPresent(session);
            }
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setLoading(false);
            if (session) {
                void googleService.storeRefreshTokenIfPresent(session);
            } else {
                googleService.clearCachedToken();
            }
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

    const AppRoutesWithRecovery = () => {
        const location = useLocation();
        const navigate = useNavigate();

        useEffect(() => {
            if (!session) return;

            const currentRoute = `${location.pathname}${location.search}${location.hash}`;
            const isAuthRoute = location.pathname === '/login';

            if (!isAuthRoute) {
                window.localStorage.setItem(LAST_APP_ROUTE_KEY, currentRoute);
            }
        }, [location.hash, location.pathname, location.search]);

        useEffect(() => {
            if (!session) return;

            const isRootRoute =
                location.pathname === '/' &&
                location.search === '' &&
                location.hash === '';

            if (!isRootRoute) return;

            const savedRoute = window.localStorage.getItem(LAST_APP_ROUTE_KEY);
            if (!savedRoute || savedRoute === '/' || savedRoute === '/login') return;

            navigate(savedRoute, { replace: true });
        }, [location.hash, location.pathname, location.search, navigate]);

        return (
            <ErrorBoundary resetKey={location.pathname} fullScreen>
                <Suspense fallback={<ScreenLoader />}>
                    <Routes>
                        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />

                        <Route path="/" element={session ? (
                            <AuthGuard>
                                <Layout />
                            </AuthGuard>
                        ) : <Navigate to="/login" />}>
                            <Route index element={<RoleBasedDashboard />} />
                            <Route path="cold-visit" element={<NonFacturadorGuard><ColdVisit /></NonFacturadorGuard>} />
                            <Route path="map" element={<NonFacturadorGuard><MapView /></NonFacturadorGuard>} />
                            <Route path="visit/:clientId" element={<VisitLog />} />
                            <Route path="visits" element={<NonFacturadorGuard><VisitHistory /></NonFacturadorGuard>} />
                            <Route path="schedule" element={<Schedule />} />
                            <Route path="clients" element={<Clients />} />
                            <Route path="quotations" element={<Quotations />} />
                            <Route path="quotations/:quotationId/order-proof" element={<QuotationOrderProof />} />
                            <Route path="size-changes" element={<PermissionGuard permission="VIEW_SIZE_CHANGES"><SizeChanges /></PermissionGuard>} />
                            <Route path="orders" element={<Orders />} />
                            <Route path="conversions" element={<ConversionsRanking />} />
                            <Route path="routes" element={<NonFacturadorGuard><SellerRoutes /></NonFacturadorGuard>} />
                            <Route path="inventory" element={<Inventory />} />
                            <Route path="procurement" element={<PermissionGuard permission="VIEW_PROCUREMENT"><Procurement /></PermissionGuard>} />
                            <Route path="purchase-orders" element={<PermissionGuard permission="VIEW_PURCHASE_ORDERS"><PurchaseOrders /></PermissionGuard>} />
                            <Route path="suppliers" element={<PermissionGuard permission="VIEW_PURCHASE_ORDERS"><PurchaseOrders /></PermissionGuard>} />
                            <Route path="kit-loans" element={<PermissionGuard permission="VIEW_KIT_LOANS"><KitLoans /></PermissionGuard>} />
                            <Route path="team" element={<NonFacturadorGuard><NonSellerGuard><TeamStats /></NonSellerGuard></NonFacturadorGuard>} />
                            <Route path="pipeline" element={<NonFacturadorGuard><Pipeline /></NonFacturadorGuard>} />
                            <Route path="lead-pipeline" element={<LeadModuleGuard><LeadPipeline /></LeadModuleGuard>} />
                            <Route path="meta-leads" element={<MetaLeadsGuard><MetaLeads /></MetaLeadsGuard>} />
                            <Route path="lead-messages" element={<LeadModuleGuard><LeadMessages /></LeadModuleGuard>} />
                            <Route path="dispatch" element={<Dispatch />} />
                            <Route path="delivery" element={<DeliveryRoute />} />
                            <Route path="delivery/:orderId/proof" element={<DeliveryProofCapture />} />
                            <Route path="my-deliveries" element={<MyDeliveries />} />
                            <Route path="operations" element={<OperationsCenter />} />
                            <Route path="collections" element={<Collections />} />
                            <Route path="settings" element={<Settings />} />
                        </Route>

                        <Route path="*" element={<Navigate to="/" />} />
                    </Routes>
                </Suspense>
            </ErrorBoundary>
        );
    };

    return (
        <UserProvider>
            <VisitProvider>
                <Router>
                    <AppRoutesWithRecovery />
                </Router>
            </VisitProvider>
        </UserProvider>
    );
}

export default App;
