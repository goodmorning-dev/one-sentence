import { buildHmacSignature } from '@polymarket/client'

// Remote builder signing: the browser SDK asks us to sign its relayer requests so the builder secret never
// leaves the server. Only our own pages may use it.
export async function POST(req: Request) {
  const { POLY_BUILDER_API_KEY: key, POLY_BUILDER_SECRET: secret, POLY_BUILDER_PASSPHRASE: passphrase } = process.env
  if (!key || !secret || !passphrase) {
    return Response.json({ error: 'Polymarket builder API key is not configured' }, { status: 503 })
  }
  const origin = req.headers.get('origin')
  if (origin && new URL(origin).host !== req.headers.get('host')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { method, path, body } = await req.json()
  if (typeof method !== 'string' || typeof path !== 'string') {
    return Response.json({ error: 'method and path are required' }, { status: 400 })
  }
  const timestamp = Math.floor(Date.now() / 1000)
  return Response.json({
    POLY_BUILDER_API_KEY: key,
    POLY_BUILDER_PASSPHRASE: passphrase,
    POLY_BUILDER_SIGNATURE: await buildHmacSignature(secret, timestamp, method, path, body),
    POLY_BUILDER_TIMESTAMP: `${timestamp}`,
  })
}
