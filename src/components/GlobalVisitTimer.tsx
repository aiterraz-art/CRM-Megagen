import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVisit } from '../contexts/VisitContext';
import { Clock, MapPin, Camera, ShoppingCart } from 'lucide-react';

import VisitCheckoutModal from './modals/VisitCheckoutModal';
import { supabase } from '../services/supabase';

const GlobalVisitTimer = () => {
    const navigate = useNavigate();
    const { activeVisit, endVisit } = useVisit(); // We will bypass endVisit for now or duplicate logic? Better to handle manual update + context refresh
    // Actually, `endVisit` in context DOES NOT take args. So we must do it manually here.
    const [elapsedTime, setElapsedTime] = useState(0);
    const [finishing, setFinishing] = useState(false);
    const [showNotesModal, setShowNotesModal] = useState(false);
    const [visitNotes, setVisitNotes] = useState('');

    useEffect(() => {
        let interval: any;
        if (activeVisit?.check_in_time) {
            const startTime = new Date(activeVisit.check_in_time).getTime();

            // Initial calc
            const updateTimer = () => {
                const now = new Date().getTime();
                const diff = Math.floor((now - startTime) / 1000);
                setElapsedTime(diff);
            };

            updateTimer();
            interval = setInterval(updateTimer, 1000);
        } else {
            setElapsedTime(0);
        }
        return () => clearInterval(interval);
    }, [activeVisit]);

    const formatTime = (totalSeconds: number) => {
        const isOvertime = totalSeconds > 20 * 60; // 20 minutes limit
        const displaySeconds = isOvertime ? totalSeconds - (20 * 60) : (20 * 60) - totalSeconds;

        const minutes = Math.floor(displaySeconds / 60);
        const seconds = displaySeconds % 60;
        const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        return { formatted, isOvertime };
    };

    const handleConfirmCheckout = async () => {
        if (!activeVisit) return;
        setFinishing(true);
        setShowNotesModal(false);

        const checkoutPayload: any = {
            check_out_time: new Date().toISOString(),
            status: 'completed',
            notes: visitNotes || null
        };

        const executeCheckout = async () => {
            try {
                // Update DB direct
                await (supabase.from('visits') as any).update(checkoutPayload).eq('id', activeVisit.id);
                // Call context to clear state (this triggers fetchActiveVisit which returns null)
                // We mock it by forcing a reload or just calling endVisit?
                // Calling endVisit() blindly might overwrite our update if we aren't careful?
                // No, endVisit fetches location and updates. It might overwrite 'notes' with null if not careful.
                // WE MUST NOT CALL endVisit() if we do it manually.
                // We need a way to clear the context.
                // HACK: Reload page to clear context or expose a clear function.
                // But wait, user might stay on page.
                // Ideally `endVisit` should accept params. Since I can't edit context easily without risk:
                // I will reload the page or navigate to dashboard which triggers refresh.

                window.location.href = '/';
            } catch (err) {
                console.error("Checkout error:", err);
                alert("Error al finalizar visita.");
                setFinishing(false);
            }
        };

        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            checkoutPayload.check_out_lat = latitude;
            checkoutPayload.check_out_lng = longitude;
            await executeCheckout();
        }, async (error) => {
            console.error("Error getting location on checkout:", error);
            // alert("No se pudo obtener la ubicación GPS, guardando solo gestión.");
            // Proceed without GPS
            await executeCheckout();
        });
    };

    if (!activeVisit) return null;

    const timeInfo = formatTime(elapsedTime);

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom-full duration-500">
            {/* Desktop / Mobile Global Timer Bar */}
            <div className={`bg-gray-900 text-white shadow-[0_-8px_30px_rgba(0,0,0,0.3)] border-t border-white/10 p-4 md:px-8`}>
                <div className="max-w-7xl mx-auto flex items-center justify-between">

                    {/* Time Display */}
                    <div className="flex items-center space-x-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${timeInfo.isOvertime ? 'bg-red-500/20 text-red-500 animate-pulse' : 'bg-dental-500/20 text-dental-400'}`}>
                            <Clock size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest hidden md:block">
                                {timeInfo.isOvertime ? 'Tiempo Excedido' : 'Tiempo Restante'}
                            </p>
                            <p className={`text-xl font-black tracking-wider ${timeInfo.isOvertime ? 'text-red-500' : 'text-white'}`}>
                                {timeInfo.isOvertime ? '+' : ''}{timeInfo.formatted}
                            </p>
                        </div>
                    </div>

                    {/* Actions Group */}
                    <div className="flex items-center space-x-3">
                        {/* Shortcuts */}
                        <div className="hidden md:flex items-center space-x-2 mr-4 border-r border-white/10 pr-4">
                            <button
                                onClick={() => navigate(`/visit/${activeVisit.client_id}`)}
                                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all flex flex-col items-center group"
                                title="Evidencia Visual"
                            >
                                <Camera size={18} />
                            </button>
                            <button
                                onClick={() => navigate(`/visit/${activeVisit.client_id}`)}
                                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all flex flex-col items-center group"
                                title="Crear Pedido"
                            >
                                <ShoppingCart size={18} />
                            </button>
                        </div>

                        <button
                            onClick={() => setShowNotesModal(true)}
                            disabled={finishing}
                            className="flex items-center space-x-2 bg-dental-600 hover:bg-dental-700 text-white px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {finishing ? (
                                <span>Guardando...</span>
                            ) : (
                                <>
                                    <span>Terminar Visita</span>
                                    <MapPin size={14} />
                                </>
                            )}
                        </button>
                    </div>

                </div>
            </div>

            {showNotesModal && (
                <VisitCheckoutModal
                    notes={visitNotes}
                    onNotesChange={setVisitNotes}
                    onSave={handleConfirmCheckout}
                    onClose={() => setShowNotesModal(false)}
                    saving={finishing}
                />
            )}

            {/* Spacer to prevent content from being hidden behind bar on mobile if needed, but 'pb' on main layout usually handles it */}
        </div>
    );
};

export default GlobalVisitTimer;
