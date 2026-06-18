import { getDateFromString } from "../../utils"
import { getAllFiles } from "./api"
import { ARCHIVE_PLAYLIST_ID } from "./constants"
import type { AzuraShow, Show } from "./types"


const mapAzuraShowToShow = (show: AzuraShow): Show => ({
  ...show,
  artists: show.artist.split('&').map((artist: string) => artist.trim()),
  date: getDateFromString(show.custom_fields.air_date),
  setlist: show.lyrics ?? '',
  download: `https://stream.jettyradio.com/api/station/1/ondemand/download/${show.unique_id}`
})

const showInArchivePlaylist = (show: AzuraShow) => show.playlists.some((pl) => pl.id === ARCHIVE_PLAYLIST_ID)

const showIsArchived = (show: AzuraShow) => Boolean(showInArchivePlaylist(show) || show.custom_fields.archive)

export const getArchives = async (): Promise<Show[]> => {
  const allShows = await getAllFiles()
  const archiveShows = allShows.filter(showIsArchived).map(mapAzuraShowToShow)
  return archiveShows
}
