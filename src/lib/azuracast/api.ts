import { AZURACAST_API_KEY, BASE_URL } from "./constants"
import type { AzuraPlaylist, AzuraShow } from "./types"

export const getAllFiles = async (): Promise<AzuraShow[]> => {
    const res = await fetch(`${BASE_URL}/files`, {
        headers: {
            'X-API-Key': AZURACAST_API_KEY,
        },
    })
    return res.json()
}

export const getAllPlaylists = async (): Promise<AzuraPlaylist[]> => {
    const res = await fetch(`${BASE_URL}/playlists`, {
        headers: {
            'X-API-Key': AZURACAST_API_KEY,
        },
    })
    return res.json()
}