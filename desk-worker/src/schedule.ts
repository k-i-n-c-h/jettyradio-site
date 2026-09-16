import { driveDownloadUrl } from "./import-audio";
import { readLimited } from "./body";
import type { Env } from "./types";

import { client, type Media, type Playlist } from "./azura";
import { type Show } from "./data";
import { validateShows } from "./validation.mjs";
import {
  recurringFor,
  overlap,
  isPast,
  isNextOccurrence,
} from "./schedule-rules.mjs";
export async function schedule(request: Request, env: Env) {
  const azura = client(env);
  try {
    let payload: string, uploadedArt: File | undefined;
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.toLowerCase().startsWith("multipart/form-data;")) {
      const bytes = await readLimited(request, 10 * 1024 * 1024 + 32768);
      const multipart = await new Response(bytes as BodyInit, {
        headers: { "Content-Type": contentType },
      }).formData();
      const details = multipart.get("payload"),
        image = multipart.get("artwork");
      if (
        typeof details !== "string" ||
        details.length > 16384 ||
        multipart.getAll("payload").length !== 1 ||
        multipart.getAll("artwork").length !== 1 ||
        !(image instanceof File)
      )
        throw new Error("Choose the artwork image again before scheduling.");
      payload = details;
      uploadedArt = image;
    } else {
      payload = new TextDecoder().decode(await readLimited(request, 16384));
    }
    const body = JSON.parse(payload) as {
      showId: string;
      playlistId: number;
      expectedSchedule: string;
      expectedRevision: number;
      replaceSchedule?: boolean;
    };
    if (
      typeof body.showId !== "string" ||
      !Number.isSafeInteger(body.playlistId) ||
      typeof body.expectedSchedule !== "string" ||
      !Number.isSafeInteger(body.expectedRevision)
    )
      return Response.json(
        { error: "Choose a saved show, playlist, and audio file." },
        { status: 400 }
      );
    const row = await env.DB.prepare(
      "SELECT data, revision FROM desk WHERE id = ?"
    )
      .bind("jetty")
      .first<{ data: string; revision: number }>();
    if (!row || row.revision !== body.expectedRevision)
      throw new Error(
        "The saved plan changed. Reload the desk and review it before scheduling."
      );
    const show = (row ? JSON.parse(row.data).shows : []).find(
      (s: Show) => s.id === body.showId
    ) as Show | undefined;
    if (!show || show.status !== "ready")
      throw new Error(
        "Save the completed review as Ready for AzuraCast first."
      );
    validateShows([show]);
    if (
      show.artUploadName
        ? uploadedArt?.name !== show.artUploadName
        : uploadedArt
    )
      throw new Error(
        "The reviewed artwork is missing or changed. Choose the image again and review it before scheduling."
      );
    if (isPast(show))
      throw new Error(
        "Cannot schedule an episode at or before the current Pacific time."
      );
    if (
      !show.mediaId ||
      !show.mediaPath ||
      show.audioImportedFrom !== show.audio
    )
      throw new Error("Import this episode MP3 before submitting.");
    if (!show.directory) throw new Error("Choose the show media directory.");
    if (!isNextOccurrence(show))
      throw new Error(
        "Enabling this recurring slot would air the episode before its planned date. Submit closer to its next occurrence."
      );
    if (show.playlistId !== body.playlistId)
      throw new Error(
        "The selected playlist differs from the saved episode. Save and reload before submitting."
      );
    const [playlists, files, directoryData] = (await Promise.all([
      azura("/playlists"),
      azura("/files"),
      azura("/files/directories"),
    ])) as [Playlist[], Media[], { rows: { path: string }[] }];
    const playlist = playlists.find((p) => p.id === body.playlistId),
      file = files.find((f) => f.id === show.mediaId);
    if (!playlist || playlist.source !== "songs" || !file)
      throw new Error("Choose a song playlist and an existing audio file.");
    if (
      file.path !== show.mediaPath &&
      file.path !== `${show.directory}/${show.mediaPath.split("/").pop()}`
    )
      throw new Error(
        "The episode media location changed. Refresh its record before submitting."
      );
    if (!directoryData.rows.some((d) => d.path === show.directory))
      throw new Error("The selected show directory no longer exists.");
    if (JSON.stringify(playlist.schedule_items) !== body.expectedSchedule)
      throw new Error(
        "The live playlist schedule changed. Reload the connection before continuing."
      );
    const desired = recurringFor(playlist.schedule_items, show, body.replaceSchedule === true);
    if (playlist.is_enabled)
      throw new Error(
        "Choose a disabled playlist to avoid changing audio that is already on air."
      );
    if (playlist.schedule_items.length > 1)
      throw new Error(
        "This playlist has multiple schedule entries. Use AzuraCast to edit it without replacing other slots."
      );
    if (
      files.some(
        (f) => f.id !== file.id && f.playlists.some((p) => p.id === playlist.id)
      )
    )
      throw new Error(
        "This playlist still contains other episodes. Archive or remove those in AzuraCast first."
      );
    const duration =
      Number(show.end.slice(0, 2)) * 60 +
      Number(show.end.slice(3)) -
      (Number(show.start.slice(0, 2)) * 60 + Number(show.start.slice(3)));
    if (!Number.isFinite(file.length) || file.length <= 0)
      throw new Error(
        "AzuraCast has not reported a valid audio duration. Refresh the station connection and try again."
      );
    if (file.length > duration * 60 + 15)
      throw new Error(
        `The episode is ${Math.ceil(file.length - duration * 60)} seconds longer than the slot. Up to 15 seconds is allowed. Shorten the audio or confirm a longer slot.`
      );
    for (const p of playlists)
      if (
        p.id !== playlist.id &&
        p.is_enabled &&
        p.schedule_items.some((s) => overlap(s, show))
      )
        throw new Error(
          `The proposed time overlaps the active playlist ${p.name}.`
        );
    let artType: string, artBytes: Uint8Array;
    if (uploadedArt) {
      artType = uploadedArt.type.toLowerCase();
      if (
        !["image/jpeg", "image/png"].includes(artType) ||
        !uploadedArt.size ||
        uploadedArt.size > 10 * 1024 * 1024
      )
        throw new Error("Choose a JPEG or PNG artwork image up to 10 MB.");
      artBytes = new Uint8Array(await uploadedArt.arrayBuffer());
      const isImage =
        artType === "image/jpeg"
          ? artBytes[0] === 255 && artBytes[1] === 216 && artBytes[2] === 255
          : [137, 80, 78, 71, 13, 10, 26, 10].every(
              (byte, index) => artBytes[index] === byte
            );
      if (!isImage)
        throw new Error("The artwork file is not a valid JPEG or PNG image.");
    } else {
      const artwork = await fetch(driveDownloadUrl(show.art), {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      artType =
        artwork.headers
          .get("Content-Type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() || "";
      if (!artwork.ok || !["image/jpeg", "image/png"].includes(artType)) {
        await artwork.body?.cancel();
        const location = artwork.headers.get("Location");
        if (
          artwork.status >= 300 &&
          artwork.status < 400 &&
          location &&
          new URL(
            location,
            artwork.url || "https://drive.usercontent.google.com"
          ).origin === "https://accounts.google.com"
        )
          throw new Error(
            "This artwork requires Google sign-in. Drop the reviewed JPEG or PNG into the artwork area instead."
          );
        if (artwork.status === 401 || artwork.status === 403)
          throw new Error(
            "Google Drive denied the artwork download. Open the artwork link and check its sharing and download permissions."
          );
        if (!artwork.ok)
          throw new Error(
            "Google Drive could not return the artwork. Open the artwork link to check that the file is available, then try again."
          );
        throw new Error(
          "The artwork link did not return a JPEG or PNG image. Check the saved artwork file and its download permissions."
        );
      }
      artBytes = await readLimited(
        new Request("https://art.invalid", {
          method: "POST",
          body: artwork.body,
          duplex: "half",
        } as RequestInit),
        10 * 1024 * 1024
      );
    }
    const airDate = `${show.date.slice(5, 7)}/${show.date.slice(8, 10)}/${show.date.slice(0, 4)}`;
    await azura(`/file/${file.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: show.title,
        artist: show.artist,
        lyrics: show.tracklist || "",
        custom_fields: { ...file.custom_fields, air_date: airDate },
        playlists: [
          ...new Set([...file.playlists.map((p) => p.id), playlist.id]),
        ],
      }),
    });
    const artForm = new FormData();
    artForm.set(
      "file",
      new Blob([artBytes as BlobPart], { type: artType }),
      artType === "image/png" ? "art.png" : "art.jpg"
    );
    await azura(`/art/${file.id}`, { method: "POST", body: artForm });
    const filename = file.path.split("/").pop()!,
      newPath = `${show.directory}/${filename}`;
    if (file.path !== newPath) {
      const moved = (await azura("/files/batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          do: "move",
          files: [file.path],
          dirs: [],
          currentDirectory: file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "",
          directory: show.directory,
        }),
      })) as { errors?: unknown[] };
      if (moved.errors?.length)
        throw new Error(
          "AzuraCast could not move the episode to the show directory. The show playlist remains disabled."
        );
    }
    const assigned = (await azura(`/file/${file.id}`)) as Media;
    if (!assigned.playlists.some((p) => p.id === playlist.id))
      throw new Error(
        "AzuraCast did not confirm the audio assignment. The playlist remains disabled."
      );
    if (
      assigned.path !== newPath ||
      assigned.title !== show.title ||
      assigned.artist !== show.artist ||
      assigned.lyrics !== (show.tracklist || "") ||
      assigned.custom_fields?.air_date !== airDate
    )
      throw new Error(
        "Episode metadata or directory was not confirmed. The playlist remains disabled."
      );
    await azura(`/playlist/${playlist.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_enabled: true, schedule_items: [desired] }),
    });
    const verified = (await azura(`/playlist/${playlist.id}`)) as Playlist;
    if (
      !verified.is_enabled ||
      !verified.schedule_items.some(
        (s) =>
          s.start_time === desired.start_time &&
          s.end_time === desired.end_time &&
          !s.start_date &&
          !s.end_date &&
          JSON.stringify(s.days) === JSON.stringify(desired.days)
      )
    )
      throw new Error(
        "AzuraCast did not confirm the requested schedule. Check the station before retrying."
      );
    const stored = JSON.parse(row.data);
    stored.shows = stored.shows.map((episode: Show) =>
      episode.id === show.id
        ? {
            ...episode,
            mediaPath: newPath,
            scheduledAt: new Date().toISOString(),
          }
        : episode
    );
    stored.updatedAt = new Date().toISOString();
    const saved = await env.DB.prepare(
      "UPDATE desk SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?"
    )
      .bind(JSON.stringify(stored), "jetty", row.revision)
      .run();
    return Response.json({
      ok: true,
      planUpdated: saved.meta.changes === 1,
      playlist: verified.name,
      date: show.date,
      start: show.start,
      end: show.end,
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not confirm the AzuraCast change.",
      },
      { status: 400 }
    );
  }
}
