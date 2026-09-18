import test from "node:test";
import assert from "node:assert/strict";
import { reconciledEpisode } from "./reconcile-rules.mjs";
const show = { date: "2020-09-16", start: "12:00", end: "13:00", dateConfirmed: true, audio: "", status: "draft" };
const playlist = { id: 1, name: "Show", source: "songs", is_enabled: true, schedule_items: [{ days: [3], start_time: 1200, end_time: 1300 }] };
const destinations = [{ id: 2, name: "Archives", source: "songs" }, { id: 3, name: "heavy rotation", source: "songs" }];
const file = { id: 5, path: "show/episode.mp3", playlists: [{ id: 1 }] };
test("external scheduled MP3 can be reconciled without submission assets", () => {
  const result = reconciledEpisode(show, file, [playlist], 1);
  assert.equal(result.mediaId, 5);
  assert.equal(result.audioImportedFrom, "");
  assert.equal(result.playlistId, 1);
  assert.ok(result.scheduledAt);
});
test("disabled or mismatched playlists retain attached state without claiming scheduled", () => {
  for (const p of [{ ...playlist, is_enabled: false }, { ...playlist, schedule_items: [{ days: [2], start_time: 1200, end_time: 1300 }] }]) {
    const result = reconciledEpisode({ ...show, scheduledAt: "old" }, file, [p], 1);
    assert.equal(result.scheduledAt, undefined);
    assert.equal(result.status, "draft");
  }
});
test("rejects wrong file, date, playlist, or unconfirmed episode", () => {
  assert.throws(() => reconciledEpisode(show, { ...file, playlists: [] }, [playlist], 1), /not in this show playlist/);
  assert.throws(() => reconciledEpisode(show, { ...file, custom_fields: { air_date: "09/17/2020" } }, [playlist], 1), /air date differs/);
  assert.throws(() => reconciledEpisode({ ...show, dateConfirmed: false }, file, [playlist], 1), /Confirm/);
  assert.throws(() => reconciledEpisode(show, file, destinations, 2), /scheduled show playlist/);
});
test("recognizes completed external archive only with date and disabled show playlist", () => {
  const archived = { ...file, playlists: [{ id: 2 }, { id: 3 }], custom_fields: { air_date: "9/16/2020" } };
  assert.equal(reconciledEpisode(show, archived, [{ ...playlist, is_enabled: false }, ...destinations], 1).status, "archived");
  assert.throws(() => reconciledEpisode(show, archived, [playlist, ...destinations], 1), /not in this show playlist/);
});
