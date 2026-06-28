import { getAllPlaylists } from "./api"
import { AZURACAST_API_KEY } from './constants'

export const getPlaylists = async (apiKey: string = AZURACAST_API_KEY) => {
    const playlists = await getAllPlaylists(apiKey)
    return playlists
}