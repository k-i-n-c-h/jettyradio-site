import { verifyToken } from './auth'
import { handlePlaylists } from './routes/playlists'
import { handleUpload } from './routes/upload'
import { handleFinalize } from './routes/finalize'

export interface Env {
  AZURACAST_BASE_URL: string
  AZURACAST_API_KEY: string
  CLERK_JWKS_URL: string
  ALLOWED_ORIGIN: string
}

function corsHeaders(origin: string | null, allowedOrigin: string): HeadersInit {
  const allowed =
    origin &&
    (origin === allowedOrigin ||
      origin.startsWith('http://localhost:') ||
      origin === 'http://localhost')
      ? origin
      : allowedOrigin

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN)

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Verify JWT
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing authorization token' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const valid = await verifyToken(token, env.CLERK_JWKS_URL)
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Route dispatch
    const url = new URL(request.url)
    let response: Response

    switch (url.pathname) {
      case '/api/playlists':
        response = await handlePlaylists(env)
        break
      case '/api/upload':
        response = await handleUpload(request, env)
        break
      case '/api/finalize-upload':
        response = await handleFinalize(request, env)
        break
      default:
        response = new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
    }

    // Attach CORS headers to response
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(cors)) {
      headers.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    })
  },
}
