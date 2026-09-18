import { hasAired, scheduleMismatch } from "./schedule-rules.mjs";

export function reconciledEpisode(show, file, playlists, playlistId) {
  if (show.status === "archived") throw new Error("This episode is already archived in the desk.");
  if (!show.dateConfirmed) throw new Error("Confirm the episode air date and time first.");
  if (!file?.id || !/\.mp3$/i.test(file.path)) throw new Error("Choose an existing MP3.");
  const playlist = playlists.find((p) => p.id === playlistId);
  if (!playlist || playlist.source !== "songs" || !playlist.schedule_items?.length || ["archives", "heavy rotation"].includes(playlist.name.toLowerCase()))
    throw new Error("Choose the scheduled show playlist for this episode.");
  const airDate = file.custom_fields?.air_date?.trim();
  const parts = airDate?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const normalized = parts ? `${parts[3]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}` : airDate;
  if (airDate && normalized !== show.date) throw new Error("The MP3 air date differs from the confirmed episode date. Check the selected file.");
  const assigned = file.playlists.some((p) => p.id === playlistId);
  const archived = ["archives", "heavy rotation"].every((name) => {
    const matches = playlists.filter((p) => p.source === "songs" && p.name.toLowerCase() === name);
    return matches.length === 1 && file.playlists.some((p) => p.id === matches[0].id);
  }) && !assigned && !playlist.is_enabled && normalized === show.date && hasAired(show);
  if (!assigned && !archived) throw new Error("The MP3 is not in this show playlist or fully archived. Choose its current show playlist.");
  const scheduled = assigned && playlist.is_enabled && !scheduleMismatch(playlist.schedule_items, show) && playlist.schedule_items.every((slot) =>
    (!slot.start_date || slot.start_date <= show.date) && (!slot.end_date || slot.end_date >= show.date));
  const episode = {
    ...show, mediaId: file.id, mediaPath: file.path, audioImportedFrom: show.audio,
    playlistId, directory: file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "",
    status: archived ? "archived" : "draft",
    audioReviewed: false,
  };
  delete episode.scheduledAt;
  if (scheduled) episode.scheduledAt = new Date().toISOString();
  return episode;
}
