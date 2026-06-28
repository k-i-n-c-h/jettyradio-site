import { Env } from '../index'

interface FinalizeBody {
  file_id: number
  title: string
  artist?: string
  playlist_id: number
  air_date?: string
  setlist?: string
  cover_art?: string // base64-encoded image
}

export async function handleFinalize(request: Request, env: Env): Promise<Response> {
  let body: FinalizeBody
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { file_id, title, artist, playlist_id, air_date, setlist, cover_art } = body

  // Update file metadata
  const metaRes = await fetch(
    `${env.AZURACAST_BASE_URL}/api/station/1/file/${file_id}`,
    {
      method: 'PUT',
      headers: {
        'X-API-Key': env.AZURACAST_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        artist: artist || '',
        lyrics: setlist || '',
        custom_fields: air_date ? { air_date } : undefined,
      }),
    }
  )

  if (!metaRes.ok) {
    const err = await metaRes.text()
    return new Response(JSON.stringify({ error: 'Failed to update metadata', details: err }), {
      status: metaRes.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Add file to playlist
  const playlistRes = await fetch(
    `${env.AZURACAST_BASE_URL}/api/station/1/playlist/${playlist_id}`,
    {
      method: 'PUT',
      headers: {
        'X-API-Key': env.AZURACAST_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        import_playlist_media: [file_id],
      }),
    }
  )

  if (!playlistRes.ok) {
    const err = await playlistRes.text()
    return new Response(
      JSON.stringify({ error: 'Failed to add to playlist', details: err }),
      { status: playlistRes.status, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Upload cover art if provided
  if (cover_art) {
    const artRes = await fetch(
      `${env.AZURACAST_BASE_URL}/api/station/1/art/${file_id}`,
      {
        method: 'POST',
        headers: {
          'X-API-Key': env.AZURACAST_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ art: cover_art }),
      }
    )
    if (!artRes.ok) {
      // Non-fatal — metadata and playlist already saved
      console.error('Cover art upload failed:', await artRes.text())
    }
  }

  return new Response(JSON.stringify({ success: true, file_id }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
