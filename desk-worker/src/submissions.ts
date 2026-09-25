import { readLimited } from './body';
import type { Env } from './types';

const spreadsheetId = '1JWANaTg7HKQzrEQyqv1Y5ksioj-4sqUfu6-IBRDjwXw';
const sheetId = 1302148943;
const fail = (error: string, status: number) => Response.json({ error }, { status });

async function body(request: Request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new Error('JSON required.');
  return JSON.parse(new TextDecoder().decode(await readLimited(request, 100000)));
}

export async function receiveSubmission(request: Request, env: Env): Promise<Response> {
  if (!env.SUBMISSIONS_WEBHOOK_SECRET || env.SUBMISSIONS_WEBHOOK_SECRET.length < 32)
    return fail('Submission intake has not been configured.', 503);
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] || '';
  const digest = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [expected, actual] = await Promise.all([digest(env.SUBMISSIONS_WEBHOOK_SECRET), digest(token)]);
  const actualBytes = new Uint8Array(actual);
  const difference = new Uint8Array(expected).reduce((value, byte, index) => value | (byte ^ actualBytes[index]), 0);
  if (difference !== 0) return fail('Invalid intake credentials.', 401);
  let data;
  try {
    data = await body(request);
    if (!data || data.spreadsheetId !== spreadsheetId || data.sheetId !== sheetId ||
        typeof data.id !== 'string' || !/^[a-f0-9]{64}$/.test(data.id) || !Number.isSafeInteger(data.row) || data.row < 2 ||
        typeof data.submittedAt !== 'string' || !Number.isFinite(Date.parse(data.submittedAt)))
      throw new Error('Invalid submission source or identity.');
    const limits: Record<string, number> = { title: 1000, audio: 4000, artwork: 4000, tracklist: 20000, tracklistArt: 4000, notes: 20000, admin: 1000, completed: 1000 };
    const fields: Record<string, string> = {};
    for (const [key, limit] of Object.entries(limits)) {
      if (typeof data[key] !== 'string' || data[key].length > limit)
        throw new Error(`Invalid ${key}.`);
      fields[key] = data[key];
    }
    if (!fields.title.trim()) throw new Error('A show name is required.');
    data = { id: data.id, submittedAt: new Date(data.submittedAt).toISOString(), row: data.row, ...fields };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid submission.', 400);
  }
  // Replays never overwrite staff review decisions or the original submission snapshot.
  const result = await env.DB.prepare('INSERT OR IGNORE INTO submissions (id, submitted_at, received_at, data) VALUES (?, ?, ?, ?)')
    .bind(data.id, data.submittedAt, new Date().toISOString(), JSON.stringify(data)).run();
  return Response.json({ id: data.id, created: result.meta.changes === 1 });
}

export async function listSubmissions(request: Request, env: Env): Promise<Response> {
  const cursor = new URL(request.url).searchParams.get('before');
  let before: string[] | undefined;
  if (cursor) {
    try {
      before = JSON.parse(cursor);
      if (!Array.isArray(before) || before.length !== 2 ||
          typeof before[0] !== 'string' || !Number.isFinite(Date.parse(before[0])) ||
          typeof before[1] !== 'string' || !/^[a-f0-9]{64}$/.test(before[1])) throw new Error();
    } catch { return fail('Invalid page cursor.', 400); }
  }
  const columns = 'id, submitted_at, data, status, revision, reviewed_at';
  const query = before
    ? env.DB.prepare(`SELECT ${columns} FROM submissions WHERE (submitted_at, id) < (?, ?) ORDER BY submitted_at DESC, id DESC LIMIT 51`).bind(...before)
    : env.DB.prepare(`SELECT ${columns} FROM submissions ORDER BY submitted_at DESC, id DESC LIMIT 51`);
  const { results } = await query.all<{ id: string; submitted_at: string; data: string; status: string; revision: number; reviewed_at: string | null }>();
  const rows = results.slice(0, 50);
  const last = rows.at(-1);
  return Response.json({
    records: rows.map(row => ({ ...JSON.parse(row.data), status: row.status, revision: row.revision, reviewedAt: row.reviewed_at })),
    nextCursor: results.length > 50 && last ? JSON.stringify([last.submitted_at, last.id]) : null,
  });
}

export async function reviewSubmission(request: Request, env: Env, id: string, user: string): Promise<Response> {
  let data;
  try {
    data = await body(request);
    if (!data || !['new', 'reviewed'].includes(data.status) || !Number.isSafeInteger(data.revision) || data.revision < 1)
      throw new Error('Invalid review.');
  } catch { return fail('Invalid review.', 400); }
  const reviewedAt = data.status === 'reviewed' ? new Date().toISOString() : null;
  const result = await env.DB.prepare('UPDATE submissions SET status = ?, revision = revision + 1, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND revision = ?')
    .bind(data.status, data.status === 'reviewed' ? user : null, reviewedAt, id, data.revision).run();
  if (result.meta.changes !== 1) return fail('This submission changed. Refresh before reviewing it again.', 409);
  return Response.json({ status: data.status, revision: data.revision + 1, reviewedAt });
}
