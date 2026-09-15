import { client, type Media, type Playlist } from "./azura";
import { readLimited } from "./body";
import type { Show } from "./data";
import { hasAired } from "./schedule-rules.mjs";
import type { Env } from "./types";
import { validateShows } from "./validation.mjs";

export async function archive(request: Request, env: Env, userId: string) {
  let changed = false;
  try {
    const body = JSON.parse(
      new TextDecoder().decode(await readLimited(request, 16384))
    );
    if (
      typeof body.showId !== "string" ||
      !Number.isSafeInteger(body.expectedRevision)
    )
      throw new Error("Choose a saved episode to archive.");
    const row = await env.DB.prepare(
      "SELECT data, revision FROM desk WHERE id = ?"
    )
      .bind("jetty")
      .first<{ data: string; revision: number }>();
    if (!row || row.revision !== body.expectedRevision)
      throw new Error(
        "The saved plan changed. Reload the desk before archiving."
      );
    const stored = JSON.parse(row.data);
    const show = stored.shows.find((s: Show) => s.id === body.showId) as
      | Show
      | undefined;
    if (!show) throw new Error("This episode is no longer in the desk.");
    validateShows([show]);
    if (
      !show.dateConfirmed ||
      !show.mediaId ||
      !show.mediaPath ||
      !Number.isSafeInteger(show.playlistId) ||
      show.playlistId! < 1
    )
      throw new Error(
        "Confirm the air date and save this episode’s uploaded MP3 and show playlist first."
      );
    if (!hasAired(show))
      throw new Error(
        "Wait until the episode’s Pacific slot has ended, including the 15-second audio allowance."
      );
    if (show.status === "archived")
      return Response.json({
        ok: true,
        planUpdated: true,
        alreadyArchived: true,
      });

    const azura = client(env);
    const [playlists, files] = (await Promise.all([
      azura("/playlists"),
      azura("/files"),
    ])) as [Playlist[], Media[]];
    const destinations = ["Archives", "heavy rotation"].map((name) => {
      const matches = playlists.filter(
        (p) =>
          p.name.toLowerCase() === name.toLowerCase() && p.source === "songs"
      );
      if (matches.length !== 1)
        throw new Error(
          `Could not identify the ${name} playlist in AzuraCast.`
        );
      return matches[0];
    });
    const playlist = playlists.find((p) => p.id === show.playlistId);
    if (
      !playlist ||
      playlist.source !== "songs" ||
      !playlist.schedule_items.length ||
      destinations.some((p) => p.id === playlist.id)
    )
      throw new Error(
        "The saved show playlist is not a scheduled show playlist. Check it in AzuraCast."
      );
    const file = files.find((f) => f.id === show.mediaId);
    if (!file || file.path !== show.mediaPath)
      throw new Error(
        "The episode’s MP3 is missing or its location changed. Check it in AzuraCast before archiving."
      );
    const airDate = `${show.date.slice(5, 7)}/${show.date.slice(8, 10)}/${show.date.slice(0, 4)}`;
    const existingDate = file.custom_fields?.air_date?.trim();
    const parts = existingDate?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const normalizedDate = parts
      ? `${parts[3]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
      : existingDate;
    if (existingDate && normalizedDate !== show.date)
      throw new Error(
        "The MP3’s air date differs from the confirmed episode date or cannot be read. Review the date in AzuraCast first."
      );
    const assigned = file.playlists.some((p) => p.id === playlist.id);
    const alreadyAssigned = destinations.every((p) =>
      file.playlists.some((item) => item.id === p.id)
    );
    if (
      !assigned &&
      !alreadyAssigned &&
      (!destinations.some((p) =>
        file.playlists.some((item) => item.id === p.id)
      ) ||
        normalizedDate !== show.date)
    )
      throw new Error(
        "This MP3 is not in the saved show playlist and its air date has not been confirmed in AzuraCast."
      );
    const otherEpisode = (items: Media[]) =>
      items.some(
        (f) => f.id !== file.id && f.playlists.some((p) => p.id === playlist.id)
      );
    if (otherEpisode(files))
      throw new Error(
        "Another episode is in this show playlist. Review it in AzuraCast before disabling the playlist."
      );
    const ids = [
      ...new Set([
        ...file.playlists.map((p) => p.id).filter((id) => id !== playlist.id),
        ...destinations.map((p) => p.id),
      ]),
    ];
    if (assigned || !alreadyAssigned || existingDate !== airDate) {
      changed = true;
      await azura(`/file/${file.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlists: ids,
          custom_fields: { ...file.custom_fields, air_date: airDate },
        }),
      });
    }
    const verified = (await azura(`/file/${file.id}`)) as Media;
    if (
      verified.path !== file.path ||
      verified.custom_fields?.air_date !== airDate ||
      verified.playlists.some((p) => p.id === playlist.id) ||
      !ids.every((id) => verified.playlists.some((p) => p.id === id))
    )
      throw new Error(
        "AzuraCast did not confirm the archive playlists and air date. The show playlist has not been disabled by this request."
      );
    const [latest, latestFiles] = (await Promise.all([
      azura(`/playlist/${playlist.id}`),
      azura("/files"),
    ])) as [Playlist, Media[]];
    if (
      otherEpisode(latestFiles) ||
      latestFiles.some((f) => f.playlists.some((p) => p.id === playlist.id)) ||
      JSON.stringify(latest.schedule_items) !==
        JSON.stringify(playlist.schedule_items)
    )
      throw new Error(
        "The show playlist changed during archiving. Review it in AzuraCast before disabling it."
      );
    if (latest.is_enabled) {
      changed = true;
      await azura(`/playlist/${playlist.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: false }),
      });
    }
    const disabled = (await azura(`/playlist/${playlist.id}`)) as Playlist;
    if (disabled.is_enabled !== false)
      throw new Error(
        "AzuraCast did not confirm that the show playlist is disabled."
      );
    stored.shows = stored.shows.map((s: Show) =>
      s.id === show.id ? { ...s, status: "archived" } : s
    );
    stored.updatedAt = new Date().toISOString();
    stored.updatedBy = userId;
    const saved = await env.DB.prepare(
      "UPDATE desk SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?"
    )
      .bind(JSON.stringify(stored), "jetty", row.revision)
      .run();
    return Response.json({
      ok: true,
      planUpdated: saved.meta.changes === 1,
      playlist: playlist.name,
      airDate,
    });
  } catch (e) {
    const error =
      e instanceof Error
        ? e.message
        : "Could not confirm archiving in AzuraCast.";
    return Response.json(
      {
        error: changed
          ? `${error} Some changes may already be saved; check AzuraCast before retrying.`
          : error,
      },
      { status: 400 }
    );
  }
}
