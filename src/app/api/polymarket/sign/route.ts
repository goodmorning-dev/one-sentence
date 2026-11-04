import { buildHmacSignature } from '@polymarket/client'

// The relayer calls the Polymarket SDK asks us to sign (method, path without the query). Nothing else gets our
// builder signature, so the route can't be used to sign arbitrary builder-authenticated requests.
const ALLOWED: [string, RegExp][] = [
  ['GET', /^\/deployed$/],
  ['GET', /^\/v1\/account\/transactions\/params$/],
  ['GET', /^\/v1\/account\/transactions\/[\w-]+$/],
  ['POST', /^\/submit$/],
  ['POST', /^\/v1\/session-signers\/authorizations$/],
]
const MAX_BODY = 20_000

// Remote builder signing: the browser SDK asks us to sign its relayer requests so the builder secret never
// leaves the server. Only our own pages may use it: the browser always sends Origin on this POST, so a missing
// or foreign Origin is refused.
export async function POST(req: Request) {
  const { POLY_BUILDER_API_KEY: key, POLY_BUILDER_SECRET: secret, POLY_BUILDER_PASSPHRASE: passphrase } = process.env
  if (!key || !secret || !passphrase) {
    return Response.json({ error: 'Polymarket builder API key is not configured' }, { status: 503 })
  }
  const origin = req.headers.get('origin')
  let sameSite = false
  try {
    sameSite = !!origin && new URL(origin).host === req.headers.get('host')
  } catch {}
  if (!sameSite) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const raw = await req.text()
  if (raw.length > MAX_BODY) return Response.json({ error: 'Too large' }, { status: 413 })
  let parsed: { method?: unknown; path?: unknown; body?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { method, path, body } = parsed
  if (typeof method !== 'string' || typeof path !== 'string' || (body !== undefined && typeof body !== 'string')) {
    return Response.json({ error: 'method and path are required' }, { status: 400 })
  }
  const pathname = path.split('?')[0]
  if (!ALLOWED.some(([m, p]) => m === method.toUpperCase() && p.test(pathname))) {
    return Response.json({ error: 'Not a request we sign' }, { status: 403 })
  }

  const timestamp = Math.floor(Date.now() / 1000)
  return Response.json({
    POLY_BUILDER_API_KEY: key,
    POLY_BUILDER_PASSPHRASE: passphrase,
    POLY_BUILDER_SIGNATURE: await buildHmacSignature(secret, timestamp, method, path, body),
    POLY_BUILDER_TIMESTAMP: `${timestamp}`,
  })
}
