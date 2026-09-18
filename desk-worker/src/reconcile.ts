import { client, type Media, type Playlist } from "./azura";
import { readLimited } from "./body";
import type { Show } from "./data";
import type { Env } from "./types";
import { validateShows } from "./validation.mjs";
import { reconciledEpisode } from "./reconcile-rules.mjs";

export async function reconcile(request: Request, env: Env, userId: string) {
  try {
    const body = JSON.parse(new TextDecoder().decode(await readLimited(request, 16384)));
    if (typeof body.showId !== "string" || !Number.isSafeInteger(body.expectedRevision) || !Number.isSafeInteger(body.mediaId) || !Number.isSafeInteger(body.playlistId))
      throw new Error("Choose a saved episode, MP3, and show playlist.");
    const row = await env.DB.prepare("SELECT data, revision FROM desk WHERE id = ?")
      .bind("jetty").first<{ data: string; revision: number }>();
    if (!row || row.revision !== body.expectedRevision)
      return Response.json({ error: "The saved plan changed. Reload the desk before reconciling." }, { status: 409 });
    const stored = JSON.parse(row.data);
    const show = stored.shows.find((s: Show) => s.id === body.showId);
    if (!show) throw new Error("This episode is no longer in the desk.");
    if (stored.shows.some((s: Show) => s.id !== show.id && s.mediaId === body.mediaId))
      throw new Error("This MP3 is already attached to another desk episode.");
    const azura = client(env);
    const [file, playlists] = await Promise.all([
      azura(`/file/${body.mediaId}`), azura("/playlists"),
    ]) as [Media, Playlist[]];
    const episode = reconciledEpisode(show, file, playlists, body.playlistId);
    stored.shows = stored.shows.map((s: Show) => s.id === show.id ? episode : s);
    validateShows(stored.shows);
    stored.updatedAt = new Date().toISOString();
    stored.updatedBy = userId;
    const saved = await env.DB.prepare("UPDATE desk SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
      .bind(JSON.stringify(stored), "jetty", row.revision).run();
    if (saved.meta.changes !== 1)
      return Response.json({ error: "A teammate saved a newer plan. Reload before reconciling." }, { status: 409 });
    return Response.json({ ok: true, episode });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not reconcile this episode." }, { status: 400 });
  }
}
