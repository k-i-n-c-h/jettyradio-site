import { $sessionStore } from "@clerk/astro/client";
import type { Show } from "../../../desk-worker/src/data";
import { hasAired, scheduleMismatch } from "../../../desk-worker/src/schedule-rules.mjs";
import type {
  AzuraShow as Media,
  AzuraPlaylist as Playlist,
} from "../azuracast/types";
import {
  validateShows,
  mp3Filename,
} from "../../../desk-worker/src/validation.mjs";
type State = {
  shows: Show[];
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
};
const root = document.querySelector<HTMLElement>("#desk")!;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const form = $<HTMLFormElement>("desk-form"),
  dialog = $<HTMLDialogElement>("desk-editor");
let state: State | null = null,
  editing: Show | null = null,
  playlists: Playlist[] = [],
  existingAudio: Media[] = [],
  uploadId = "",
  replacingAudio = false,
  activeSection = 1,
  suggestedUploadName = "",
  artworkFile: File | null = null,
  artworkPreviewUrl = "",
  busy = false,
  scheduleApproval = "";
const field = (name: string) =>
  form.elements.namedItem(name) as HTMLInputElement;
const week = $<HTMLInputElement>("desk-week");
const now = new Date();
now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
week.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const message = (id: string, text: string, error = false) => {
  const el = $(id);
  el.textContent = text;
  el.className = error ? "desk-error" : "";
};
const text = (tag: string, value: string) => {
  const el = document.createElement(tag);
  el.textContent = value;
  return el;
};
const status = (s: Show) =>
  s.status === "archived"
    ? "Archived"
    : s.scheduledAt
      ? "Scheduled in AzuraCast"
      : s.status === "ready"
        ? "Ready to schedule"
        : s.mediaId
          ? "MP3 attached"
          : s.audio
          ? "Needs review"
          : "Awaiting audio";
async function api(path: string, init: RequestInit = {}) {
  const base = root.dataset.api;
  if (!base)
    throw new Error(
      "The desk backend is not configured yet. The site administrator needs to set PUBLIC_DESK_API_URL."
    );
  const url = new URL(base);
  if (
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  )
    throw new Error("The desk needs a secure backend URL.");
  const token = await $sessionStore.get()?.getToken();
  if (!token) throw new Error("Sign in to Jetty Backstage to use the desk.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  let r: Response;
  try {
    r = await fetch(new URL(path, url), { ...init, headers });
  } catch {
    throw new Error(
      "The desk backend is unavailable. Wait a moment, then retry."
    );
  }
  const result = await r.json();
  if (!r.ok)
    throw new Error(result.error || `Desk request failed (${r.status}).`);
  return result;
}
function visible() {
  if (!state || !week.value) return [];
  const end = new Date(week.value + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  return state.shows
    .filter(
      (s) => s.date >= week.value && s.date <= end.toISOString().slice(0, 10)
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
    );
}
function render() {
  const rows = visible(),
    list = $("desk-shows");
  list.replaceChildren();
  $("desk-count").textContent = `${rows.length} episodes`;
  $("desk-summary").textContent =
    `${rows.filter((s) => s.audio && s.status === "draft").length} submissions to review · ${rows.filter((s) => !s.audio && !s.mediaId && s.status !== "archived").length} awaiting audio.`;
  if (!rows.length)
    list.append(
      text("p", "No episodes this week. Choose another week or add an episode.")
    );
  for (const show of rows) {
    const row = document.createElement("div");
    row.className = "desk-row";
    const date = text(
      "time",
      `${new Date(show.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" })}\n${show.start}–${show.end}`
    );
    date.style.whiteSpace = "pre-line";
    const title = document.createElement("span");
    title.append(
      text("strong", show.title),
      text("small", `${show.artist} · ${show.owner || "Unassigned"}`)
    );
    const badge = text("span", status(show));
    badge.className = "desk-badge";
    title.append(badge);
    const actions = document.createElement("div");
    actions.className = "desk-row-actions";
    for (const action of ["Schedule", "Archive"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline";
      button.textContent = action;
      button.setAttribute("aria-label", `${action} ${show.title} (${show.date})`);
      button.dataset.unavailable = String(action === "Schedule" && show.status === "archived");
      button.disabled = busy || button.dataset.unavailable === "true";
      button.addEventListener("click", () => {
        if (!busy) open(show, action === "Archive" ? "archive" : "schedule");
      });
      actions.append(button);
    }
    row.append(date, title, actions);
    list.append(row);
  }
}
function link(name: string) {
  const a = $<HTMLAnchorElement>(`desk-${name}-link`);
  const value = field(name).value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    a.href = url.href;
    a.hidden = false;
  } catch {
    a.removeAttribute("href");
    a.hidden = true;
  }
}
function open(show: Show, action: "schedule" | "archive" = "schedule") {
  if (action === "archive") {
    openArchive(show);
    return;
  }
  editing = { ...show };
  replacingAudio = false;
  scheduleApproval = "";
  form.reset();
  clearArtworkPreview();
  field("tracklist").value = show.tracklist || "";
  uploadId = crypto.randomUUID();
  $("editor-heading").textContent = show.title || "Add episode";
  for (const [key, value] of Object.entries(show)) {
    const el = form.elements.namedItem(key) as HTMLInputElement | null;
    if (!el) continue;
    if (el.type === "checkbox") el.checked = value === true;
    else el.value = String(value);
  }
  link("audio");
  link("art");
  suggestedUploadName = `${(show.title || "Episode").slice(0, 140)} - ${show.date}`;
  field("uploadName").value = show.uploadName || suggestedUploadName;
  message("desk-form-status", "");
  message("desk-import-status", "");
  message("desk-station-status", "");
  message("desk-archive-status", "");
  $("desk-station").hidden = true;
  playlists = [];
  $<HTMLSelectElement>("desk-playlist").replaceChildren(new Option("Choose this show’s playlist", ""));
  $<HTMLSelectElement>("desk-directory").replaceChildren(new Option("Choose this show’s folder", ""));
  existingAudio = [];
  selectAudioSource(show.mediaId ? "existing" : "drive");
  $<HTMLInputElement>("desk-audio-search").value = "";
  $<HTMLSelectElement>("desk-reconcile-playlist").replaceChildren(new Option("Find uploaded MP3s first", ""));
  renderExistingAudio();
  audioSummary();
  artworkSummary();
  dialog.showModal();
  const progress = episodeProgress();
  openSection(show.scheduledAt || show.status === "archived" ? 4 : Math.max(1, progress.findIndex((done) => !done) + 1), false);
  buttons();
}
function reviewed() {
  return (
    ["dateConfirmed", "audioReviewed", "artReviewed"].every(
      (k) => field(k).checked
    ) &&
    !!field("audio").value &&
    (editing?.artUploadName ? !!artworkFile : !!field("art").value)
  );
}
function selectAudioSource(source: "drive" | "computer" | "existing") {
  for (const name of ["drive", "computer", "existing"] as const) {
    $("desk-source-" + name).setAttribute("aria-pressed", String(name === source));
    $("desk-source-panel-" + name).hidden = name !== source;
  }
  $("desk-file-settings").hidden = source === "existing";
  $("desk-audio-link-hint").textContent = source === "existing"
    ? "Optional when using an MP3 already in AzuraCast."
    : source === "computer" ? "Keep the original episode link for your records, then choose the downloaded MP3 below."
    : "Google Drive link to the episode MP3.";
  $(source === "drive" ? "desk-import" : source === "computer" ? "desk-upload" : "desk-use-audio").after($("desk-import-status"));
}
for (const source of ["drive", "computer", "existing"] as const)
  $("desk-source-" + source).addEventListener("click", () => {
    if (!busy) selectAudioSource(source);
  });
function nextAudioStep() {
  if (!field("dateConfirmed").checked) return "Confirm episode details in step 1, then review the audio.";
  if (!field("audioReviewed").checked) return "Listen to the MP3, then confirm your audio review to continue to artwork.";
  if (!episodeProgress()[2]) return "Continue to step 3 to review the artwork.";
  return "Continue to step 4 to review and schedule the episode.";
}
function audioSummary() {
  const saved = state?.shows.find((s) => s.id === editing?.id);
  $("desk-media").textContent =
    saved?.mediaId && saved.audioImportedFrom === field("audio").value
      ? `Uploaded to AzuraCast: ${saved.mediaPath}. ${saved.status === "archived" ? "Archived." : saved.scheduledAt ? "Scheduled." : nextAudioStep()}`
      : field("audio").value.trim()
        ? "Episode audio hasn’t been uploaded yet."
        : "Add the episode MP3 link above to upload.";
}
function clearArtworkPreview() {
  if (artworkPreviewUrl) URL.revokeObjectURL(artworkPreviewUrl);
  artworkFile = null;
  artworkPreviewUrl = "";
  const preview = $<HTMLImageElement>("desk-art-preview");
  preview.removeAttribute("src");
  preview.hidden = true;
  $<HTMLInputElement>("desk-art-file").value = "";
}
function artworkSummary() {
  message(
    "desk-art-status",
    editing?.status === "archived"
      ? "Artwork remains attached to the archived episode in AzuraCast."
      : editing?.scheduledAt
        ? "Artwork is saved in AzuraCast. No image upload is needed to archive this episode."
        : artworkFile
          ? `${artworkFile.name} selected. It will upload when you schedule. If you close or reload this form first, choose the image again.`
          : editing?.artUploadName
            ? `Choose ${editing.artUploadName} again to finish scheduling; saved drafts keep the image name only.`
            : "JPEG or PNG · up to 10 MB. The image uploads when you schedule the episode."
  );
  $("desk-art-remove").hidden = !artworkFile && !editing?.artUploadName;
}
function selectArtwork(file: File) {
  if (busy || !editing) return;
  field("artReviewed").checked = false;
  buttons();
  if (
    !["image/jpeg", "image/png"].includes(file.type.toLowerCase()) ||
    !file.size ||
    file.size > 10 * 1024 * 1024 ||
    file.name.length > 255
  ) {
    message("desk-art-status", "Choose a JPEG or PNG image up to 10 MB.", true);
    return;
  }
  clearArtworkPreview();
  artworkFile = file;
  editing.artUploadName = file.name;
  field("artReviewed").checked = false;
  artworkPreviewUrl = URL.createObjectURL(file);
  const preview = $<HTMLImageElement>("desk-art-preview");
  preview.src = artworkPreviewUrl;
  preview.hidden = false;
  artworkSummary();
  buttons();
}
function scheduleKey() {
  return JSON.stringify([
    editing?.id,
    field("date").value, field("start").value, field("end").value,
    $<HTMLSelectElement>("desk-playlist").value,
    playlists.find((p) => p.id === Number($<HTMLSelectElement>("desk-playlist").value))?.schedule_items,
  ]);
}
function scheduleComparison() {
  const playlist = playlists.find((p) => p.id === Number($<HTMLSelectElement>("desk-playlist").value));
  const valid = ["date", "start", "end"].every((name) => field(name).value && field(name).validity.valid);
  const mismatch = playlist && valid ? scheduleMismatch(playlist.schedule_items, {
    date: field("date").value, start: field("start").value, end: field("end").value,
  }) : "";
  const approved = scheduleApproval === scheduleKey();
  message("desk-schedule-comparison", approved && mismatch
    ? `When you schedule, the playlist’s recurring slot will change to ${new Date(field("date").value + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}, ${field("start").value}–${field("end").value} Pacific, every week.`
    : mismatch, !!mismatch && !approved);
  $("desk-fix-schedule").hidden = !mismatch || approved || playlist!.schedule_items.length > 1;
  $<HTMLButtonElement>("desk-fix-schedule").disabled = busy;
  return !!mismatch && !approved;
}
function episodeProgress() {
  const saved = state?.shows.find((s) => s.id === editing?.id);
  return [
    field("dateConfirmed").checked && ["title", "artist", "date", "start", "end"].every((name) => field(name).value.trim() && field(name).validity.valid),
    !!saved?.mediaId && saved.audioImportedFrom === field("audio").value && field("audioReviewed").checked && !replacingAudio,
    field("artReviewed").checked && (editing?.artUploadName ? !!artworkFile : !!field("art").value),
    !!saved?.scheduledAt,
  ];
}
function openSection(index: number, focus = true) {
  activeSection = index;
  for (let step = 1; step <= 4; step++)
    $<HTMLDetailsElement>(`desk-section-${step}`).open = step === index;
  if (focus) {
    const summary = $(`desk-section-${index}`).querySelector("summary")!;
    summary.focus();
    summary.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  updateProgress();
}
function updateProgress() {
  const done = episodeProgress();
  const saved = state?.shows.find((s) => s.id === editing?.id);
  const hints = [
    `${field("date").value || "Choose a date"} · ${field("start").value}–${field("end").value} Pacific`,
    saved?.mediaId && saved.audioImportedFrom === field("audio").value ? (replacingAudio ? "Replacement upload in progress" : "MP3 attached · " + (done[1] ? "reviewed" : "audio review needed")) : "Upload from Drive, your computer, or retrieve a file",
    done[2] ? "Artwork reviewed" : artworkFile || field("art").value ? "Artwork selected · review needed" : "Add artwork and an optional tracklist",
    saved?.scheduledAt ? "Scheduled in AzuraCast" : "Confirm the playlist, folder, and air time",
  ];
  done.forEach((complete, i) => {
    $(`desk-section-${i + 1}`).dataset.complete = String(complete);
    $(`desk-progress-${i + 1}`).textContent = hints[i];
  });
  $("desk-episode-summary").textContent = `${done.slice(0, 3).filter(Boolean).length} of 3 preparation steps complete · ${status(saved || editing!)}`;
  $("desk-ready-summary").textContent = `${field("title").value || "Episode"} · ${field("artist").value || "Artist"}\n${hints[0]}\n${done.slice(0, 3).every(Boolean) ? "Review complete. Check the show’s playlist and folder below." : "Still needed: " + ["confirmed episode details", saved?.mediaId && saved.audioImportedFrom === field("audio").value ? "audio review" : "uploaded and reviewed audio", "reviewed artwork"].filter((_, i) => !done[i]).join(", ") + "."}`;
  $("desk-continue").hidden = activeSection === 4;
  $("desk-continue").textContent = ["", "Confirm details & continue to audio →", "Confirm audio review & continue to artwork →", "Confirm artwork & review episode →"][activeSection] || "Continue";
  $("desk-confirm-description").textContent = ["", "By continuing, you confirm the show details and Pacific air time are correct.", "By continuing, you confirm you’ve listened to the full MP3 and checked its duration, playback, and clipping.", "By continuing, you confirm the artwork shows the correct episode information. The tracklist is optional.", "Scheduling changes the live station. Review the episode and destination before submitting."][activeSection];
  $("desk-back").hidden = activeSection === 1;
  $<HTMLButtonElement>("desk-back").disabled = busy;
  $<HTMLButtonElement>("desk-continue").disabled = busy;
  $("desk-schedule").hidden = activeSection !== 4;
}
function buttons() {
  if (editing) updateProgress();
  const scheduleBlocked = scheduleComparison();
  for (const id of [
    "desk-week",
    "desk-previous-week",
    "desk-next-week",
    "desk-add",
  ])
    $<HTMLInputElement>(id).disabled = busy || !state;
  for (const row of document.querySelectorAll<HTMLButtonElement>(".desk-row-actions button"))
    row.disabled = busy || row.dataset.unavailable === "true";
  for (const id of [
    "desk-save",
    "desk-source-drive",
    "desk-source-computer",
    "desk-source-existing",
    "desk-connect",
    "desk-import",
    "desk-find-audio",
    "desk-use-audio",
    "desk-reconcile",
    "desk-upload",
    "desk-schedule",
    "desk-art-choose",
    "desk-art-remove",
    "desk-archive",
  ])
    $<HTMLButtonElement>(id).disabled = busy;
  $<HTMLInputElement>("desk-art-file").disabled = busy;
  const saved = state?.shows.find((s) => s.id === editing?.id);
  const archived = saved?.status === "archived";
  archiveButtons();
  for (const step of form.querySelectorAll<HTMLFieldSetElement>("fieldset"))
    step.disabled = !!archived;
  $<HTMLButtonElement>("desk-save").disabled = busy || !!archived;
  $<HTMLButtonElement>("desk-continue").disabled = busy || !!archived;
  const uploaded = !!(
    saved?.mediaId && saved.audioImportedFrom === field("audio").value
  );
  $("desk-reupload").hidden = !uploaded;
  $<HTMLButtonElement>("desk-reupload").disabled = busy || !!archived || !!saved?.scheduledAt;
  $("desk-reupload").textContent = replacingAudio ? "Keep existing upload" : "Upload episode again";
  const uploadAttached = uploaded && !replacingAudio;
  $("desk-import").hidden = uploadAttached;
  field("uploadName").readOnly = busy || uploadAttached;
  let validName = true;
  try {
    const filename = mp3Filename(field("uploadName").value, uploadId);
    $("desk-filename").textContent = uploadAttached
      ? "The MP3 name was set when it was uploaded."
      : `AzuraCast filename: ${filename}`;
    field("uploadName").setCustomValidity("");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Enter an MP3 name.";
    $("desk-filename").textContent = message;
    field("uploadName").setCustomValidity(message);
    validName = false;
  }
  $<HTMLButtonElement>("desk-import").disabled =
    busy ||
    !validName ||
    !field("audio").value.trim() ||
    uploadAttached;
  $<HTMLButtonElement>("desk-upload").disabled =
    busy ||
    !validName ||
    uploadAttached ||
    !field("audio").value.trim() ||
    !$<HTMLInputElement>("desk-upload-file").files?.length;
  $<HTMLButtonElement>("desk-use-audio").disabled =
    busy || !!archived || !!saved?.scheduledAt ||
    !$<HTMLSelectElement>("desk-existing-audio").value;
  $<HTMLButtonElement>("desk-reconcile").disabled = busy || !!archived || !field("dateConfirmed").checked || !$<HTMLSelectElement>("desk-existing-audio").value || !$<HTMLSelectElement>("desk-reconcile-playlist").value;
  $<HTMLButtonElement>("desk-schedule").disabled =
    busy ||
    scheduleBlocked ||
    replacingAudio ||
    !!archived ||
    !reviewed() ||
    !saved?.mediaId ||
    saved.audioImportedFrom !== field("audio").value ||
    !$<HTMLSelectElement>("desk-playlist").value ||
    !$<HTMLSelectElement>("desk-directory").value;
}
async function operation(id: string, fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  buttons();
  message(id, "Working…");
  try {
    await fn();
  } catch (e) {
    message(id, e instanceof Error ? e.message : "Request failed.", true);
  } finally {
    busy = false;
    buttons();
  }
}
async function reload() {
  await operation("desk-status", async () => {
    state = await api("/api/desk");
    render();
    message("desk-status", "Checking Jetty’s calendar for this week…");
    const result = (await api("/api/desk/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week: week.value }),
    })) as State & { added: number; warnings: string[] };
    state = result;
    render();
    message(
      "desk-status",
      [
        result.added
          ? `Added ${result.added} episode${result.added === 1 ? "" : "s"} from Jetty’s calendar. New episodes are awaiting audio.`
          : "Calendar checked. Your saved episodes are up to date for this week.",
        ...result.warnings,
      ].join(" "),
      result.warnings.length > 0
    );
  });
}
async function station() {
  scheduleApproval = "";
  const data = (await api("/api/azura")) as {
    connected: boolean;
    files: Media[];
    playlists: Playlist[];
    directories: { name: string; path: string }[];
  };
  if (!data.connected)
    throw new Error("The station connection is not configured.");
  playlists = data.playlists;
  const p = $<HTMLSelectElement>("desk-playlist"),
    d = $<HTMLSelectElement>("desk-directory");
  const saved = state?.shows.find((s) => s.id === editing?.id);
  p.replaceChildren(new Option("Choose this show's disabled playlist", ""));
  d.replaceChildren(new Option("Choose this show's folder", ""));
  for (const item of playlists.filter(
    (p) => p.source === "songs" && !p.is_enabled
  ))
    p.add(new Option(item.name, String(item.id)));
  for (const item of data.directories) d.add(new Option(item.name, item.path));
  if (saved?.playlistId) p.value = String(saved.playlistId);
  if (saved?.directory) d.value = saved.directory;
  if (!p.value) {
    const matching = playlists.filter(
      (p) =>
        p.source === "songs" &&
        !p.is_enabled &&
        p.name.toLowerCase().includes(field("title").value.toLowerCase())
    );
    if (matching.length === 1) p.value = String(matching[0].id);
  }
  if (!d.value) {
    const matching = data.directories.filter((d) =>
      d.name.toLowerCase().includes(field("title").value.toLowerCase())
    );
    if (matching.length === 1) d.value = matching[0].path;
  }
  $("desk-station").hidden = false;
  audioSummary();
  message(
    "desk-station-status",
    "Connected to Jetty Radio. Check the playlist and folder belong to this show."
  );
  buttons();
}
function readEpisode() {
  if (!editing) throw new Error("Select an episode.");
  const episode = { ...editing };
  for (const key of [
    "title",
    "artist",
    "date",
    "start",
    "end",
    "owner",
    "audio",
    "art",
    "notes",
    "tracklist",
  ] as const)
    (episode as unknown as Record<string, unknown>)[key] = field(key).value;
  for (const key of ["dateConfirmed", "audioReviewed", "artReviewed"] as const)
    episode[key] = field(key).checked;
  episode.uploadName = field("uploadName").value.trim();
  episode.status =
    editing.status === "archived" ? "archived" : reviewed() ? "ready" : "draft";
  if (episode.audio !== episode.audioImportedFrom) {
    delete episode.mediaId;
    delete episode.mediaPath;
    delete episode.audioImportedFrom;
  }
  const playlistId = Number($<HTMLSelectElement>("desk-playlist").value);
  if (playlistId) episode.playlistId = playlistId;
  const directory = $<HTMLSelectElement>("desk-directory").value;
  if (directory) episode.directory = directory;
  return episode;
}
async function saveEpisode(episode = readEpisode()) {
  if (!state) throw new Error("Load the desk first.");
  const shows = state.shows.some((s) => s.id === episode.id)
    ? state.shows.map((s) => (s.id === episode.id ? episode : s))
    : [...state.shows, episode];
  validateShows(shows);
  state = await api("/api/desk", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shows, revision: state.revision }),
  });
  editing = episode;
  render();
  audioSummary();
  return episode;
}
async function attachAudio(
  episode: Show,
  result: { id?: number; path?: string }
) {
  if (!result.id || !result.path)
    throw new Error("AzuraCast did not confirm the MP3 upload.");
  const replaced = !!episode.mediaId && episode.mediaId !== result.id;
  await saveEpisode({
    ...episode,
    ...(replaced ? { audioReviewed: false, status: "draft" as const } : {}),
    mediaId: result.id,
    mediaPath: result.path,
    audioImportedFrom: episode.audio,
  });
  replacingAudio = false;
  if (replaced) field("audioReviewed").checked = false;
  message(
    "desk-import-status",
    replaced
      ? `New MP3 attached. ${nextAudioStep()} The previous file remains in AzuraCast.`
      : `Episode MP3 uploaded to AzuraCast. ${nextAudioStep()}`
  );
}
function renderExistingAudio() {
  const select = $<HTMLSelectElement>("desk-existing-audio");
  const selected = select.value;
  const query = $<HTMLInputElement>("desk-audio-search").value.trim().toLowerCase();
  const matches = existingAudio.filter((file) =>
    `${file.path} ${file.title} ${file.artist}`.toLowerCase().includes(query)
  );
  select.replaceChildren(new Option(matches.length ? "Choose this episode’s MP3" : "No matching MP3s", ""));
  for (const file of matches)
    select.add(new Option(`${file.path} · ${file.artist || "Unknown artist"} · ${Math.floor(file.length / 60)} min`, String(file.id)));
  select.value = selected;
}
$("desk-audio-search").addEventListener("input", () => {
  renderExistingAudio();
  buttons();
});
$("desk-reconcile-playlist").addEventListener("change", buttons);
$("desk-existing-audio").addEventListener("change", () => {
  const file = existingAudio.find((f) => f.id === Number($<HTMLSelectElement>("desk-existing-audio").value));
  const select = $<HTMLSelectElement>("desk-reconcile-playlist");
  const matching = Array.from(select.options).filter((o) => file?.playlists.some((p) => String(p.id) === o.value));
  select.value = matching.length === 1 ? matching[0].value : "";
  buttons();
});
$("desk-reconcile").addEventListener("click", () =>
  void operation("desk-import-status", async () => {
    if (!form.reportValidity()) throw new Error("Fill in the episode details first.");
    const mediaId = Number($<HTMLSelectElement>("desk-existing-audio").value);
    const playlistId = Number($<HTMLSelectElement>("desk-reconcile-playlist").value);
    const episode = await saveEpisode();
    await api("/api/azura/reconcile", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId: episode.id, expectedRevision: state!.revision, mediaId, playlistId }),
    });
    await reloadAfterSubmit();
    field("audioReviewed").checked = false;
    message("desk-import-status", `Reconciled: ${status(editing!)}. AzuraCast was unchanged. Use the Archive button in the weekly schedule to archive an aired episode.`);
  })
);
$("desk-find-audio").addEventListener("click", () =>
  void operation("desk-import-status", async () => {
    const data = await api("/api/azura");
    if (!data.connected) throw new Error("The station connection is not configured.");
    existingAudio = (data.files as Media[])
      .filter((file) => /\.mp3$/i.test(file.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    const select = $<HTMLSelectElement>("desk-reconcile-playlist");
    select.replaceChildren(new Option("Choose this episode’s show playlist", ""));
    for (const p of (data.playlists as Playlist[]).filter((p) => p.source === "songs" && p.schedule_items.length && !["archives", "heavy rotation"].includes(p.name.toLowerCase())))
      select.add(new Option(`${p.name} · ${p.is_enabled ? "enabled" : "disabled"}`, String(p.id)));
    renderExistingAudio();
    message("desk-import-status", `Found ${existingAudio.length} uploaded MP3s. Choose the file for this episode, then use it below.`);
  })
);
$("desk-use-audio").addEventListener("click", () =>
  void operation("desk-import-status", async () => {
    const id = Number($<HTMLSelectElement>("desk-existing-audio").value);
    if (!id) throw new Error("Choose an existing episode MP3.");
    if (editing?.scheduledAt || editing?.status === "archived")
      throw new Error("Choose an episode that has not been scheduled or archived.");
    if (!form.reportValidity()) throw new Error("Fill in the episode details first.");
    const data = await api("/api/azura");
    const file = (data.files as Media[]).find((file) => file.id === id && /\.mp3$/i.test(file.path));
    if (!data.connected || !file)
      throw new Error("This MP3 is no longer available. Find uploaded MP3s again.");
    if (editing?.mediaId !== file.id) field("audioReviewed").checked = false;
    await attachAudio(readEpisode(), file);
    message("desk-import-status", `Existing MP3 retrieved: ${file.path}. Complete the review checks, then continue to step 4. No new upload was created.`);
  })
);
$("desk-save").addEventListener(
  "click",
  () =>
    void operation("desk-form-status", async () => {
      if (artworkFile && !window.confirm("Save and close? Your draft saves the artwork filename, but you’ll need to select the image again when you return.")) {
        message("desk-form-status", "Kept open. Your selected artwork is still available.");
        return;
      }
      await saveEpisode();
      message("desk-form-status", "Draft saved.");
      dialog.close();
    })
);
for (let step = 1; step <= 4; step++) {
  $(`desk-section-${step}`).querySelector("summary")!.addEventListener("click", (event) => {
    event.preventDefault();
    if (!busy) openSection(step, false);
  });
}
$("desk-back").addEventListener("click", () => {
  if (!busy) openSection(Math.max(1, activeSection - 1));
});
$("desk-continue").addEventListener("click", () => {
  void operation("desk-form-status", async () => {
    const step = activeSection;
    const names = step === 1 ? ["title", "artist", "date", "start", "end"]
      : step === 2 ? ["audio", "uploadName"] : ["art", "tracklist"];
    for (const name of names) {
      const input = field(name);
      if (!input.reportValidity() || (input.required && !input.value.trim())) {
        input.focus();
        throw new Error(`Check ${input.closest("label")?.firstChild?.textContent?.trim() || name} before continuing.`);
      }
    }
    if (step === 2 && (!editing?.mediaId || editing.audioImportedFrom !== field("audio").value || replacingAudio))
      throw new Error("Upload or select the episode MP3 before confirming your audio review.");
    if (step === 3 && !(editing?.artUploadName ? artworkFile : field("art").value.trim()))
      throw new Error("Choose an artwork image or add its link before confirming artwork.");
    const confirmation = field(["", "dateConfirmed", "audioReviewed", "artReviewed"][step]);
    const previous = confirmation.checked;
    confirmation.checked = true;
    try {
      await saveEpisode();
    } catch (error) {
      confirmation.checked = previous;
      throw error;
    }
    openSection(Math.min(4, step + 1));
    message("desk-form-status", "Confirmed and saved.");
  });
});
form.addEventListener("invalid", (event) => {
  const input = event.target as HTMLElement;
  const section = input.closest<HTMLDetailsElement>(".desk-section");
  if (section?.id.startsWith("desk-section-")) openSection(Number(section.id.split("-").pop()), false);
  for (let parent = input.parentElement; parent && parent !== form; parent = parent.parentElement)
    if (parent instanceof HTMLDetailsElement) parent.open = true;
}, true);
$("desk-reupload").addEventListener("click", () => {
  if (busy) return;
  replacingAudio = !replacingAudio;
  if (replacingAudio) uploadId = crypto.randomUUID();
  message("desk-import-status", replacingAudio
    ? "Upload again from the episode link or choose an MP3 from this computer. The existing file stays attached until the new upload is confirmed; the old file will remain in AzuraCast."
    : "Keeping the existing upload.");
  buttons();
});
$("desk-import").addEventListener(
  "click",
  () =>
    void operation("desk-import-status", async () => {
      if (!field("audio").value.trim())
        throw new Error("Add the episode MP3 link first.");
      if (!form.reportValidity())
        throw new Error("Fill in the episode details before uploading.");
      const episode = await saveEpisode();
      let size = 0,
        modified = "",
        result: {
          id?: number;
          path?: string;
          complete?: boolean;
          size: number;
          modified: string;
        };
      for (let chunk = 1; chunk <= 512; chunk++) {
        result = await api("/api/azura/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            showId: episode.id,
            revision: state!.revision,
            uploadId,
            chunk,
            size,
            modified,
          }),
        });
        size = result.size;
        modified = result.modified;
        message(
          "desk-import-status",
          `Uploading episode audio… ${Math.min(100, Math.round(((chunk * 1024 * 1024) / size) * 100))}%`
        );
        if (result.complete) {
          await attachAudio(episode, result);
          return;
        }
      }
      throw new Error("The episode exceeds the import size limit.");
    })
);
form.addEventListener("submit", (e) => {
  e.preventDefault();
  void operation("desk-form-status", async () => {
    if (scheduleComparison()) throw new Error("Review the schedule difference in step 4 before scheduling.");
    if (!reviewed()) throw new Error("Complete the episode review first.");
    const episode = await saveEpisode();
    if (!episode.mediaId || !episode.playlistId || !episode.directory)
      throw new Error(
        "Upload the episode MP3 and choose its show playlist and folder first."
      );
    if (
      !window.confirm(
        `Schedule ${episode.title} in AzuraCast for ${episode.date}, ${episode.start}–${episode.end} Pacific? This saves the episode details and artwork, moves its MP3 into the show folder, and enables the show’s playlist.${scheduleApproval === scheduleKey() ? " The playlist’s recurring slot will be replaced with this weekday and time, every week." : ""}`
      )
    ) {
      message(
        "desk-form-status",
        "Scheduling cancelled. Your episode draft is saved."
      );
      return;
    }
    const payload = JSON.stringify({
      showId: episode.id,
      playlistId: episode.playlistId,
      expectedRevision: state!.revision,
      replaceSchedule: scheduleApproval === scheduleKey(),
      expectedSchedule: JSON.stringify(
        playlists.find((p) => p.id === episode.playlistId)?.schedule_items
      ),
    });
    const submission = artworkFile ? new FormData() : null;
    if (submission) {
      submission.set("payload", payload);
      submission.set("artwork", artworkFile!, artworkFile!.name);
    }
    const result = await api("/api/azura/schedule", {
      method: "POST",
      ...(submission
        ? {}
        : { headers: { "Content-Type": "application/json" } }),
      body: submission || payload,
    });
    await reloadAfterSubmit();
    message(
      "desk-form-status",
      `Scheduled in AzuraCast: ${result.playlist} · ${episode.date}, ${episode.start}–${episode.end} Pacific. Mark the episode response “scheduled” with your name and confirm with the resident.`
    );
  });
});
async function reloadAfterSubmit() {
  state = await api("/api/desk");
  editing = state?.shows.find((s) => s.id === editing?.id) || editing;
  render();
  audioSummary();
  artworkSummary();
  $("desk-station").hidden = true;
  playlists = [];
  $<HTMLSelectElement>("desk-playlist").replaceChildren(new Option("Choose this show’s playlist", ""));
  $<HTMLSelectElement>("desk-directory").replaceChildren(new Option("Choose this show’s folder", ""));
}
$("desk-fix-schedule").addEventListener("click", () => {
  if (busy) return;
  scheduleApproval = scheduleKey();
  buttons();
});
$("desk-close").addEventListener("click", () => {
  if (!busy) dialog.close();
});
dialog.addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
});
week.addEventListener("change", () => {
  if (!busy && week.reportValidity()) {
    render();
    void reload();
  }
});
for (const [id, days] of [
  ["desk-previous-week", -7],
  ["desk-next-week", 7],
] as const)
  $(id).addEventListener("click", () => {
    if (busy || !week.reportValidity()) return;
    const date = new Date(week.value + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + days);
    week.value = date.toISOString().slice(0, 10);
    render();
    void reload();
  });
$("desk-add").addEventListener("click", () =>
  open({
    id: crypto.randomUUID(),
    title: "",
    artist: "",
    date: week.value,
    start: "12:00",
    end: "13:00",
    owner: "",
    audio: "",
    art: "",
    notes: "",
    dateConfirmed: false,
    audioReviewed: false,
    artReviewed: false,
    status: "draft",
  })
);
for (const name of ["audio", "art"])
  field(name).addEventListener("input", () => {
    link(name);
    if (name === "audio") {
      uploadId = crypto.randomUUID();
      field("audioReviewed").checked = false;
    } else {
      clearArtworkPreview();
      if (editing) delete editing.artUploadName;
      field("artReviewed").checked = false;
      artworkSummary();
    }
    audioSummary();
    buttons();
  });
$("desk-art-choose").addEventListener("click", () =>
  $<HTMLInputElement>("desk-art-file").click()
);
$("desk-art-file").addEventListener("change", () => {
  const file = $<HTMLInputElement>("desk-art-file").files?.[0];
  if (file) selectArtwork(file);
});
$("desk-art-remove").addEventListener("click", () => {
  if (busy) return;
  clearArtworkPreview();
  if (editing) delete editing.artUploadName;
  field("artReviewed").checked = false;
  artworkSummary();
  buttons();
});
$("desk-art-preview").addEventListener("error", () => {
  if (!artworkFile) return;
  clearArtworkPreview();
  field("artReviewed").checked = false;
  message(
    "desk-art-status",
    "This image could not be opened. Choose another JPEG or PNG.",
    true
  );
  buttons();
});
for (const event of ["dragenter", "dragover"])
  $("desk-art-drop").addEventListener(event, (e) => {
    e.preventDefault();
    if (!busy) $("desk-art-drop").classList.add("desk-dragging");
  });
$("desk-art-drop").addEventListener("dragleave", () =>
  $("desk-art-drop").classList.remove("desk-dragging")
);
$("desk-art-drop").addEventListener("drop", (e: DragEvent) => {
  e.preventDefault();
  $("desk-art-drop").classList.remove("desk-dragging");
  if (busy) return;
  const files = e.dataTransfer?.files;
  if (files?.length !== 1) {
    message("desk-art-status", "Drop one artwork image at a time.", true);
    return;
  }
  selectArtwork(files[0]);
});
for (const name of ["title", "artist", "date", "start", "end"])
  field(name).addEventListener("input", () => {
    field("dateConfirmed").checked = false;
    scheduleApproval = "";
    buttons();
  });
for (const name of ["title", "date"])
  field(name).addEventListener("input", () => {
    const next = `${(field("title").value || "Episode").slice(0, 140)} - ${field("date").value}`;
    if (
      !field("uploadName").readOnly &&
      field("uploadName").value === suggestedUploadName
    ) {
      field("uploadName").value = next;
      uploadId = crypto.randomUUID();
    }
    suggestedUploadName = next;
    buttons();
  });
field("uploadName").addEventListener("input", () => {
  uploadId = crypto.randomUUID();
  buttons();
});
form.addEventListener("input", buttons);
$("desk-connect").addEventListener(
  "click",
  () => void operation("desk-station-status", station)
);
for (const id of ["desk-playlist", "desk-directory"])
  $(id).addEventListener("change", () => {
    if (id === "desk-playlist") scheduleApproval = "";
    buttons();
  });
$("desk-upload-file").addEventListener("change", () => {
  uploadId = crypto.randomUUID();
  buttons();
});
$("desk-upload").addEventListener(
  "click",
  () =>
    void operation("desk-import-status", async () => {
      const file = $<HTMLInputElement>("desk-upload-file").files?.[0];
      if (!file) return;
      if (!/\.mp3$/i.test(file.name)) throw new Error("Choose an MP3 file.");
      if (!field("audio").value.trim())
        throw new Error("Add the episode MP3 link first.");
      if (!form.reportValidity())
        throw new Error("Fill in the episode details before uploading.");
      const episode = await saveEpisode();
      if (file.size > 512 * 1024 * 1024)
        throw new Error("Choose an MP3 under 512 MB.");
      let result: { id?: number; path?: string; complete?: boolean } = {};
      const chunkSize = 1024 * 1024;
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        result = await api(
          `/api/azura/upload?name=${encodeURIComponent(episode.uploadName!.replace(/\.mp3$/i, "") + ".mp3")}&uploadId=${uploadId}&size=${file.size}&chunk=${offset / chunkSize + 1}`,
          {
            method: "POST",
            headers: { "Content-Type": "audio/mpeg" },
            body: file.slice(offset, offset + chunkSize),
          }
        );
        message(
          "desk-import-status",
          `Uploading… ${Math.min(100, Math.round(((offset + chunkSize) / file.size) * 100))}%`
        );
        if (result.complete) break;
      }
      if (!result.id)
        throw new Error(
          "Upload was not confirmed. Reload the station before retrying."
        );
      await attachAudio(episode, result);
    })
);
const archiveDialog = $<HTMLDialogElement>("desk-archive-editor");
const archiveForm = $<HTMLFormElement>("desk-archive-form");
const archiveField = (name: string) => archiveForm.elements.namedItem(name) as HTMLInputElement;
let archiveEpisode: Show | null = null;
let archiveFiles: Media[] = [];
function openArchive(show: Show) {
  archiveEpisode = { ...show };
  archiveFiles = [];
  archiveForm.reset();
  for (const name of ["date", "start", "end"] as const) archiveField(name).value = show[name];
  $("desk-archive-title").textContent = `${show.title} · ${show.artist}`;
  $<HTMLSelectElement>("desk-archive-media").replaceChildren(new Option("Find the episode MP3", ""));
  $<HTMLSelectElement>("desk-archive-playlist").replaceChildren(new Option("Choose the show playlist", ""));
  message("desk-archive-status", "");
  archiveButtons();
  archiveDialog.showModal();
  if (show.status !== "archived") void operation("desk-archive-status", loadArchiveStation);
}
function archiveButtons() {
  const archived = archiveEpisode?.status === "archived";
  const aired = hasAired({ date: archiveField("date").value, end: archiveField("end").value });
  $<HTMLFieldSetElement>("desk-archive-fields").disabled = busy || !!archived;
  $<HTMLButtonElement>("desk-archive").disabled = busy || !archiveEpisode || !!archived || !aired ||
    !archiveField("dateConfirmed").checked || !$<HTMLSelectElement>("desk-archive-media").value || !$<HTMLSelectElement>("desk-archive-playlist").value;
  $("desk-archive-summary").textContent = archived
    ? "This episode is archived. Its MP3 remains in the show folder."
    : !aired ? "Archiving is available after the Pacific slot ends, plus the 15-second audio allowance."
    : "Confirm the air date, MP3, and show playlist before archiving.";
}
function renderArchiveFiles() {
  const select = $<HTMLSelectElement>("desk-archive-media");
  const selected = select.value;
  const query = $<HTMLInputElement>("desk-archive-search").value.trim().toLowerCase();
  select.replaceChildren(new Option("Choose this episode’s MP3", ""));
  for (const file of archiveFiles.filter((f) => `${f.path} ${f.title} ${f.artist}`.toLowerCase().includes(query)))
    select.add(new Option(`${file.path} · ${file.artist || "Unknown artist"}`, String(file.id)));
  select.value = selected;
}
async function loadArchiveStation() {
  const data = await api("/api/azura");
  if (!data.connected) throw new Error("The station connection is not configured.");
  archiveFiles = (data.files as Media[]).filter((f) => /\.mp3$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  renderArchiveFiles();
  const select = $<HTMLSelectElement>("desk-archive-playlist");
  select.replaceChildren(new Option("Choose the show playlist", ""));
  for (const p of (data.playlists as Playlist[]).filter((p) => p.source === "songs" && p.schedule_items.length && !["archives", "heavy rotation"].includes(p.name.toLowerCase())))
    select.add(new Option(`${p.name} · ${p.is_enabled ? "enabled" : "disabled"}`, String(p.id)));
  if (archiveEpisode?.mediaId) $<HTMLSelectElement>("desk-archive-media").value = String(archiveEpisode.mediaId);
  if (archiveEpisode?.playlistId) select.value = String(archiveEpisode.playlistId);
  message("desk-archive-status", "Check the selected MP3 and playlist belong to this episode.");
}
$("desk-archive-find").addEventListener("click", () => void operation("desk-archive-status", loadArchiveStation));
$("desk-archive-search").addEventListener("input", () => { renderArchiveFiles(); archiveButtons(); });
$("desk-archive-media").addEventListener("change", () => {
  const file = archiveFiles.find((f) => f.id === Number($<HTMLSelectElement>("desk-archive-media").value));
  const select = $<HTMLSelectElement>("desk-archive-playlist");
  const matches = Array.from(select.options).filter((o) => file?.playlists.some((p) => String(p.id) === o.value));
  select.value = matches.length === 1 ? matches[0].value : "";
  archiveButtons();
});
for (const name of ["date", "start", "end"]) archiveField(name).addEventListener("input", () => {
  archiveField("dateConfirmed").checked = false;
});
archiveForm.addEventListener("input", archiveButtons);
archiveForm.addEventListener("change", archiveButtons);
$("desk-archive-close").addEventListener("click", () => { if (!busy) archiveDialog.close(); });
archiveDialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
archiveForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!archiveForm.reportValidity()) return;
  void operation("desk-archive-status", async () => {
    if (!archiveEpisode || !state) throw new Error("Choose an episode to archive.");
    const episode: Show = {
      ...archiveEpisode,
      date: archiveField("date").value, start: archiveField("start").value, end: archiveField("end").value,
      dateConfirmed: archiveField("dateConfirmed").checked,
    };
    if (!episode.dateConfirmed || !hasAired(episode)) throw new Error("Confirm an episode whose Pacific slot has ended.");
    const mediaId = Number($<HTMLSelectElement>("desk-archive-media").value);
    const playlistId = Number($<HTMLSelectElement>("desk-archive-playlist").value);
    const file = archiveFiles.find((f) => f.id === mediaId);
    if (!file || !playlistId) throw new Error("Choose the episode MP3 and show playlist.");
    const shows = state.shows.map((s) => s.id === episode.id ? episode : s);
    validateShows(shows);
    if (!window.confirm(`Archive ${episode.title}, aired ${episode.date}, ${episode.start}–${episode.end} Pacific? MP3: ${file.path}. This adds it to Archives and heavy rotation, removes it from the selected show playlist, and disables that playlist.`)) {
      message("desk-archive-status", "Archiving cancelled.");
      return;
    }
    state = await api("/api/desk", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shows, revision: state.revision }),
    });
    render();
    if (episode.mediaId !== mediaId || episode.playlistId !== playlistId || episode.mediaPath !== file.path) {
      await api("/api/azura/reconcile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId: episode.id, expectedRevision: state!.revision, mediaId, playlistId }),
      });
      state = await api("/api/desk");
      archiveEpisode = state!.shows.find((s) => s.id === episode.id)!;
      render();
      if (archiveEpisode.status === "archived") {
        message("desk-archive-status", "Already archived in AzuraCast. The desk is now up to date.");
        return;
      }
    }
    const result = await api("/api/azura/archive", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId: episode.id, expectedRevision: state!.revision }),
    });
    state = await api("/api/desk");
    archiveEpisode = state!.shows.find((s) => s.id === episode.id)!;
    render();
    message("desk-archive-status", result.planUpdated
      ? "Archived in AzuraCast: added to Archives and heavy rotation, air date saved, and show playlist disabled."
      : "Archived in AzuraCast, but the desk changed during archiving. Close and reopen this form to reconcile its state.", !result.planUpdated);
  });
});

$sessionStore.subscribe((session) => {
  if (session?.status === "active") {
    if (!state && !busy) void reload();
  } else {
    state = null;
    $("desk-shows").replaceChildren();
    dialog.close();
    archiveDialog.close();
    archiveEpisode = null;
    $<HTMLButtonElement>("desk-add").disabled = true;
    message("desk-status", "Sign in to Jetty Backstage.");
  }
});
