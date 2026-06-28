import { maxBy } from 'es-toolkit/array';
import { getAllFiles } from "./api"


import { mapAzuraShowToShow } from "./map-show"
import type { AzuraShow, Show } from "./types"
import { AZURACAST_API_KEY } from './constants';

export const getAllShows = async (apiKey: string): Promise<Show[]> => {
    const files = await getAllFiles(apiKey)
    return files.map(mapAzuraShowToShow)
}

export const mostRecentFromFiles = (files: AzuraShow[]) => maxBy(files, (file) => file.uploaded_at)
export const getMostRecentFile = async (apiKey: string): Promise<Show | undefined> => {
    const files = await getAllFiles(apiKey)
    const mostRecentFile = mostRecentFromFiles(files)
    return mostRecentFile ? mapAzuraShowToShow(mostRecentFile) : undefined
}

// export const getMostRecentFileFromPlaylist = async (apiKey: string, playlistId: number): Promise<Show | undefined> => {
//     const files = await getAllFiles(apiKey)
//     const mostRecentFile = maxBy(files, (file) => file.uploaded_at)
//     return mostRecentFile ? mapAzuraShowToShow(mostRecentFile) : undefined
// }


