import type { Env } from "./types";
import type { Show } from "./data";
import { client, type Playlist, type Media } from "./azura";
import { readLimited } from "./body";
import { driveFile, driveVersion, googleToken, responseRows } from "./google";
import { driveDownloadUrl, importAudio } from "./import-audio";
import { parseResponses, matchSubmission, type Submission } from "./submission-rules";
import { seedWeek } from "./seed";
import { validateShows } from "./validation.mjs";

type Import = {
  id: string; payload: string; state: string; show_id: string | null; upload_id: string;
  chunk: number; size: number; modified: string; media_id: number | null;
  media_path: string | null; error: string; updated_at: string;
  source_version: string; upload_name: string;
};
type Plan = { shows: Show[]; updatedAt?: string; updatedBy?: string };
const request = (body: unknown) => new Request("https://desk.invalid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const normalized = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const timestamp = () => new Date().toISOString();
const completed = (value: string) => /^(scheduled|complete|completed|yes|true|archived)$/i.test(value.trim());
async function planRow(env: Env) {
  const row = await env.DB.prepare("SELECT data, revision FROM desk WHERE id = ?").bind("jetty").first<{ data: string; revision: number }>();
  if (!row) throw new Error("Open the desk to load calendar episodes first.");
  return { plan: JSON.parse(row.data) as Plan, revision: row.revision };
}
async function save(env: Env, plan: Plan, revision: number) {
  validateShows(plan.shows);
  plan.updatedAt = timestamp();
  plan.updatedBy = "submission-import";
  const result = await env.DB.prepare("UPDATE desk SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
    .bind(JSON.stringify(plan), "jetty", revision).run();
  if (result.meta.changes !== 1) throw new Error("A scheduler changed the desk. Retry after reviewing the episode.");
}

async function attach(env: Env, item: Import, selectedId?: string) {
  const submission = JSON.parse(item.payload) as Submission;
  driveDownloadUrl(submission.audio);
  driveDownloadUrl(submission.art);
  const { plan, revision } = await planRow(env);
  const already = plan.shows.find(s => s.submissionId === item.id);
  if (already) {
    if (selectedId && selectedId !== already.id) throw new Error("This submission already belongs to another episode.");
    return already.id;
  }
  const candidates = selectedId ? plan.shows.filter(s => s.id === selectedId) : plan.shows;
  const label = selectedId && candidates[0]
    ? (candidates[0].artist ? `${candidates[0].title} w/ ${candidates[0].artist}` : candidates[0].title)
    : submission.label;
  const episode = matchSubmission({ ...submission, label }, candidates);
  const azura = client(env);
  const [playlists, directories] = await Promise.all([
    azura("/playlists") as Promise<Playlist[]>,
    azura("/files/directories") as Promise<{ rows: { name: string; path: string }[] }>,
  ]);
  const names = [normalized(episode.title), normalized(label)];
  const matches = playlists.filter(p => p.source === "songs" && !p.is_enabled && names.includes(normalized(p.name)));
  const folders = directories.rows.filter(d => normalized(d.name) === normalized(episode.title));
  const updated: Show = {
    ...episode, audio: submission.audio, art: submission.art, tracklist: submission.tracklist,
    notes: submission.notes, submissionId: item.id, status: "draft",
    dateConfirmed: false, audioReviewed: false, artReviewed: false,
    uploadName: `${episode.title.slice(0, 140)} - ${episode.date}`,
    ...(matches.length === 1 ? { playlistId: matches[0].id } : {}),
    ...(folders.length === 1 ? { directory: folders[0].path } : {}),
  };
  plan.shows = plan.shows.map(s => s.id === episode.id ? updated : s);
  await save(env, plan, revision);
  return episode.id;
}

export async function submissionStatus(env: Env) {
  const sync = await env.DB.prepare("SELECT * FROM submission_sync WHERE id = ?").bind("jetty").first();
  const rows = await env.DB.prepare("SELECT * FROM submission_imports WHERE state != 'ignored' ORDER BY updated_at DESC").all<Import>();
  return Response.json({ enabled: env.SUBMISSIONS_ENABLED === "true", sync, submissions: rows.results.map(item => ({
    id: item.id, ...JSON.parse(item.payload), state: item.state, showId: item.show_id,
    mediaPath: item.media_path, error: item.error, updatedAt: item.updated_at,
    progress: item.size ? Math.min(100, Math.floor((item.chunk - 1) * 1024 * 1024 / item.size * 100)) : 0,
  })) });
}

export async function assignSubmission(req: Request, env: Env) {
  const body = JSON.parse(new TextDecoder().decode(await readLimited(req, 4096)));
  if (typeof body.id !== "string" || typeof body.showId !== "string") throw new Error("Choose a submission and episode.");
  const item = await env.DB.prepare("SELECT * FROM submission_imports WHERE id = ?").bind(body.id).first<Import>();
  if (!item || item.state === "ignored" || item.state === "imported") throw new Error("This submission is not waiting for import.");
  if (env.SUBMISSIONS_ENABLED !== "true") throw new Error("Enable automatic imports before assigning a submission.");
  const showId = await attach(env, item, body.showId);
  await env.DB.prepare("UPDATE submission_imports SET show_id = ?, state = 'uploading', error = '', updated_at = ? WHERE id = ?")
    .bind(showId, timestamp(), item.id).run();
  return Response.json({ ok: true });
}

async function discover(env: Env, token: string) {
  const submissions = await parseResponses(await responseRows(env, token));
  const sync = await env.DB.prepare("SELECT initialized, ignored_ids FROM submission_sync WHERE id = ?").bind("jetty").first<{ initialized: number; ignored_ids: string }>();
  if (!sync?.initialized) {
    await env.DB.prepare("INSERT INTO submission_sync (id, initialized, ignored_ids, checked_at) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET initialized = 1, ignored_ids = excluded.ignored_ids, checked_at = excluded.checked_at, error = ''")
      .bind("jetty", JSON.stringify(submissions.map(s => s.id)), timestamp()).run();
    return;
  }
  const ignored = new Set(JSON.parse(sync.ignored_ids) as string[]);
  const saved = await env.DB.prepare("SELECT * FROM submission_imports").all<Import>();
  const imports = new Map(saved.results.map(item => [item.id, item]));
  let changes = 0;
  for (const submission of submissions) {
    if (ignored.has(submission.id)) continue;
    const existing = imports.get(submission.id);
    if (!existing) {
      await env.DB.prepare("INSERT OR IGNORE INTO submission_imports (id, payload, state, upload_id, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(submission.id, JSON.stringify(submission), completed(submission.completed) ? "ignored" : "pending", crypto.randomUUID(), timestamp()).run();
      changes++;
    } else if (!existing.show_id && existing.state !== "ignored" && existing.payload !== JSON.stringify(submission)) {
      await env.DB.prepare("UPDATE submission_imports SET payload = ?, state = ?, error = '' WHERE id = ?")
        .bind(JSON.stringify(submission), completed(submission.completed) ? "ignored" : "pending", submission.id).run();
      changes++;
    } else if (existing.show_id && existing.state !== "imported" && existing.state !== "needs_review") {
      const previous = JSON.parse(existing.payload) as Submission;
      if (completed(submission.completed) || ["audio", "art", "tracklist", "notes"].some(key => previous[key as keyof Submission] !== submission[key as keyof Submission])) {
        await env.DB.prepare("UPDATE submission_imports SET state = 'needs_review', error = ?, updated_at = ? WHERE id = ?")
          .bind("The source response changed or was marked completed. Review it manually; the saved episode was not overwritten.", timestamp(), existing.id).run();
        changes++;
      }
    }
    if (changes >= 10) break;
  }
  await env.DB.prepare("INSERT INTO submission_sync (id, initialized, checked_at, error) VALUES (?, 1, ?, '') ON CONFLICT(id) DO UPDATE SET initialized = 1, checked_at = excluded.checked_at, error = ''")
    .bind("jetty", timestamp()).run();
}

async function advance(env: Env, token: string, item: Import, deadline: number) {
  const submission = JSON.parse(item.payload) as Submission;
  if (!item.show_id) {
    item.show_id = await attach(env, item);
    await env.DB.prepare("UPDATE submission_imports SET show_id = ?, state = 'uploading' WHERE id = ?").bind(item.show_id, item.id).run();
  }
  const version = await driveVersion(submission.audio, token);
  if (item.source_version && item.source_version !== version) throw new Error("The source MP3 changed during import. Use the manual upload flow for the replacement.");
  item.source_version = version;
  await env.DB.prepare("UPDATE submission_imports SET source_version = ? WHERE id = ?").bind(version, item.id).run();
  for (let count = 0; count < 8 && Date.now() < deadline; count++) {
    const { plan, revision } = await planRow(env);
    const show = plan.shows.find(s => s.id === item.show_id);
    if (!show || show.submissionId !== item.id || show.audio !== submission.audio || show.art !== submission.art || show.status !== "draft" || show.scheduledAt || show.audioReviewed || show.artReviewed || show.dateConfirmed)
      throw new Error("The episode changed during import. Review its assets before retrying; scheduler changes were preserved.");
    if (show.mediaId && show.mediaId !== item.media_id) throw new Error("The episode already has another MP3. It was not replaced.");
    if (item.upload_name && item.upload_name !== show.uploadName) throw new Error("The upload filename changed. Restore it before retrying this import.");
    if (!item.upload_name) {
      item.upload_name = show.uploadName!;
      await env.DB.prepare("UPDATE submission_imports SET upload_name = ? WHERE id = ?").bind(item.upload_name, item.id).run();
    }
    if (!item.media_id) {
      const response = await importAudio(request({ showId: show.id, revision, uploadId: item.upload_id, chunk: item.chunk, size: item.size, modified: item.modified }), env, token);
      const result = await response.json() as { error?: string; size: number; modified: string; complete?: boolean; id?: number; path?: string };
      if (!response.ok) throw new Error(result.error || "Audio import failed.");
      item.size = result.size;
      item.modified = result.modified;
      if (result.complete) {
        if (!result.id || !result.path) throw new Error("AzuraCast did not confirm the uploaded MP3.");
        item.media_id = result.id; item.media_path = result.path;
      } else item.chunk++;
      await env.DB.prepare("UPDATE submission_imports SET chunk = ?, size = ?, modified = ?, media_id = ?, media_path = ?, error = '', updated_at = ? WHERE id = ?")
        .bind(item.chunk, item.size, item.modified, item.media_id, item.media_path, timestamp(), item.id).run();
      if (!item.media_id) continue;
    }
    const azura = client(env);
    if (await driveVersion(submission.audio, token) !== item.source_version) throw new Error("The source MP3 changed during import. Its upload was not attached to the episode.");
    const media = await azura(`/file/${item.media_id}`) as Media;
    if (media.path !== item.media_path || media.playlists.length) throw new Error("The imported MP3 was moved or assigned in AzuraCast. Review it before retrying.");
    const art = await driveFile(submission.art, token);
    const type = art.headers.get("Content-Type")?.split(";")[0].toLowerCase();
    if (!art.ok || !type || !["image/jpeg", "image/png"].includes(type)) {
      await art.body?.cancel();
      throw new Error("Cannot download artwork. Share the Drive JPEG/PNG with the service account.");
    }
    const bytes = await readLimited(art, 10 * 1024 * 1024);
    const valid = type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b);
    if (!valid) throw new Error("Artwork is not a valid JPEG or PNG.");
    const form = new FormData(); form.set("file", new Blob([bytes as BlobPart], { type }), type === "image/png" ? "art.png" : "art.jpg");
    await azura(`/art/${item.media_id}`, { method: "POST", body: form });
    const latest = await planRow(env);
    const current = latest.plan.shows.find(s => s.id === show.id);
    if (JSON.stringify(current) !== JSON.stringify(show)) throw new Error("The episode changed during import. Its edits were preserved; retry after reviewing.");
    latest.plan.shows = latest.plan.shows.map(s => s.id === show.id ? { ...s, mediaId: item.media_id!, mediaPath: item.media_path!, audioImportedFrom: s.audio } : s);
    await save(env, latest.plan, latest.revision);
    const warning = !show.playlistId || !show.directory ? "Choose the show playlist and folder in the episode before scheduling." : "";
    await env.DB.prepare("UPDATE submission_imports SET state = 'imported', error = ?, updated_at = ? WHERE id = ?").bind(warning, timestamp(), item.id).run();
    return;
  }
}

export async function syncSubmissions(env: Env) {
  if (env.SUBMISSIONS_ENABLED !== "true") return;
  const owner = crypto.randomUUID(), now = Date.now();
  const lock = await env.DB.prepare("INSERT INTO locks (id, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE locks.expires_at < ?")
    .bind("station", owner, now + 300000, now).run();
  if (lock.meta.changes !== 1) return;
  try {
    const token = await googleToken(env);
    await discover(env, token);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    for (const offset of [0, 7]) {
      const start = new Date(today + "T12:00:00Z"); start.setUTCDate(start.getUTCDate() + offset);
      const response = await seedWeek(request({ week: start.toISOString().slice(0, 10) }), env, "submission-import");
      if (!response.ok) throw new Error("Cannot refresh the calendar. Imports will retry after it becomes available.");
    }
    const pending = await env.DB.prepare("SELECT * FROM submission_imports WHERE state IN ('pending', 'uploading') ORDER BY updated_at ASC LIMIT 1").first<Import>();
    if (pending) {
      try { await advance(env, token, pending, Date.now() + 90000); }
      catch (error) {
        await env.DB.prepare("UPDATE submission_imports SET state = 'needs_review', error = ?, updated_at = ? WHERE id = ?")
          .bind(error instanceof Error ? error.message : "Import failed. Review the submission.", timestamp(), pending.id).run();
      }
    }
  } catch (error) {
    await env.DB.prepare("INSERT INTO submission_sync (id, error) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET error = excluded.error")
      .bind("jetty", error instanceof Error ? error.message : "Submission sync failed.").run();
  } finally {
    await env.DB.prepare("DELETE FROM locks WHERE id = ? AND owner = ?").bind("station", owner).run();
  }
}
