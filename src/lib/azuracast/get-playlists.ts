import { getAllPlaylists } from "./api"

export const getPlaylists = async () => {
    const playlists = await getAllPlaylists()
    return playlists
}