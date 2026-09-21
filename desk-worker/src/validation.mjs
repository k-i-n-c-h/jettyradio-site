export function mp3Filename(name, uploadId) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 180 ||
    /[/\\\x00-\x1f\x7f]/.test(name)
  )
    throw new Error(
      "Enter an MP3 name under 180 characters, without folder paths."
    );
  const base = name
    .trim()
    .replace(/\.mp3$/i, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) throw new Error("Include letters or numbers in the MP3 name.");
  return `${base}-${uploadId}.mp3`;
}

export function validateShows(value) {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error("A schedule must contain at most 500 shows.");
  const ids = new Set();
  for (const s of value) {
    if (!s || typeof s !== "object") throw new Error("Invalid show.");
    for (const k of [
      "id",
      "title",
      "artist",
      "date",
      "start",
      "end",
      "owner",
      "audio",
      "art",
      "notes",
      "status",
    ])
      if (
        typeof s[k] !== "string" ||
        s[k].length > (k === "notes" ? 5000 : 1000)
      )
        throw new Error(`Invalid ${k}.`);
    if (!s.id || ids.has(s.id) || !s.title.trim())
      throw new Error("Every show needs a unique ID and title.");
    ids.add(s.id);
    if (
      s.calendarId !== undefined &&
      (typeof s.calendarId !== "string" || !/^[a-f0-9]{64}$/.test(s.calendarId))
    )
      throw new Error("Invalid calendar identity.");
    if (s.uploadName !== undefined) mp3Filename(s.uploadName, "");
    if (
      s.artUploadName !== undefined &&
      (typeof s.artUploadName !== "string" ||
        !s.artUploadName.trim() ||
        s.artUploadName.length > 255)
    )
      throw new Error("Choose an artwork image with a valid filename.");
    if (
      s.mediaId !== undefined &&
      (!Number.isSafeInteger(s.mediaId) || s.mediaId < 1)
    )
      throw new Error("Invalid episode media ID.");
    for (const k of [
      "tracklist",
      "mediaPath",
      "audioImportedFrom",
      "directory",
    ])
      if (
        s[k] !== undefined &&
        (typeof s[k] !== "string" ||
          s[k].length > (k === "tracklist" ? 20000 : 1000))
      )
        throw new Error(`Invalid ${k}.`);
    if (s.mediaId && (!s.mediaPath || s.audioImportedFrom !== s.audio))
      throw new Error(
        "The episode audio link changed. Import the updated MP3 before scheduling."
      );
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(s.date) ||
      new Date(`${s.date}T12:00:00Z`).toISOString().slice(0, 10) !== s.date
    )
      throw new Error("Choose a valid air date.");
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) ||
      s.end <= s.start
    )
      throw new Error(
        "End time must be later than start time on the same day."
      );
    for (const k of ["audio", "art"])
      if (s[k]) {
        let u;
        try {
          u = new URL(s[k]);
        } catch {
          throw new Error("Use a complete https link for assets.");
        }
        if (u.protocol !== "https:")
          throw new Error("Asset links must use https.");
      }
    for (const k of ["dateConfirmed", "audioReviewed", "artReviewed"])
      if (typeof s[k] !== "boolean")
        throw new Error("Invalid review checklist.");
    if (!["draft", "ready", "archived"].includes(s.status))
      throw new Error("Invalid status.");
    if (
      s.status === "ready" &&
      (!s.audio ||
        (!s.art && !s.artUploadName) ||
        !s.dateConfirmed ||
        !s.audioReviewed ||
        !s.artReviewed)
    )
      throw new Error(
        "Confirm the date and review audio and artwork before marking ready."
      );
  }
  const active = value
    .filter((s) => s.status !== "archived")
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
    );
  for (let i = 1; i < active.length; i++)
    if (
      active[i].date === active[i - 1].date &&
      active[i].start < active[i - 1].end
    )
      throw new Error(
        `${active[i].title} overlaps ${active[i - 1].title}. Adjust the proposed times.`
      );
  return value;
}
