import type { Env } from "./types";
import { client, type Media } from "./azura";
import { readLimited } from "./body";
import { mp3Filename } from "./validation.mjs";
const chunkSize = 1024 * 1024;
export async function upload(request: Request, env: Env) {
  const params = new URL(request.url).searchParams;
  const name = params.get("name") || "",
    uploadId = params.get("uploadId") || "";
  const total = Number(params.get("size")),
    chunk = Number(params.get("chunk"));
  if (!/^[^/\\]{1,180}\.mp3$/i.test(name) || !request.body)
    return Response.json({ error: "Select an MP3 file." }, { status: 400 });
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      uploadId
    ) ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > 512 * 1024 * 1024 ||
    !Number.isSafeInteger(chunk) ||
    chunk < 1 ||
    chunk > Math.ceil(total / chunkSize)
  )
    return Response.json({ error: "Invalid upload chunk." }, { status: 400 });
  let path: string;
  try {
    path = mp3Filename(name, uploadId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Enter an MP3 name." },
      { status: 400 }
    );
  }
  const azura = client(env),
    chunks = Math.ceil(total / chunkSize);
  try {
    const bytes = await readLimited(request, chunkSize);
    if (bytes.length !== Math.min(chunkSize, total - (chunk - 1) * chunkSize))
      return Response.json(
        { error: "Incomplete upload chunk." },
        { status: 400 }
      );
    if (chunk === 1 || chunk === chunks) {
      const files = (await azura("/files")) as Media[];
      const existing = files.find((f) => f.path === path);
      if (existing)
        return Response.json({
          id: existing.id,
          title: existing.title,
          path: existing.path,
          complete: true,
        });
    }
    const form = new FormData();
    for (const [key, value] of Object.entries({
      flowChunkNumber: chunk,
      flowChunkSize: chunkSize,
      flowCurrentChunkSize: bytes.length,
      flowTotalSize: total,
      flowTotalChunks: chunks,
      flowIdentifier: uploadId,
      flowFilename: path,
      flowRelativePath: path,
      currentDirectory: "",
    }))
      form.set(key, String(value));
    form.set(
      "file",
      new Blob([bytes as BlobPart], { type: "audio/mpeg" }),
      path
    );
    const result = (await azura("/files/upload", {
      method: "POST",
      body: form,
    })) as { success?: boolean; error?: unknown };
    if (result.success === false || result.error)
      throw new Error(
        "AzuraCast could not process the audio. Check the station before retrying."
      );
    if (chunk < chunks) return Response.json({ complete: false, chunk });
    const files = (await azura("/files")) as Media[];
    const file = files.find((f) => f.path === path);
    if (!file)
      throw new Error(
        "Upload was sent but its media record is not yet confirmed. Reload the station before retrying."
      );
    if (file.playlists.length)
      throw new Error(
        "The uploaded file has an unexpected playlist assignment. Check the station immediately."
      );
    return Response.json({
      id: file.id,
      title: file.title,
      path: file.path,
      complete: true,
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Upload was not confirmed. Check AzuraCast before retrying.",
      },
      { status: 502 }
    );
  }
}
