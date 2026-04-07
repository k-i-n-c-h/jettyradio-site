import { getDateFromString } from "../../utils"

type AzuraShow = {
  title: string
  artist: string
  art: string
  unique_id: string
  custom_fields: {
    archive?: string
    air_date?: string
    setlist?: string
  }
  playlists: [
    { id: number }
  ]
}
export type Show = {
  title: string
  artist: string
  art: string
  artists: string[]
  setlist: string
  date: Date
  download: string
}
export const getArchives = async (): Promise<Show[]> => {
  const res = await fetch('https://stream.jettyradio.com/api/station/1/files', {
    headers: {
      'X-API-Key': import.meta.env.AZURACAST_API_KEY,
    },
  })
  const allShows = await res.json()
  const archiveShows = allShows.filter((show: AzuraShow) =>
    show.playlists.some((pl: any) => pl.id === 8) || show.custom_fields.archive
  ).map((show: AzuraShow): Show => {
    console.log(show.artist.split('&').map((artist: string) => artist.trim()))
    return {
      ...show,
      artists: show.artist.split('&').map((artist: string) => artist.trim()),
      date: getDateFromString(show.custom_fields.air_date),
      setlist: show.custom_fields.setlist ?? '',
      download: `https://stream.jettyradio.com/api/station/1/ondemand/download/${show.unique_id}`
    }
  })
  return archiveShows
}
