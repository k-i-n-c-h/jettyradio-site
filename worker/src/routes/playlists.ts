import { Env } from '../index'

export async function handlePlaylists(env: Env): Promise<Response> {
  const res = await fetch(`${env.AZURACAST_BASE_URL}/api/station/1/playlists`, {
    headers: { 'X-API-Key': env.AZURACAST_API_KEY },
  })

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch playlists' }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const data = await res.json()
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })
}
