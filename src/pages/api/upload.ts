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

  const formData = await request.formData();

  const res = await fetch(`${AZURACAST_BASE}/files`, {
    method: 'POST',
    headers: { 'X-API-Key': import.meta.env.AZURACAST_API_KEY },
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
