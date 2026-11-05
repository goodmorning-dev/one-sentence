// Derive's REST API only answers browsers on its own domains (CORS), so the bet flow's calls come through here.
// Nothing is stored or signed on this side: requests are already signed in the user's browser (by their wallet or
// the session key it approved) and are forwarded as they are. Only our pages, and only the methods the bet,
// deposit, withdraw and My bets screens use.
const API = 'https://api.derive.xyz/v3'

const ALLOWED = new Set([
  'public/get_instrument',
  'public/get_ticker',
  'public/get_subaccounts',
  'public/register_deposit_address',
  'public/get_pending_deposits',
  'private/set_session_key',
  'private/session_keys',
  'private/get_subaccount',
  'private/get_positions',
  'private/order',
  'private/send_rfq',
  'private/rfq_get_best_quote',
  'private/execute_quote',
  'private/cancel_rfq',
  'private/withdraw',
  'private/get_withdrawal_history',
  'private/get_deposit_history',
  'private/get_trade_history',
  'private/get_option_settlement_history',
])
const HEADERS = ['x-derivewallet', 'x-derivetimestamp', 'x-derivesignature']
const MAX_BODY = 20_000

// The Origin check stops other sites' pages, not scripts that set the header themselves, so each client IP also
// gets a budget. Per server instance only: enough to stop one client hammering Derive through us.
const LIMIT = 120 // requests per minute; a bet polls about 15
const hits = new Map<string, { n: number; until: number }>()
function overLimit(ip: string) {
  const now = Date.now()
  if (hits.size > 5000) for (const [k, v] of hits) if (v.until < now) hits.delete(k)
  const h = hits.get(ip)
  if (!h || h.until < now) {
    hits.set(ip, { n: 1, until: now + 60_000 })
    return false
  }
  return ++h.n > LIMIT
}

export async function POST(req: Request, ctx: { params: Promise<{ method: string[] }> }) {
  const origin = req.headers.get('origin')
  let sameSite = false
  try {
    sameSite = !!origin && new URL(origin).host === req.headers.get('host')
  } catch {}
  if (!sameSite) return Response.json({ error: { message: 'Forbidden' } }, { status: 403 })
  const ip = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (overLimit(ip)) return Response.json({ error: { message: 'Too many requests; try again in a minute' } }, { status: 429 })

  const method = (await ctx.params).method.join('/')
  if (!ALLOWED.has(method)) return Response.json({ error: { message: 'Not a method we forward' } }, { status: 403 })
  const body = await req.text()
  if (body.length > MAX_BODY) return Response.json({ error: { message: 'Too large' } }, { status: 413 })

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  for (const h of HEADERS) {
    const v = req.headers.get(h)
    if (v) headers[h] = v
  }
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers, body, cache: 'no-store' })
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
