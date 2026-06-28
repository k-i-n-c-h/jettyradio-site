import { getDateFromString } from "../../utils";
import type { AzuraShow, Show } from "./types";

export const mapAzuraShowToShow = (show: AzuraShow): Show => ({
    ...show,
    artists: show.artist.split('&').map((artist: string) => artist.trim()),
    date: getDateFromString(show.custom_fields.air_date),
    setlist: show.lyrics ?? '',
    download: `https://stream.jettyradio.com/api/station/1/ondemand/download/${show.unique_id}`
})