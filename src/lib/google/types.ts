export interface JettyShow {
    resident: string
    showName: string
    description: string
    cadence: 'Monthly' | 'Bi-monthly' | 'Weekly'
    dayOfWeek: string
    weekOfMonth: string
    startTime: string
    endTime: string
    azuracastPlaylistId: string
    showSlug: string
}

export interface GoogleCalendarEvent {
    kind: string
    etag: string
    id: string
    status: string
    htmlLink: string
    created: string
    updated: string
    summary: string
    description: string
    start: Start
    end: End
    recurringEventId: string
    iCalUID: string
    sequence: number
    eventType: string
}

export interface Start {
    dateTime: string
    timeZone: string
}

export interface End {
    dateTime: string
    timeZone: string
}


export interface CalendarEvent extends GoogleCalendarEvent {
    showSlug: string
}