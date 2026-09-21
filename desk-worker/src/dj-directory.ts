import type { Env } from './types';
import { parseDirectory } from '../../src/lib/backstage/directory';

// Only called after the Worker's Clerk signature, issuer, origin and team
// allowlist checks. The roster lives in D1, never in the static site bundle.
export async function getDJDirectory(env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT data FROM dj_directory WHERE id = ?')
    .bind('jetty').first<{ data: string }>();
  if (!row) return Response.json({ error: 'The DJ roster has not been imported yet. Ask the station organizer to import it.' }, { status: 503 });
  return Response.json({ records: parseDirectory(JSON.parse(row.data)) });
}
