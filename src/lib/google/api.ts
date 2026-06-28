import { CALENDAR_ID, GOOGLE_API_KEY } from "./constants"
import type { CalendarEvent, GoogleCalendarEvent } from "./types";

export const getGoogleSheet = async (sheetId: string, range: string): Promise<string[][]> => {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${GOOGLE_API_KEY}`)
    const resJson = await res.json();
    return resJson.values
}

export const getGoogleCalendarEvents = async (until: Date): Promise<GoogleCalendarEvent[]> => {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events?key=${GOOGLE_API_KEY}&timeMax=${until.toISOString()}&singleEvents=true&orderBy=startTime`)
    const resJson = await res.json();
    return resJson.items
}