import { readLimited } from "./body";
import { upload } from "./upload";
import type { Env } from "./types";
import type { Show } from "./data";
import { mp3Filename } from "./validation.mjs";
import { driveFile } from "./google";
export function driveDownloadUrl(link: string) {
  const url = new URL(link);
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com")
    throw new Error(
      "Direct import currently supports Google Drive file links. Use the file fallback for other sources."
    );
  const id =
    url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] ||
    url.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id))
    throw new Error("Use a Google Drive link to the episode MP3.");
  const target = new URL("https://drive.usercontent.google.com/download");
  target.searchParams.set("id", id);
  target.searchParams.set("export", "download");
  target.searchParams.set("confirm", "t");
  const resourceKey = url.searchParams.get("resourcekey");
  if (resourceKey && /^[A-Za-z0-9_-]{1,200}$/.test(resourceKey))
    target.searchParams.set("resourcekey", resourceKey);
  return target;
}
export async function importAudio(request: Request, env: Env, googleAccessToken?: string) {
  try {
    const body = JSON.parse(
      new TextDecoder().decode(await readLimited(request, 16384))
    );
    if (
      typeof body.showId !== "string" ||
      !Number.isSafeInteger(body.revision) ||
      !Number.isSafeInteger(body.chunk) ||
      body.chunk < 1 ||
      body.chunk > 512 ||
      typeof body.uploadId !== "string" ||
      !/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(
        body.uploadId
      )
    )
      throw new Error("Invalid episode import.");
    const row = await env.DB.prepare(
      "SELECT data, revision FROM desk WHERE id = ?"
    )
      .bind("jetty")
      .first<{ data: string; revision: number }>();
    if (!row || row.revision !== body.revision)
      throw new Error("The plan changed. Reload it before importing audio.");
    const episode = (JSON.parse(row.data).shows as Show[]).find(
      (s) => s.id === body.showId
    );
    if (!episode?.audio) throw new Error("Save the episode audio link first.");
    const name =
      episode.uploadName || `${episode.title.slice(0, 140)} - ${episode.date}`;
    mp3Filename(name, body.uploadId);
    const chunkSize = 1024 * 1024,
      start = (body.chunk - 1) * chunkSize;
    const response = googleAccessToken
      ? await driveFile(episode.audio, googleAccessToken, `bytes=${start}-${start + chunkSize - 1}`)
      : await fetch(driveDownloadUrl(episode.audio), {
      headers: { Range: `bytes=${start}-${start + chunkSize - 1}` },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (
      ![200, 206].includes(response.status) ||
      !response.headers
        .get("Content-Type")
        ?.toLowerCase()
        .startsWith("audio/mpeg")
    ) {
      await response.body?.cancel();
      throw new Error(
        "Google Drive did not allow a direct MP3 download. Download the linked file while signed in, then use “Upload the linked MP3 from this computer”."
      );
    }
    const range = response.headers
      .get("Content-Range")
      ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    const size = range
      ? Number(range[3])
      : Number(response.headers.get("Content-Length"));
    const modified =
      response.headers.get("Last-Modified") ||
      response.headers.get("ETag") ||
      "";
    if (
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > 512 * chunkSize ||
      (response.status === 206 && (!range || Number(range[1]) !== start)) ||
      (response.status === 200 && (start !== 0 || size > chunkSize)) ||
      (body.size && body.size !== size) ||
      (body.modified && body.modified !== modified)
    ) {
      await response.body?.cancel();
      throw new Error(
        "The source file changed or does not support a safe chunked download. Retry from the saved link or use the file fallback."
      );
    }
    const bytes = await readLimited(
      new Request("https://source.invalid", {
        method: "POST",
        body: response.body,
        duplex: "half",
      } as RequestInit),
      chunkSize
    );
    const url = new URL("https://desk.invalid/api/azura/upload");
    for (const [key, value] of Object.entries({
      name: `${name.replace(/\.mp3$/i, "")}.mp3`,
      uploadId: body.uploadId,
      size,
      chunk: body.chunk,
    }))
      url.searchParams.set(key, String(value));
    const result = await upload(
      new Request(url, { method: "POST", body: bytes as BodyInit }),
      env
    );
    return Response.json(
      { ...((await result.json()) as object), size, modified },
      { status: result.status }
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The linked audio could not be imported.",
      },
      { status: 400 }
    );
  }
}
