import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseResponses, matchSubmission } from '../src/submission-rules.ts';
import { syncSubmissions, submissionStatus, assignSubmission } from '../src/submissions.ts';
import type { Env } from '../src/types.ts';

const headers = ['Timestamp', 'Show name w/ artist name', 'Link to show file!', 'Show art:', 'Track list (optional)', 'Track list art', 'Other notes?', 'Admin Pick Up Name', 'Completed?'];
const audio = 'https://drive.google.com/file/d/abcdefghijk/view';
const art = 'https://drive.google.com/open?id=artabcdefghijk';
const row = (label = 'Example w/ Artist', stamp = '9/16/2026 10:00:00') => [stamp, label, audio, art, 'Artist - Track', '', '', '', ''];

function database() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_desk.sql', '0002_submissions.sql']) db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  return { db, binding: { prepare(sql: string) {
    let args: any[] = [];
    return { bind(...values: any[]) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
    };
  } } };
}

async function fixture() {
  const { db, binding } = database();
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
  const key = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
  const env = { DB: binding, SUBMISSIONS_ENABLED: 'true', SUBMISSIONS_SHEET_ID: 'fixture', SUBMISSIONS_SHEET_TAB: 'Form Responses 1', AZURACAST_API_KEY: 'fixture', GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'test@example.invalid', private_key: `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----` }) } as unknown as Env;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86400000));
  const state = { rows: [headers, row('Historical w/ Artist', '1/1/2026 10:00:00')], files: [] as any[], uploadCalls: 0, artCalls: 0, playlistWrites: 0, version: '1', size: 1048580, failArt: false, duringArt: undefined as undefined | (() => void), requests: [] as string[] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); state.requests.push(url.href);
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fixture-token' });
    if (url.hostname === 'sheets.googleapis.com') return Response.json({ values: state.rows });
    if (url.hostname === 'calendar.google.com') return new Response(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture\r\nDTSTART:${date.replaceAll('-','')}T120000\r\nDTEND:${date.replaceAll('-','')}T130000\r\nSUMMARY:Example w/ Artist\r\nEND:VEVENT\r\nEND:VCALENDAR`);
    if (url.hostname === 'www.googleapis.com') {
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture-token');
      if (url.searchParams.has('fields')) return Response.json({ version: state.version, size: String(state.size), md5Checksum: 'fixture-checksum' });
      if (url.pathname.endsWith('/artabcdefghijk')) {
        if (state.failArt) return new Response('', { status: 403 });
        return new Response(new Uint8Array([255,216,255]), { headers: { 'Content-Type': 'image/jpeg' } });
      }
      const range = new Headers(init.headers).get('Range')!.match(/bytes=(\d+)-(\d+)/)!;
      const start = Number(range[1]), end = Math.min(Number(range[2]), state.size - 1);
      return new Response(new Uint8Array(end - start + 1), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${state.size}`, 'ETag': 'fixture-v' + state.version } });
    }
    assert.equal(url.hostname, 'stream.jettyradio.com');
    const path = url.pathname.replace('/api/station/1', '');
    if (path === '/playlists') return Response.json([{ id: 10, name: 'Example', source: 'songs', is_enabled: false, schedule_items: [] }]);
    if (path === '/files/directories') return Response.json({ rows: [{ name: 'Example', path: 'Example' }] });
    if (path === '/files') return Response.json(state.files);
    if (path === '/files/upload') {
      state.uploadCalls++; const form = init.body as FormData;
      if (form.get('flowChunkNumber') === form.get('flowTotalChunks')) state.files.push({ id: 50, path: form.get('flowFilename'), title: 'uploaded', length: 3600, playlists: [] });
      return Response.json({ success: true });
    }
    if (path === '/file/50') { assert.ok(!init.method || init.method === 'GET'); return Response.json(state.files[0]); }
    if (path === '/art/50') { state.artCalls++; state.duringArt?.(); return Response.json({ success: true }); }
    if (path.startsWith('/playlist/')) state.playlistWrites++;
    throw new Error('Unexpected station write: ' + path);
  };
  return { env, db, state, restore() { globalThis.fetch = originalFetch; db.close(); } };
}

const status = async (env: Env) => await (await submissionStatus(env)).json() as any;
const plan = (db: DatabaseSync) => JSON.parse((db.prepare("SELECT data FROM desk WHERE id = 'jetty'").get() as any).data);

test('response identity survives row movement and header changes fail closed', async () => {
  const a = await parseResponses([headers, row()]);
  const b = await parseResponses([headers, [], row()]);
  assert.equal(a[0].id, b[0].id);
  await assert.rejects(parseResponses([['Changed'], row()]), /columns changed/);
});

test('matching rejects ambiguous episodes, past episodes, and scheduler edits', async () => {
  const [submission] = await parseResponses([headers, row()]);
  const show: any = { id: 'one', title: 'Example', artist: 'Artist', date: '2026-09-16', start: '12:00', end: '13:00', status: 'draft' };
  const now = new Date('2026-09-15T20:00:00Z');
  assert.equal(matchSubmission(submission, [show], now).id, 'one');
  assert.throws(() => matchSubmission(submission, [show, { ...show, id: 'two', date: '2026-09-23' }], now), /exactly one/);
  assert.throws(() => matchSubmission(submission, [{ ...show, audio: 'saved' }], now), /not overwritten/);
  assert.throws(() => matchSubmission(submission, [{ ...show, date: '2026-09-14' }], now), /exactly one/);
});

test('baseline skips old rows; new response uploads once and stays unassigned and unreviewed', async () => {
  const f = await fixture();
  try {
    await syncSubmissions(f.env); assert.equal(f.state.uploadCalls, 0);
    f.state.rows.push(row()); await syncSubmissions(f.env);
    const result = await status(f.env); assert.equal(result.submissions[0].state, 'imported', JSON.stringify(result));
    assert.equal(f.state.uploadCalls, 2); assert.equal(f.state.artCalls, 1);
    const show = plan(f.db).shows[0]; assert.equal(show.mediaId, 50); assert.equal(show.tracklist, 'Artist - Track'); assert.equal(show.playlistId, 10); assert.equal(show.directory, 'Example');
    assert.equal(show.status, 'draft'); assert.equal(show.dateConfirmed, false); assert.equal(show.audioReviewed, false); assert.equal(show.artReviewed, false); assert.equal(show.scheduledAt, undefined);
    assert.deepEqual(f.state.files[0].playlists, []); assert.equal(f.state.playlistWrites, 0);
    await syncSubmissions(f.env); assert.equal(f.state.uploadCalls, 2); assert.equal(f.state.artCalls, 1);
  } finally { f.restore(); }
});

test('unmatched response appears in inbox and manual episode assignment resumes it', async () => {
  const f = await fixture();
  try {
    await syncSubmissions(f.env); f.state.rows.push(row('Unrecognized spelling')); await syncSubmissions(f.env);
    let result = await status(f.env); assert.equal(result.submissions[0].state, 'needs_review'); assert.equal(f.state.uploadCalls, 0);
    const item = result.submissions[0];
    await assignSubmission(new Request('https://desk.invalid', { method: 'POST', body: JSON.stringify({ id: item.id, showId: plan(f.db).shows[0].id }) }), f.env);
    await syncSubmissions(f.env); result = await status(f.env); assert.equal(result.submissions[0].state, 'imported', JSON.stringify(result));
  } finally { f.restore(); }
});

test('artwork failure resumes without reuploading MP3', async () => {
  const f = await fixture();
  try {
    await syncSubmissions(f.env); f.state.rows.push(row()); f.state.failArt = true; await syncSubmissions(f.env);
    const result = await status(f.env); const item = result.submissions[0]; assert.equal(item.state, 'needs_review'); assert.equal(f.state.uploadCalls, 2);
    f.state.failArt = false;
    await assignSubmission(new Request('https://desk.invalid', { method: 'POST', body: JSON.stringify({ id: item.id, showId: item.showId }) }), f.env);
    await syncSubmissions(f.env); assert.equal((await status(f.env)).submissions[0].state, 'imported'); assert.equal(f.state.uploadCalls, 2);
  } finally { f.restore(); }
});

test('concurrent scheduler edits are preserved and source changes stop a retry', async () => {
  const f = await fixture();
  try {
    await syncSubmissions(f.env); f.state.rows.push(row());
    f.state.duringArt = () => { const p = plan(f.db); p.shows[0].notes = 'Scheduler edit'; f.db.prepare("UPDATE desk SET data = ?, revision = revision + 1 WHERE id = 'jetty'").run(JSON.stringify(p)); };
    await syncSubmissions(f.env); assert.equal(plan(f.db).shows[0].notes, 'Scheduler edit'); assert.equal(plan(f.db).shows[0].mediaId, undefined);
    const item = (await status(f.env)).submissions[0]; assert.equal(item.state, 'needs_review');
    f.state.duringArt = undefined; f.state.version = '2';
    await assignSubmission(new Request('https://desk.invalid', { method: 'POST', body: JSON.stringify({ id: item.id, showId: item.showId }) }), f.env);
    await syncSubmissions(f.env); assert.match((await status(f.env)).submissions[0].error, /source MP3 changed/); assert.equal(f.state.uploadCalls, 2);
  } finally { f.restore(); }
});

test('disabled intake and an occupied station lock perform no external reads or writes', async () => {
  const f = await fixture();
  try {
    await syncSubmissions({ ...f.env, SUBMISSIONS_ENABLED: 'false' }); assert.equal(f.state.requests.length, 0);
    f.db.prepare('INSERT INTO locks VALUES (?, ?, ?)').run('station', 'scheduler', Date.now() + 300000);
    await syncSubmissions(f.env); assert.equal(f.state.requests.length, 0);
  } finally { f.restore(); }
});

test('editing historical show names does not create a new submission; completed responses are skipped', async () => {
  const f = await fixture();
  try {
    await syncSubmissions(f.env);
    f.state.rows[1][1] = 'Renamed historical show';
    const completed = row(); completed[8] = 'scheduled'; f.state.rows.push(completed);
    await syncSubmissions(f.env); assert.equal(f.state.uploadCalls, 0); assert.equal((await status(f.env)).submissions.length, 0);
  } finally { f.restore(); }
});

test('duplicate response timestamps stop discovery instead of conflating submissions', async () => {
  await assert.rejects(parseResponses([headers, row('First'), row('Second')]), /same timestamp/);
});

test('large uploads resume across polls using the same media filename', async () => {
  const f = await fixture();
  try {
    f.state.size = 10 * 1024 * 1024 + 1;
    await syncSubmissions(f.env); f.state.rows.push(row()); await syncSubmissions(f.env);
    const first = (await status(f.env)).submissions[0];
    assert.equal(first.state, 'uploading'); assert.equal(f.state.uploadCalls, 8); assert.equal(f.state.files.length, 0);
    await syncSubmissions(f.env);
    assert.equal((await status(f.env)).submissions[0].state, 'imported'); assert.equal(f.state.uploadCalls, 11); assert.equal(f.state.files.length, 1);
    await syncSubmissions(f.env); assert.equal(f.state.files.length, 1); assert.equal(f.state.playlistWrites, 0);
  } finally { f.restore(); }
});
