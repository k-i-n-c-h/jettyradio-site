import type { APIRoute } from 'astro';

export const prerender = false;

const AZURACAST_BASE = 'https://stream.jettyradio.com/api/station/1';

export const POST: APIRoute = async ({ request, locals }) => {
  const { userId } = locals.auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { unique_id, title, artist, setlist, air_date, playlist_id, cover_art } =
    await request.json();

  const apiKey = import.meta.env.AZURACAST_API_KEY;

  // Update file metadata
  const updateRes = await fetch(`${AZURACAST_BASE}/file/${unique_id}`, {
    method: 'PUT',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      artist,
      lyrics: setlist,
      custom_fields: { air_date },
      playlists: playlist_id ? [{ id: playlist_id }] : [],
    }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: 'Failed to update metadata', details: err }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Upload cover art if provided
  if (cover_art) {
    const base64Data = cover_art.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = Buffer.from(base64Data, 'base64');

    const artForm = new FormData();
    artForm.append('art', new Blob([binaryData]), 'cover.jpg');

    await fetch(`${AZURACAST_BASE}/file/${unique_id}/art`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body: artForm,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
