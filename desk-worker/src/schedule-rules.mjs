export function scheduleFor(show) {
  return {
    start_time: Number(show.start.replace(":", "")),
    end_time: Number(show.end.replace(":", "")),
    start_date: show.date,
    end_date: show.date,
    days: [new Date(show.date + "T12:00:00Z").getUTCDay() || 7],
    loop_once: true,
  };
}
const minutes = (value) =>
  Math.floor(Number(value) / 100) * 60 + (Number(value) % 100);
export function overlap(item, show) {
  const start = minutes(show.start.replace(":", "")),
    end = minutes(show.end.replace(":", ""));
  for (const offset of [-1, 0]) {
    const date = new Date(show.date + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + offset);
    const day = date.getUTCDay() || 7,
      iso = date.toISOString().slice(0, 10);
    if (
      (item.start_date && item.start_date > iso) ||
      (item.end_date && item.end_date < iso)
    )
      continue;
    if (item.days?.length && !item.days.includes(day)) continue;
    const itemStart = minutes(item.start_time) + offset * 1440;
    let itemEnd = minutes(item.end_time) + offset * 1440;
    if (item.end_time <= item.start_time) itemEnd += 1440;
    if (start < itemEnd && end > itemStart) return true;
  }
  return false;
}
export function isPast(show, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return (
    `${show.date}T${show.start}` <=
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
  );
}
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clockTime = (value) => String(Number(value)).padStart(4, "0").replace(/(..)$/, ":$1");
export function scheduleMismatch(items, episode) {
  if (items.length > 1)
    return "This playlist has multiple schedule entries. Choose another playlist or edit those entries in AzuraCast to preserve its other slots.";
  const item = items[0],
    day = new Date(episode.date + "T12:00:00Z").getUTCDay() || 7;
  if (item &&
    Number(item.start_time) === Number(episode.start.replace(":", "")) &&
    Number(item.end_time) === Number(episode.end.replace(":", "")) &&
    item.days?.map(Number).includes(day)
  ) return "";
  const current = item
    ? `${item.days?.length ? item.days.map((d) => weekdays[Number(d) % 7]).join(", ") : "Every day"}, ${clockTime(item.start_time)}–${clockTime(item.end_time)}`
    : "No saved slot";
  return `The schedules differ. Playlist: ${current}. Episode: ${weekdays[day % 7]}, ${episode.start}–${episode.end}. Times are Pacific. This does not mean the episode time is wrong. Check the playlist selection and step 1, or choose “Use confirmed time for playlist” below.`;
}
export function recurringFor(items, episode, replaceSchedule = false) {
  const mismatch = scheduleMismatch(items, episode);
  if (items.length > 1 || (mismatch && !replaceSchedule))
    throw new Error(mismatch);
  if (mismatch)
    return { ...items[0], ...scheduleFor(episode), start_date: null, end_date: null };
  return { ...items[0], start_date: null, end_date: null };
}
export function hasAired(show, now = new Date()) {
  return isPast({ ...show, start: show.end }, new Date(now.getTime() - 15000));
}
export function isNextOccurrence(episode, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`,
    time = `${parts.hour}:${parts.minute}`;
  const current = new Date(today + "T12:00:00Z"),
    target = new Date(episode.date + "T12:00:00Z");
  let days = (target.getUTCDay() - current.getUTCDay() + 7) % 7;
  if (days === 0 && episode.start <= time) days = 7;
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10) === episode.date;
}
