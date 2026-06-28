import { camelCase } from 'es-toolkit/string';
import { zipObject, keyBy } from 'es-toolkit/array';
import { getGoogleSheet } from "./api"
import { SHEET_RANGE, SHOWS_SHEET_ID } from "./constants"
import type { JettyShow } from './types';

export const getShowsFromSheet = async (): Promise<JettyShow[]> => {
    const sheet = await getGoogleSheet(SHOWS_SHEET_ID, SHEET_RANGE)
    const headerRow = sheet.shift()
    if (!headerRow) {
        throw new Error('Error reading google sheet: no first row.')
    }
    const headerCamel = headerRow.map(camelCase)
    const shows = sheet.map((showValues: string[]) => zipObject(headerCamel, showValues) as unknown as JettyShow)
    return shows
}

export const getShowsBySlug = async () => {
    const shows = await getShowsFromSheet()
    const showsBySlug = keyBy(shows, (show) => show.showSlug)
    return showsBySlug
}