import { getDateFromString } from "../../utils"
import { getAllFiles } from "./api"
import { ARCHIVE_PLAYLIST_ID, AZURACAST_API_KEY } from "./constants"
import { mapAzuraShowToShow } from "./map-show"
import type { AzuraShow, Show } from "./types"



export const showInPlaylist = (show: AzuraShow, playlistId: number) => show.playlists.some((pl) => pl.id === playlistId)
const showInArchivePlaylist = (show: AzuraShow) => showInPlaylist(show, ARCHIVE_PLAYLIST_ID)

const showIsArchived = (show: AzuraShow) => Boolean(showInArchivePlaylist(show) || show.custom_fields.archive)

export const getArchives = async (): Promise<Show[]> => {
  const allShows = await getAllFiles(AZURACAST_API_KEY)
  const archiveShows = allShows.filter(showIsArchived).map(mapAzuraShowToShow)
  return archiveShows
}
