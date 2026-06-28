import { Env } from '../index'

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get('Content-Type')
  if (!contentType?.startsWith('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const res = await fetch(`${env.AZURACAST_BASE_URL}/api/station/1/files`, {
    method: 'POST',
    headers: {
      'X-API-Key': env.AZURACAST_API_KEY,
      'Content-Type': contentType,
    },
    body: request.body,
  })

  const data = await res.json()
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
