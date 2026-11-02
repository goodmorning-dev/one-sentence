import type { Belief, Venue, VenueResult } from './types'

const INFO = 'https://api.hyperliquid.xyz/info'

// HIP-4 outcomes pay no fee on opening; closing or settling pays the spot taker rate (0.07% at the base tier).
const SETTLE_FEE_RATE = 0.0007
// A YES book quoted wider than this is a placeholder (e.g. 0.002 / 0.996), not a market.
const MAX_SPREAD = 0.3
// Hyperliquid rejects orders worth less than this (valued at the limit price).
const MIN_ORDER_USD = 10

interface Outcome { outcome: number; name: string; description: string; venue?: string }
interface Level { px: string; sz: string }

async function info<T>(body: object): Promise<T> {
  const r = await fetch(INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
  return r.json() as Promise<T>
}

// "perp:ETH|threshold:2400|time:20261030-0800" -> { perp: 'ETH', threshold: '2400', time: '20261030-0800' }
const parseSpec = (s: string): Record<string, string> =>
  Object.fromEntries(s.split('|').map((kv) => [kv.slice(0, kv.indexOf(':')), kv.slice(kv.indexOf(':') + 1)]))
const hlTime = (t: string) => new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:00Z`)

// Two kinds of binaries: the canonical recurring daily one (strike = price at creation, settles 06:00 UTC)
// and builder-deployed "binaryPrice" outcomes with arbitrary strikes and times.
async function quote(b: Belief): Promise<VenueResult> {
  const link = 'https://app.hyperliquid.xyz'
  const meta = await info<{ outcomes: Outcome[] }>({ type: 'outcomeMeta' })
  const ymd = b.date.replaceAll('-', '')
  const markets = meta.outcomes
    .flatMap((o) => {
      const s = parseSpec(o.description)
      if (s.class === 'priceBinary' && s.underlying === b.asset && s.expiry?.startsWith(ymd))
        return [{ id: o.outcome, strike: +s.targetPrice, settles: hlTime(s.expiry), source: `Hyperliquid ${b.asset} mark price (canonical daily)` }]
      if (o.name === 'template:binaryPrice' && s.perp === b.asset && s.time?.startsWith(ymd))
        return [{ id: o.outcome, strike: +s.threshold, settles: hlTime(s.time), source: `${s.priceDescription}, ${s.seconds}s window` }]
      return []
    })
    .sort((x, y) => x.strike - y.strike)

  // Hyperliquid's own daily market is the one market makers always quote. When the sentence misses, offer it:
  // the soonest one, at a level just under its strike so the sentence lands on it.
  const daily = meta.outcomes
    .map((o) => parseSpec(o.description))
    .filter((s) => s.class === 'priceBinary' && s.underlying === b.asset && hlTime(s.expiry) > new Date())
    .sort((x, y) => x.expiry.localeCompare(y.expiry))[0]
  const suggest = daily ? { level: Math.floor(+daily.targetPrice), date: hlTime(daily.expiry).toISOString().slice(0, 10) } : undefined
  const missed = (reason: string): VenueResult => ({ venue: 'hyperliquid', available: false, reason, link, suggest })

  if (!markets.length) return missed(`No ${b.asset} market that day`)

  // Side 0 is YES; its spot coin is "#<10 × outcome + side>".
  const books = await Promise.all(markets.map((m) => info<{ levels: [Level[], Level[]] }>({ type: 'l2Book', coin: `#${10 * m.id}` })))
  const withBooks = markets.map((m, i) => {
    const [bids, asks] = books[i].levels
    const parsedAsks = asks.map((l) => ({ px: +l.px, sz: +l.sz }))
    const bid = bids[0] ? +bids[0].px : 0
    return { ...m, asks: parsedAsks, bid, live: parsedAsks.length > 0 && parsedAsks[0].px - bid <= MAX_SPREAD }
  })

  const m = withBooks.find((x) => x.strike >= b.level)
  if (!m) return missed(`No market at or above $${b.level.toLocaleString('en-US')} that day`)
  if (!m.live) return missed(`Nobody is trading the $${m.strike.toLocaleString('en-US')} market yet`)

  // Walk the YES asks with the stake, in whole shares (outcome sizes are integers on the book).
  let left = b.stake
  let shares = 0
  let worst = ''
  for (const { px, sz } of m.asks) {
    const take = Math.min(sz, Math.floor(left / px + 1e-9))
    if (take <= 0) break
    shares += take
    left -= take * px
    worst = String(px)
    if (take < sz) break
  }
  const spent = b.stake - left
  if (shares === 0) return { venue: 'hyperliquid', available: false, reason: 'Not enough on offer for this amount', link }
  // The order is valued at its limit price; Hyperliquid rejects orders under $10.
  if (shares * Number(worst) < MIN_ORDER_USD) {
    return { venue: 'hyperliquid', available: false, reason: `Hyperliquid's minimum order is $${MIN_ORDER_USD}; put in a little more`, link }
  }

  return {
    venue: 'hyperliquid',
    available: true,
    actualLevel: m.strike,
    settles: m.settles.toISOString(),
    priceSource: m.source,
    cost: spent,
    payoutIfRight: shares * (1 - SETTLE_FEE_RATE),
    impliedChance: spent / shares,
    how: `Buy ${shares.toFixed(2)} YES of outcome ${m.id}, avg ${(spent / shares).toFixed(4)}`,
    link,
    warnings: [
      ...(left > 0.01 ? [`The book only absorbs $${spent.toFixed(2)} of the stake`] : []),
      ...(m.strike !== b.level ? [`Nearest strike is $${m.strike}`] : []),
      'No fee on opening, about 0.07% of the payout at settlement',
    ],
    ticket: { venue: 'hyperliquid', asset: 100_000_000 + 10 * m.id, limitPx: worst, size: String(shares), depthChecked: true },
  }
}

export const hyperliquid: Venue = { id: 'hyperliquid', name: 'Hyperliquid', quote }
