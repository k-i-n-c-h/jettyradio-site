import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const worker = `${root}desk-worker`;
const privateDirectory = `${root}private`;
mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
const temporary = mkdtempSync(`${privateDirectory}/submission-sync-`);

function wrangler(args, json = false) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    cwd: worker,
    encoding: 'utf8',
    stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || 'Wrangler failed. Check your Cloudflare login and retry.');
  return json ? JSON.parse(result.stdout) : undefined;
}

const columns = ['id', 'submitted_at', 'received_at', 'data', 'status', 'revision', 'reviewed_by', 'reviewed_at'];
const quote = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
let cursor = '';
let total = 0;
try {
  wrangler(['d1', 'migrations', 'apply', 'jettyradio-desk', '--local']);
  while (true) {
    const response = wrangler(['d1', 'execute', 'jettyradio-desk', '--remote', '--json', '--command',
      `SELECT ${columns.join(', ')} FROM submissions WHERE id > ${quote(cursor)} ORDER BY id LIMIT 100`], true);
    if (!Array.isArray(response) || response.length !== 1 || !response[0].success || !Array.isArray(response[0].results))
      throw new Error('Unexpected response from the production database.');
    const rows = response[0].results;
    if (!rows.length) break;
    for (const row of rows) {
      if (typeof row.id !== 'string' || !/^[a-f0-9]{64}$/.test(row.id) || row.id <= cursor)
        throw new Error('Unexpected submission identity.');
      cursor = row.id;
    }
    const sql = rows.map(row => `INSERT OR IGNORE INTO submissions (${columns.join(', ')}) VALUES (${columns.map(key => quote(row[key])).join(', ')});`).join('\n');
    const path = `${temporary}/submissions.sql`;
    writeFileSync(path, sql, { mode: 0o600 });
    const imported = wrangler(['d1', 'execute', 'jettyradio-desk', '--local', '--file', path, '--json'], true);
    if (!Array.isArray(imported) || !imported.length || imported.some(result => !result.success))
      throw new Error('Local import did not complete. Retry to import any missing submissions.');
    total += rows.length;
    if (rows.length < 100) break;
  }
  console.log(`Synced ${total} production submissions to localhost. Existing local reviews were preserved.`);
  console.log('Refresh http://localhost:4321/backstage/submissions');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
