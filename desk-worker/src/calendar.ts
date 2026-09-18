import ICAL from "ical.js";
import type { Show } from "./data";

export const calendarUrl =
  "https://calendar.google.com/calendar/ical/88b340766db3ce612b621c05297dc1ba9ae71e04a67a22a9b749dda336c878f3%40group.calendar.google.com/public/basic.ics";
const pacific = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function weekEnd(week: string) {
  const start = new Date(`${week}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(week) ||
    !Number.isFinite(start.getTime()) ||
    start.toISOString().slice(0, 10) !== week
  )
    throw new Error("Choose a valid week beginning date.");
  return new Date(start.getTime() + 7 * 86400000).toISOString().slice(0, 10);
}

function local(time: ICAL.Time) {
  if (time.zone === ICAL.Timezone.localTimezone)
    return {
      date: time.toString().slice(0, 10),
      time: time.toString().slice(11, 16),
    };
  const p = Object.fromEntries(
    pacific.formatToParts(time.toJSDate()).map((p) => [p.type, p.value])
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
  };
}

export async function calendarEpisodes(source: string, week: string) {
  const end = weekEnd(week);
  const calendar = new ICAL.Component(ICAL.parse(source));
  if (calendar.name !== "vcalendar")
    throw new Error("Jetty's calendar could not be read.");
  const events = calendar
    .getAllSubcomponents("vevent")
    .map(
      (component) =>
        new ICAL.Event(component, { exceptions: [], strictExceptions: true })
    );
  const masters = events.filter((event) => !event.isRecurrenceException());
  const exceptions = events.filter((event) => event.isRecurrenceException());
  const occurrences = new Map<
    string,
    { item: ICAL.Event; start: ICAL.Time; end: ICAL.Time }
  >();
  let iterations = 0;
  const add = (
    item: ICAL.Event,
    start: ICAL.Time,
    finish: ICAL.Time,
    recurrence: ICAL.Time
  ) => {
    if (
      item.component.getFirstPropertyValue("status") === "CANCELLED" ||
      start.isDate
    )
      return;
    const date = local(start).date;
    if (date >= week && date < end)
      occurrences.set(`${item.uid}/${recurrence.toUnixTime()}`, {
        item,
        start,
        end: finish,
      });
  };
  for (const event of events) {
    if (!event.uid)
      throw new Error("A calendar entry is missing its identity.");
    for (const name of [
      "dtstart",
      "dtend",
      "recurrence-id",
      "rdate",
      "exdate",
    ]) {
      for (const prop of event.component.getAllProperties(name)) {
        const zone = prop.getParameter("tzid");
        if (zone && zone !== "UTC" && !calendar.getTimeZoneByID(String(zone)))
          throw new Error("A calendar timezone is missing its definition.");
      }
    }
    if (event.modifiesFuture())
      throw new Error(
        "A calendar series uses an unsupported range change. Review that series in Google Calendar."
      );
    if (
      Object.keys(event.getRecurrenceTypes()).some(
        (f) => !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(f)
      )
    )
      throw new Error("A calendar recurrence is too frequent to import.");
  }
  for (const event of masters) {
    if (
      event.component.getFirstPropertyValue("status") === "CANCELLED" ||
      event.startDate.isDate
    )
      continue;
    for (const exception of exceptions.filter((e) => e.uid === event.uid))
      event.relateException(exception);
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate, event.startDate);
      continue;
    }
    const iterator = event.iterator();
    for (
      let occurrence = iterator.next();
      occurrence;
      occurrence = iterator.next()
    ) {
      if (++iterations > 50000)
        throw new Error("The calendar is too large to expand safely.");
      if (local(occurrence).date >= end) break;
      if (
        exceptions.some(
          (e) =>
            e.uid === event.uid &&
            e.recurrenceId.toUnixTime() === occurrence.toUnixTime() &&
            e.component.getFirstPropertyValue("status") === "CANCELLED"
        )
      )
        continue;
      const details = event.getOccurrenceDetails(occurrence);
      add(details.item, details.startDate, details.endDate, occurrence);
    }
  }
  // Moved occurrences can enter this week from beyond the recurrence window.
  for (const event of exceptions) {
    if (event.component.getFirstPropertyValue("status") === "CANCELLED")
      continue;
    const parent = masters.find((e) => e.uid === event.uid);
    if (parent?.component.getFirstPropertyValue("status") !== "CANCELLED")
      add(event, event.startDate, event.endDate, event.recurrenceId);
  }
  const shows: Show[] = [],
    warnings: string[] = [];
  for (const [key, occurrence] of occurrences) {
    const start = local(occurrence.start),
      finish = local(occurrence.end);
    const summary = (occurrence.item.summary || "Untitled show").trim();
    if (start.date !== finish.date || finish.time <= start.time) {
      warnings.push(
        `${summary}: review its overnight or missing end time in the calendar; no episode was added.`
      );
      continue;
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(key)
    );
    const calendarId = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const parts = summary.split(/\s+w\/\s*/i);
    shows.push({
      id: `calendar-${calendarId}`,
      calendarId,
      title: parts[0],
      artist: parts.slice(1).join(" w/ "),
      date: start.date,
      start: start.time,
      end: finish.time,
      owner: "",
      audio: "",
      art: "",
      notes: "",
      dateConfirmed: false,
      audioReviewed: false,
      artReviewed: false,
      status: "draft",
    });
  }
  return {
    shows: shows.sort(
      (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
    ),
    warnings,
  };
}
