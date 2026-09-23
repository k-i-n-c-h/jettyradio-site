import { client, type Media } from './azura';
import { readLimited } from './body';
import type { Env } from './types';

function tagName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a tag name.');
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name))
    throw new Error('Tags must contain 1–40 printable characters.');
  return name;
}

export async function episodeTags(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    try {
      const [bank, assignments] = await env.DB.batch<{ name: string; media_id: number; media_path: string; tag: string }>([
        env.DB.prepare('SELECT name FROM episode_tag_bank ORDER BY name'),
        env.DB.prepare('SELECT media_id, media_path, tag FROM episode_tags ORDER BY tag'),
      ]);
      return Response.json({ tags: bank.results.map(row => row.name), assignments: assignments.results });
    } catch (error) {
      if (error instanceof Error && /no such table: (?:main\.)?episode_(?:tag_bank|tags)\b/i.test(error.message))
        return Response.json({ error: 'Episode tags are not set up in this database yet. Apply the episode-tags database migration, then refresh.' }, { status: 503 });
      return Response.json({ error: 'Could not load the genre tag bank. Please retry shortly.' }, { status: 503 });
    }
  }
  try {
    const body = JSON.parse(new TextDecoder().decode(await readLimited(request, 4096)));
    const name = tagName(body.name);
    await env.DB.prepare('INSERT OR IGNORE INTO episode_tag_bank (name) VALUES (?)').bind(name).run();
    return Response.json({ name });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create tag.' }, { status: 400 });
  }
}

export async function updateEpisode(request: Request, env: Env, id: number): Promise<Response> {
  let detailsSaved = false;
  try {
    const body = JSON.parse(new TextDecoder().decode(await readLimited(request, 65536)));
    if (typeof body.path !== 'string' || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 255 ||
        typeof body.artist !== 'string' || body.artist.length > 255 || typeof body.lyrics !== 'string' || body.lyrics.length > 20000)
      throw new Error('Enter a title (up to 255 characters), artist (up to 255), and tracklist (up to 20,000).');
    if (!Array.isArray(body.tags) || body.tags.length > 20) throw new Error('Choose up to 20 tags per episode.');
    const tags = [...new Set<string>(body.tags.map(tagName))].sort();
    let airDate: string | undefined;
    if (body.airDate !== undefined) {
      if (typeof body.airDate !== 'string') throw new Error('Choose a valid air date.');
      if (body.airDate === '') airDate = '';
      else {
        const date = new Date(`${body.airDate}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.airDate) || !Number.isFinite(date.getTime()) ||
            date.toISOString().slice(0, 10) !== body.airDate || body.airDate.startsWith('0000'))
          throw new Error('Choose a valid air date.');
        airDate = `${body.airDate.slice(5, 7)}/${body.airDate.slice(8, 10)}/${body.airDate.slice(0, 4)}`;
      }
    }
    const azura = client(env);
    const file = await azura(`/file/${id}`) as Media;
    if (file.path !== body.path) throw new Error('This episode moved. Refresh the library before editing.');
    const details = {
      title: body.title.trim(), artist: body.artist.trim(), lyrics: body.lyrics,
      ...(airDate === undefined ? {} : { custom_fields: { ...file.custom_fields, air_date: airDate } }),
    };
    if (file.title !== details.title || file.artist !== details.artist || (file.lyrics || '') !== details.lyrics ||
        (airDate !== undefined && (file.custom_fields?.air_date || '') !== airDate)) {
      await azura(`/file/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details) });
      detailsSaved = true;
    }
    await env.DB.batch([
      ...tags.map(tag => env.DB.prepare('INSERT OR IGNORE INTO episode_tag_bank (name) VALUES (?)').bind(tag)),
      env.DB.prepare('DELETE FROM episode_tags WHERE media_id = ? AND media_path = ?').bind(id, file.path),
      ...tags.map(tag => env.DB.prepare('INSERT INTO episode_tags (media_id, media_path, tag) VALUES (?, ?, ?)').bind(id, file.path, tag)),
    ]);
    return Response.json({ ...details, tags });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save episode.';
    return Response.json({ error: detailsSaved ? `Episode details saved, but tags could not be saved. ${message} Retry saving to finish.` : message }, { status: 400 });
  }
}
