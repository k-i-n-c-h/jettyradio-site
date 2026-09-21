import type { Env } from "./types";
import { client, type Media, type Playlist } from "./azura";
export async function station(request: Request, env: Env) {
  const azura = client(env);
  if (!env.AZURACAST_API_KEY)
    return Response.json(
      { connected: false, playlists: [], files: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  try {
    const [playlists, files, directories] = (await Promise.all([
      azura("/playlists"),
      azura("/files"),
      azura("/files/directories"),
    ])) as [Playlist[], Media[], { rows: { name: string; path: string }[] }];
    if (!Array.isArray(playlists) || !Array.isArray(files))
      throw new Error("Unexpected AzuraCast response.");
    return Response.json(
      {
        connected: true,
        station: "Jetty Radio",
        directories: directories.rows,
        playlists: playlists.map((p) => ({
          id: p.id,
          name: p.name,
          is_enabled: p.is_enabled,
          schedule_items: p.schedule_items,
          source: p.source,
        })),
        files: files.map((f) => ({
          id: f.id,
          title: f.title,
          artist: f.artist,
          path: f.path,
          length: f.length,
          playlists: f.playlists,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Connection failed." },
      { status: 502 }
    );
  }
}
