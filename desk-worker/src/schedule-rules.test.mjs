import test from "node:test";
import assert from "node:assert/strict";
import { recurringFor, scheduleMismatch } from "./schedule-rules.mjs";

const episode = { date: "2026-09-16", start: "12:00", end: "13:00" };
const slot = { id: 4, days: [3], start_time: 1200, end_time: 1300, loop_once: false };

test("matching times retain the existing recurring slot", () => {
  assert.equal(scheduleMismatch([slot], episode), "");
  assert.deepEqual(recurringFor([slot], episode), { ...slot, start_date: null, end_date: null });
  assert.equal(scheduleMismatch([{ ...slot, days: ["3"] }], episode), "");
});
test("differences identify both slots and require explicit replacement", () => {
  for (const change of [{ days: [2] }, { start_time: 1100 }, { end_time: 1400 }]) {
    const items = [{ ...slot, ...change }];
    assert.match(scheduleMismatch(items, episode), /Playlist: .*Episode: Wednesday, 12:00–13:00/);
    assert.throws(() => recurringFor(items, episode), /The schedules differ/);
    assert.deepEqual(recurringFor(items, episode, true), {
      ...slot, loop_once: true, start_date: null, end_date: null,
    });
  }
});
test("missing slots can be created only with explicit replacement", () => {
  assert.throws(() => recurringFor([], episode), /No saved slot/);
  assert.deepEqual(recurringFor([], episode, true), {
    days: [3], start_time: 1200, end_time: 1300, loop_once: true, start_date: null, end_date: null,
  });
});
test("multiple entries are never overwritten", () => {
  assert.throws(() => recurringFor([slot, slot], episode, true), /multiple schedule entries/);
});
test("Sunday uses AzuraCast weekday seven", () => {
  assert.deepEqual(recurringFor([], { ...episode, date: "2026-09-20" }, true).days, [7]);
});
