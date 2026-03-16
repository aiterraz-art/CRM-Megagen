export type GoogleCalendarAttendee = {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
};

export type CalendarEvent = {
    id: string;
    summary: string;
    description?: string;
    start: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    location?: string;
    source: 'google' | 'crm' | 'internal';
    clientId?: string;
    linkedEntityType?: 'google' | 'visit' | 'task';
    linkedEntityId?: string;
    googleBacked?: boolean;
    googleEventId?: string;
    calendarId?: string;
    htmlLink?: string;
    meetLink?: string;
    attendees?: GoogleCalendarAttendee[];
    organizerName?: string;
    organizerEmail?: string;
    creatorName?: string;
    creatorEmail?: string;
    selfResponseStatus?: string;
};
