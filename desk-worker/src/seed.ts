import { calendarEpisodes, calendarUrl, weekEnd } from "./calendar";
import { readLimited } from "./body";
import { validateShows } from "./validation.mjs";
import type { Show } from "./data";
import type { Env } from "./types";

type Plan = {
  shows: Show[];
  updatedAt: string | null;
  updatedBy: string | null;
};
const normalized = (title: string) =>
  title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function mergeCalendar(saved: Show[], incoming: Show[]) {
  const shows = saved.map((s) => ({ ...s })),
    warnings: string[] = [];
  let added = 0,
    changed = false;
  for (const episode of incoming) {
    let existing = shows.find(
      (s) => s.calendarId === episode.calendarId || s.id === episode.id
    );
    if (!existing) {
      const matches = shows.filter(
        (s) =>
          !s.calendarId &&
          s.date === episode.date &&
          ((s.start === episode.start && s.end === episode.end) ||
            normalized(s.title) === normalized(episode.title))
      );
      if (matches.length === 1) existing = matches[0];
      else if (matches.length > 1) {
        warnings.push(
          `${episode.title}: multiple saved episodes match this calendar entry; review them before adding another.`
        );
        continue;
      }
    }
    if (existing) {
      if (!existing.calendarId) {
        existing.calendarId = episode.calendarId;
        changed = true;
      }
      if (
        existing.date !== episode.date ||
        existing.start !== episode.start ||
        existing.end !== episode.end
      )
        warnings.push(
          `${episode.title}: the calendar now says ${episode.date}, ${episode.start}–${episode.end}. Your saved time was kept; review it before scheduling.`
        );
      continue;
    }
    validateShows([episode]);
    const conflict = shows.find(
      (s) =>
        s.status !== "archived" &&
        s.date === episode.date &&
        s.start < episode.end &&
        episode.start < s.end
    );
    if (conflict) {
      warnings.push(
        `${episode.title}: its calendar time overlaps ${conflict.title}; review the saved episode before adding another.`
      );
      continue;
    }
    shows.push(episode);
    added++;
    changed = true;
  }
  if (shows.length > 500)
    throw new Error(
      "The desk has reached its 500-episode limit. No calendar entries were added."
    );
  return { shows, added, changed, warnings };
}

export async function seedWeek(request: Request, env: Env, userId: string) {
  let week: string;
  try {
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      throw new Error("JSON required.");
    const body = JSON.parse(
      new TextDecoder().decode(await readLimited(request, 4096))
    );
    if (typeof body.week !== "string")
      throw new Error("Choose a valid week beginning date.");
    weekEnd(body.week);
    week = body.week;
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Invalid week." },
      { status: 400 }
    );
  }
  let calendar: Awaited<ReturnType<typeof calendarEpisodes>>;
  try {
    const response = await fetch(calendarUrl, {
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    if (!response.ok) throw new Error("Calendar download failed.");
    calendar = await calendarEpisodes(
      new TextDecoder().decode(await readLimited(response, 2000000)),
      week
    );
  } catch (error) {
    console.warn(
      "Calendar import failed:",
      error instanceof Error ? error.message : "Unknown calendar error"
    );
    return Response.json(
      {
        error:
          "Could not load Jetty's calendar. Your saved episodes are unchanged. Select the week again to retry.",
      },
      { status: 502 }
    );
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await env.DB.prepare(
      "SELECT data, revision FROM desk WHERE id = ?"
    )
      .bind("jetty")
      .first<{ data: string; revision: number }>();
    const plan: Plan = row
      ? JSON.parse(row.data)
      : { shows: [], updatedAt: null, updatedBy: null };
    let merged: ReturnType<typeof mergeCalendar>;
    try {
      merged = mergeCalendar(plan.shows, calendar.shows);
    } catch (e) {
      return Response.json(
        {
          error:
            e instanceof Error ? e.message : "Could not add calendar episodes.",
        },
        { status: 400 }
      );
    }
    const warnings = [...calendar.warnings, ...merged.warnings];
    if (!merged.changed)
      return Response.json({
        ...plan,
        revision: row?.revision ?? 0,
        added: 0,
        warnings,
      });
    const data: Plan = {
      shows: merged.shows,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    const result = row
      ? await env.DB.prepare(
          "UPDATE desk SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?"
        )
          .bind(JSON.stringify(data), "jetty", row.revision)
          .run()
      : await env.DB.prepare(
          "INSERT OR IGNORE INTO desk (id, data, revision) VALUES (?, ?, 1)"
        )
          .bind("jetty", JSON.stringify(data))
          .run();
    if (result.meta.changes === 1)
      return Response.json({
        ...data,
        revision: (row?.revision ?? 0) + 1,
        added: merged.added,
        warnings,
      });
  }
  return Response.json(
    {
      error:
        "A teammate is updating the desk. Select the week again to add missing calendar episodes.",
    },
    { status: 409 }
  );
}
