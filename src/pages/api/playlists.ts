import type { APIRoute } from 'astro';

export const prerender = false;

const AZURACAST_BASE = 'https://stream.jettyradio.com/api/station/1';

export const GET: APIRoute = async ({ locals }) => {
  const { userId } = locals.auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch(`${AZURACAST_BASE}/playlists`, {
    headers: { 'X-API-Key': import.meta.env.AZURACAST_API_KEY },
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch playlists' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
