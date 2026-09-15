import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarEpisodes } from "../src/calendar";
import { mergeCalendar } from "../src/seed";

const zone = `BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:DAYLIGHT
DTSTART:19700308T020000
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19701101T020000
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;
function feed(...events: string[]) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    zone,
    ...events.map((e) => `BEGIN:VEVENT\n${e}\nEND:VEVENT`),
    "END:VCALENDAR",
  ].join("\r\n");
}
const recurring = `UID:example
SUMMARY:Example w/ DJ
DTSTART;TZID=America/Los_Angeles:20260906T160000
DTEND;TZID=America/Los_Angeles:20260906T180000
RRULE:FREQ=WEEKLY;COUNT=12`;

test("calendar recurrence stays at Pacific local time across DST, respects COUNT and weekly boundaries", async () => {
  for (const week of ["2026-09-14", "2026-10-26", "2026-11-02"]) {
    const result = await calendarEpisodes(feed(recurring), week);
    assert.equal(result.shows.length, 1);
    const episode = result.shows[0];
    assert.equal(episode.start, "16:00");
    assert.equal(episode.end, "18:00");
    assert.equal(episode.title, "Example");
    assert.equal(episode.artist, "DJ");
    assert.equal(episode.status, "draft");
    assert.equal(episode.audio, "");
    assert.equal(episode.dateConfirmed, false);
  }
  assert.equal(
    (await calendarEpisodes(feed(recurring), "2026-11-23")).shows.length,
    0
  );
});

test("calendar applies monthly ordinals, RDATE, EXDATE, moved occurrences, and cancellations", async () => {
  const monthly = recurring
    .replace("FREQ=WEEKLY;COUNT=12", "FREQ=MONTHLY;BYDAY=3SU")
    .replaceAll("20260906", "20260920");
  assert.equal(
    (await calendarEpisodes(feed(monthly), "2026-10-12")).shows[0].date,
    "2026-10-18"
  );
  const excluded =
    recurring +
    "\nEXDATE;TZID=America/Los_Angeles:20260920T160000\nRDATE;TZID=America/Los_Angeles:20260919T160000";
  assert.equal(
    (await calendarEpisodes(feed(excluded), "2026-09-14")).shows[0].date,
    "2026-09-19"
  );
  const moved = `UID:example
RECURRENCE-ID:20260927T230000Z
DTSTART:20260919T230000Z
DTEND:20260920T010000Z
SUMMARY:Moved w/ Guest`;
  const cancelled = `UID:example
RECURRENCE-ID;TZID=America/Los_Angeles:20260920T160000
STATUS:CANCELLED`;
  const result = await calendarEpisodes(
    feed(recurring, moved, cancelled),
    "2026-09-14"
  );
  assert.equal(result.shows.length, 1);
  assert.equal(result.shows[0].title, "Moved");
  assert.equal(result.shows[0].date, "2026-09-19");
  assert.equal(
    (await calendarEpisodes(feed(recurring, moved), "2026-09-21")).shows.length,
    0
  );
});

test("a moved occurrence is emitted once even when its recurrence ID is UTC", async () => {
  const moved = `UID:example
RECURRENCE-ID:20260920T230000Z
DTSTART:20260920T220000Z
DTEND:20260921T000000Z
SUMMARY:Moved`;
  const result = await calendarEpisodes(feed(recurring, moved), "2026-09-14");
  assert.equal(result.shows.length, 1);
  assert.equal(result.shows[0].start, "15:00");
});

test("unrelated exceptions do not change another series and canceled masters stay excluded", async () => {
  const unrelated = `UID:other
RECURRENCE-ID:20260920T230000Z
DTSTART:20260919T210000Z
DTEND:20260919T220000Z
SUMMARY:Other`;
  const result = await calendarEpisodes(
    feed(recurring, unrelated),
    "2026-09-14"
  );
  assert.equal(result.shows.length, 2);
  assert.equal(result.shows.find((s) => s.title === "Example")?.start, "16:00");
  assert.equal(
    (
      await calendarEpisodes(
        feed(recurring + "\nSTATUS:CANCELLED"),
        "2026-09-14"
      )
    ).shows.length,
    0
  );
});

test("calendar handles floating Pacific times, escaped folded names, all-day entries and overnight warnings", async () => {
  const result = await calendarEpisodes(
    feed(
      `UID:plain
DTSTART:20260916T160000
DTEND:20260916T180000
SUMMARY:Hello\\, Radio w/
  Guest`,
      `UID:all-day
DTSTART;VALUE=DATE:20260917
DTEND;VALUE=DATE:20260918
SUMMARY:Admin day`,
      `UID:overnight
DTSTART:20260918T230000
DTEND:20260919T010000
SUMMARY:Overnight`
    ),
    "2026-09-14"
  );
  assert.equal(result.shows.length, 1);
  assert.equal(result.shows[0].title, "Hello, Radio");
  assert.equal(result.shows[0].artist, "Guest");
  assert.equal(result.shows[0].start, "16:00");
  assert.match(result.warnings[0], /Overnight/);
});

test("calendar rejects invalid dates, missing timezone definitions and excessive recurrence frequency", async () => {
  await assert.rejects(
    calendarEpisodes(feed(recurring), "2026-02-30"),
    /valid week/
  );
  await assert.rejects(
    calendarEpisodes(
      feed(recurring.replaceAll("America/Los_Angeles", "Unknown/Zone")),
      "2026-09-14"
    ),
    /timezone/
  );
  await assert.rejects(
    calendarEpisodes(
      feed(recurring.replace("WEEKLY", "SECONDLY")),
      "2026-09-14"
    ),
    /too frequent/
  );
});

test("calendar merging preserves submissions, archives and manual time edits across repeated seeding", async () => {
  const [episode] = (await calendarEpisodes(feed(recurring), "2026-09-14"))
    .shows;
  const legacy = {
    ...episode,
    id: "existing",
    calendarId: undefined,
    title: "Episode 7",
    notes: "keep",
    audio: "https://example.com/audio.mp3",
    status: "archived" as const,
    mediaId: 22,
  };
  const merged = mergeCalendar([legacy], [episode]);
  assert.equal(merged.added, 0);
  assert.equal(merged.shows[0].id, "existing");
  assert.equal(merged.shows[0].notes, "keep");
  assert.equal(merged.shows[0].mediaId, 22);
  assert.equal(merged.shows[0].status, "archived");
  const edited = { ...merged.shows[0], date: "2026-09-19", start: "15:00" };
  const repeat = mergeCalendar([edited], [episode]);
  assert.deepEqual(repeat.shows, [edited]);
  assert.equal(repeat.added, 0);
  assert.equal(repeat.changed, false);
  assert.match(repeat.warnings[0], /saved time was kept/);
});

test("calendar merging reports overlaps instead of duplicating an edited slot", async () => {
  const [episode] = (await calendarEpisodes(feed(recurring), "2026-09-14"))
    .shows;
  const existing = {
    ...episode,
    calendarId: undefined,
    id: "manual",
    title: "Special episode",
    start: "15:30",
  };
  const result = mergeCalendar([existing], [episode]);
  assert.deepEqual(result.shows, [existing]);
  assert.match(result.warnings[0], /overlaps/);
});
