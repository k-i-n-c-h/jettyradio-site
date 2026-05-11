import { createRemoteJWKSet, jwtVerify } from 'jose'

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

export async function verifyToken(
  token: string,
  jwksUrl: string
): Promise<boolean> {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl))
  }
  try {
    await jwtVerify(token, jwks)
    return true
  } catch {
    return false
  }
}
