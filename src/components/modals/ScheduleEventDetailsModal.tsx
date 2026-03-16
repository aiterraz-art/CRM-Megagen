import { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, Clock, ExternalLink, MapPin, Users, Video, X } from 'lucide-react';
import { useUser } from '../../contexts/UserContext';
import { googleService } from '../../services/googleService';
import { CalendarEvent, GoogleCalendarAttendee } from '../../types/calendar';

type ScheduleEventDetailsModalProps = {
    event: CalendarEvent | null;
    isOpen: boolean;
    isOwnCalendar: boolean;
    canDeleteVisit: boolean;
    onClose: () => void;
    onRefresh: () => void;
    onDeleteVisit?: (visitId: string) => Promise<void>;
};

const responseLabels: Record<string, string> = {
    accepted: 'Asistirá',
    tentative: 'Tal vez',
    declined: 'No asistirá',
    needsAction: 'Sin respuesta',
};

const mapAttendees = (attendees: any[] | undefined): GoogleCalendarAttendee[] =>
    Array.isArray(attendees)
        ? attendees.map((attendee) => ({
            email: attendee.email,
            displayName: attendee.displayName,
            responseStatus: attendee.responseStatus,
            self: attendee.self,
            organizer: attendee.organizer,
        }))
        : [];

const mapGoogleEventDetails = (event: CalendarEvent, payload: any): CalendarEvent => ({
    ...event,
    summary: payload.summary || event.summary,
    description: payload.description || event.description,
    start: payload.start || event.start,
    end: payload.end || event.end,
    location: payload.location || event.location,
    htmlLink: payload.htmlLink || event.htmlLink,
    meetLink: payload.hangoutLink || payload.conferenceData?.entryPoints?.find((entry: any) => entry.entryPointType === 'video')?.uri || event.meetLink,
    attendees: mapAttendees(payload.attendees),
    organizerName: payload.organizer?.displayName || event.organizerName,
    organizerEmail: payload.organizer?.email || event.organizerEmail,
    creatorName: payload.creator?.displayName || event.creatorName,
    creatorEmail: payload.creator?.email || event.creatorEmail,
    selfResponseStatus: mapAttendees(payload.attendees).find((attendee) => attendee.self)?.responseStatus || event.selfResponseStatus,
});

const formatDateTimeRange = (event: CalendarEvent) => {
    if (!event.start.dateTime && !event.start.date) return 'Sin fecha';
    const startValue = event.start.dateTime || event.start.date || '';
    const endValue = event.end?.dateTime || event.end?.date || '';
    const startDate = new Date(startValue);
    const endDate = endValue ? new Date(endValue) : null;

    if (!event.start.dateTime) {
        return startDate.toLocaleDateString('es-CL', { dateStyle: 'full' });
    }

    const dateLabel = startDate.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    const startTime = startDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate?.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    return `${dateLabel} · ${startTime}${endTime ? ` - ${endTime}` : ''}`;
};

const ScheduleEventDetailsModal = ({
    event,
    isOpen,
    isOwnCalendar,
    canDeleteVisit,
    onClose,
    onRefresh,
    onDeleteVisit,
}: ScheduleEventDetailsModalProps) => {
    const { profile } = useUser();
    const [details, setDetails] = useState<CalendarEvent | null>(event);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        setDetails(event);
    }, [event]);

    useEffect(() => {
        if (!isOpen || !event?.googleBacked || !event.googleEventId || !event.calendarId) return;

        const loadGoogleDetails = async () => {
            setLoadingDetails(true);
            try {
                const payload = await googleService.fetchGoogleJson<any>(
                    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarId as string)}/events/${encodeURIComponent(event.googleEventId as string)}`
                );
                setDetails(mapGoogleEventDetails(event, payload));
            } catch (error) {
                console.warn('No se pudo hidratar el detalle Google del evento', error);
                setDetails(event);
            } finally {
                setLoadingDetails(false);
            }
        };

        void loadGoogleDetails();
    }, [event, isOpen]);

    const effectiveEvent = details || event;
    const ownAttendeeEmail = useMemo(
        () => effectiveEvent?.attendees?.find((attendee) => attendee.self)?.email || profile?.email || null,
        [effectiveEvent?.attendees, profile?.email]
    );
    const canRespond = Boolean(isOwnCalendar && effectiveEvent?.googleBacked && effectiveEvent.googleEventId && effectiveEvent.calendarId && ownAttendeeEmail);

    if (!isOpen || !effectiveEvent) return null;

    const attendees = effectiveEvent.attendees || [];

    const handleResponseUpdate = async (responseStatus: 'accepted' | 'tentative' | 'declined') => {
        if (!canRespond || !ownAttendeeEmail) return;

        setActionLoading(true);
        try {
            await googleService.fetchGoogleJson(
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(effectiveEvent.calendarId as string)}/events/${encodeURIComponent(effectiveEvent.googleEventId as string)}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        attendeesOmitted: true,
                        attendees: [{ email: ownAttendeeEmail, responseStatus }]
                    })
                }
            );
            onRefresh();
            setDetails((current) => current ? { ...current, selfResponseStatus: responseStatus } : current);
        } catch (error: any) {
            alert(`No se pudo actualizar tu respuesta: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async () => {
        if (effectiveEvent.linkedEntityType !== 'visit' || !effectiveEvent.linkedEntityId || !onDeleteVisit) return;

        setActionLoading(true);
        try {
            await onDeleteVisit(effectiveEvent.linkedEntityId);
            onClose();
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[220] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full max-w-2xl rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl p-6 sm:p-8 max-h-[92vh] overflow-y-auto">
                <div className="flex items-start justify-between gap-4 mb-6">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            {effectiveEvent.source === 'google' ? 'Google Calendar' : effectiveEvent.source === 'crm' ? 'Visita CRM' : 'Actividad Interna'}
                        </p>
                        <h3 className="text-2xl font-black text-gray-900 mt-1">{effectiveEvent.summary || 'Evento sin título'}</h3>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
                        <X size={22} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="rounded-2xl bg-gray-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Fecha y hora</p>
                        <div className="flex items-start gap-3">
                            <Calendar size={18} className="text-indigo-600 mt-0.5" />
                            <p className="text-sm font-bold text-gray-700">{formatDateTimeRange(effectiveEvent)}</p>
                        </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Ubicación</p>
                        <div className="flex items-start gap-3">
                            <MapPin size={18} className="text-indigo-600 mt-0.5" />
                            <p className="text-sm font-bold text-gray-700">{effectiveEvent.location || 'Sin ubicación'}</p>
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-gray-100 p-4 mb-6">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Detalles</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{effectiveEvent.description || 'Sin descripción.'}</p>
                </div>

                {(effectiveEvent.organizerEmail || effectiveEvent.creatorEmail) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="rounded-2xl border border-gray-100 p-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Organizador</p>
                            <p className="text-sm font-bold text-gray-700">{effectiveEvent.organizerName || effectiveEvent.organizerEmail}</p>
                            {effectiveEvent.organizerEmail && <p className="text-xs text-gray-500">{effectiveEvent.organizerEmail}</p>}
                        </div>
                        <div className="rounded-2xl border border-gray-100 p-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Creado por</p>
                            <p className="text-sm font-bold text-gray-700">{effectiveEvent.creatorName || effectiveEvent.creatorEmail || 'No disponible'}</p>
                            {effectiveEvent.creatorEmail && <p className="text-xs text-gray-500">{effectiveEvent.creatorEmail}</p>}
                        </div>
                    </div>
                )}

                {attendees.length > 0 && (
                    <div className="rounded-2xl border border-gray-100 p-4 mb-6">
                        <div className="flex items-center gap-2 mb-3">
                            <Users size={16} className="text-indigo-600" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Asistentes</p>
                        </div>
                        <div className="space-y-2">
                            {attendees.map((attendee) => (
                                <div key={`${attendee.email}-${attendee.responseStatus}`} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2">
                                    <div>
                                        <p className="text-sm font-bold text-gray-800">
                                            {attendee.displayName || attendee.email || 'Invitado'}
                                            {attendee.self && ' (Tú)'}
                                        </p>
                                        {attendee.email && attendee.displayName && <p className="text-xs text-gray-500">{attendee.email}</p>}
                                    </div>
                                    <span className="text-[10px] uppercase tracking-widest font-black text-gray-500">
                                        {responseLabels[attendee.responseStatus || 'needsAction'] || 'Sin respuesta'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {loadingDetails && (
                    <div className="rounded-2xl bg-indigo-50 text-indigo-700 font-bold text-sm px-4 py-3 mb-6">
                        Consultando detalles actualizados desde Google Calendar...
                    </div>
                )}

                <div className="space-y-3">
                    {canRespond && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <button
                                onClick={() => void handleResponseUpdate('accepted')}
                                disabled={actionLoading}
                                className={`rounded-2xl py-3 font-black text-sm transition-all ${effectiveEvent.selfResponseStatus === 'accepted' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                            >
                                Asistiré
                            </button>
                            <button
                                onClick={() => void handleResponseUpdate('tentative')}
                                disabled={actionLoading}
                                className={`rounded-2xl py-3 font-black text-sm transition-all ${effectiveEvent.selfResponseStatus === 'tentative' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                            >
                                Tal vez
                            </button>
                            <button
                                onClick={() => void handleResponseUpdate('declined')}
                                disabled={actionLoading}
                                className={`rounded-2xl py-3 font-black text-sm transition-all ${effectiveEvent.selfResponseStatus === 'declined' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
                            >
                                No asistiré
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {effectiveEvent.htmlLink && (
                            <button
                                onClick={() => window.open(effectiveEvent.htmlLink, '_blank')}
                                className="rounded-2xl py-3 px-4 bg-indigo-600 text-white font-black text-sm flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all"
                            >
                                <ExternalLink size={16} />
                                Abrir en Google Calendar
                            </button>
                        )}
                        {effectiveEvent.meetLink && (
                            <button
                                onClick={() => window.open(effectiveEvent.meetLink, '_blank')}
                                className="rounded-2xl py-3 px-4 bg-white border border-gray-200 text-gray-800 font-black text-sm flex items-center justify-center gap-2 hover:bg-gray-50 transition-all"
                            >
                                <Video size={16} />
                                Abrir Meet
                            </button>
                        )}
                        {canDeleteVisit && effectiveEvent.linkedEntityType === 'visit' && (
                            <button
                                onClick={() => void handleDelete()}
                                disabled={actionLoading}
                                className="rounded-2xl py-3 px-4 bg-rose-50 text-rose-700 font-black text-sm flex items-center justify-center gap-2 hover:bg-rose-100 transition-all"
                            >
                                <Clock size={16} />
                                Eliminar visita
                            </button>
                        )}
                        {!effectiveEvent.htmlLink && !effectiveEvent.meetLink && !canDeleteVisit && (
                            <div className="rounded-2xl py-3 px-4 bg-gray-50 text-gray-500 font-bold text-sm flex items-center justify-center gap-2">
                                <Check size={16} />
                                Sin acciones Google disponibles
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScheduleEventDetailsModal;
