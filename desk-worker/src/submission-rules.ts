import type { Show } from "./data";
import { isPast } from "./schedule-rules.mjs";

export type Submission = {
  id: string; row: number; timestamp: string; label: string;
  audio: string; art: string; tracklist: string; notes: string; completed: string;
};
const normalize = (text: string) => text.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export async function parseResponses(rows: string[][]) {
  const headers = ["Timestamp", "Show name w/ artist name", "Link to show file!", "Show art:", "Track list (optional)", "Track list art", "Other notes?", "Admin Pick Up Name", "Completed?"];
  if (!headers.every((prefix, i) => String(rows[0]?.[i] || "").trim().startsWith(prefix)))
    throw new Error("Response sheet columns changed. Expected the nine Jetty form columns in A:I.");
  const submissions: Submission[] = [];
  const timestamps = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].map(value => String(value || "").trim());
    if (!cells.some(Boolean)) continue;
    if (!cells[0] || !cells[1]) throw new Error(`Response row ${i + 1} needs its timestamp and show name.`);
    if (timestamps.has(cells[0])) throw new Error("Two responses have the same timestamp. Resolve their identity before importing.");
    timestamps.add(cells[0]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cells[0]));
    const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    submissions.push({ id, row: i + 1, timestamp: cells[0], label: cells[1], audio: cells[2] || "", art: cells[3] || "", tracklist: cells[4] || "", notes: cells[6] || "", completed: cells[8] || "" });
  }
  return submissions;
}

export function matchSubmission(submission: Submission, shows: Show[], now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const end = new Date(today + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 14);
  const candidates = shows.filter(show =>
    show.date >= today && show.date < end.toISOString().slice(0, 10) && !isPast(show, now) &&
    normalize(show.artist ? `${show.title} w/ ${show.artist}` : show.title) === normalize(submission.label)
  );
  if (candidates.length !== 1) throw new Error("Needs review: expected exactly one matching calendar episode in the next 14 days. Check the show/artist spelling or use the manual upload flow.");
  const show = candidates[0];
  if (show.status !== "draft" || show.scheduledAt || show.mediaId || show.audio || show.art || show.tracklist || show.notes || show.dateConfirmed || show.audioReviewed || show.artReviewed)
    throw new Error("Needs review: the matching episode already has submitted assets or scheduler edits; it was not overwritten.");
  return show;
}
