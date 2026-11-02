import type { Position } from './types'

// Public Hyperliquid info API, read-only. Outcome shares sit in the spot balance as "+<encoding>"
// (encoding = 10 × outcome + side; side 0 is YES). Settled outcomes pay out automatically and leave the
// balance, so finished bets are rebuilt from the user's fills plus each outcome's settlement.
const INFO = 'https://api.hyperliquid.xyz/info'
const SETTLE_FEE_RATE = 0.0007

interface OutcomeSpec { outcome: number; description: string; sideSpecs: { name: string }[] }
interface Fill { coin: string; px: string; sz: string; side: 'B' | 'A'; time: number; dir: string; fee?: string }

const post = <T,>(body: object): Promise<T> =>
  fetch(INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

const spec = (s: string): Record<string, string> =>
  Object.fromEntries(s.split('|').map((kv) => [kv.slice(0, kv.indexOf(':')), kv.slice(kv.indexOf(':') + 1)]))
const hlDate = (t: string) => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:00Z`

// "ETH above $2,291.4 on 2026-11-03T06:00Z" from either kind of price binary.
function describe(o: OutcomeSpec): { title: string; ends: string } {
  const s = spec(o.description)
  const asset = s.underlying ?? s.perp
  const strike = s.targetPrice ?? s.threshold
  const time = s.expiry ?? s.time
  if (!asset || !strike || !time) return { title: o.description, ends: new Date().toISOString() }
  const ends = hlDate(time)
  const when = new Date(ends).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  return { title: `${asset} above $${Number(strike).toLocaleString('en-US')} on ${when}`, ends }
}

export async function hyperliquidPositions(owner: string): Promise<Position[]> {
  const [meta, spot, fills, mids] = await Promise.all([
    post<{ outcomes: OutcomeSpec[] }>({ type: 'outcomeMeta' }),
    post<{ balances: { coin: string; total: string; entryNtl: string }[] }>({ type: 'spotClearinghouseState', user: owner }),
    post<Fill[]>({ type: 'userFills', user: owner }),
    post<Record<string, string>>({ type: 'allMids' }),
  ])
  const outcomes = new Map(meta.outcomes.map((o) => [o.outcome, o]))
  const link = 'https://app.hyperliquid.xyz/portfolio'

  const open = spot.balances
    .filter((b) => b.coin.startsWith('+') && Number(b.total) > 0)
    .map((b): Position | null => {
      const enc = Number(b.coin.slice(1))
      const o = outcomes.get(Math.floor(enc / 10))
      if (!o) return null
      const shares = Number(b.total)
      const cost = Number(b.entryNtl)
      const value = shares * Number(mids[`#${enc}`] ?? 0)
      const { title, ends } = describe(o)
      return {
        venue: 'hyperliquid',
        id: b.coin,
        title,
        outcome: o.sideSpecs[enc % 10]?.name ?? 'Yes',
        shares,
        cost,
        value,
        payoutIfRight: shares * (1 - SETTLE_FEE_RATE),
        pnl: value - cost,
        status: 'live',
        ends,
        link,
      }
    })
    .filter((p): p is Position => p !== null)

  // Finished: outcome coins the user traded that are no longer held.
  const held = new Set(open.map((p) => p.id.slice(1)))
  const traded = new Map<number, Fill[]>()
  for (const f of fills.filter((f) => f.coin.startsWith('#'))) {
    const enc = Number(f.coin.slice(1))
    if (held.has(String(enc))) continue
    traded.set(enc, [...(traded.get(enc) ?? []), f])
  }

  // Settlement shows up as a fill with dir "Settlement" at the settle price (1 = won, 0 = lost), fee included.
  const closed = await Promise.all(
    [...traded.entries()].slice(0, 30).map(async ([enc, fs]): Promise<Position> => {
      const outcomeId = Math.floor(enc / 10)
      const amount = (f: Fill) => Number(f.px) * Number(f.sz) - Number(f.fee ?? 0)
      const bought = fs.filter((f) => f.side === 'B')
      const settlement = fs.filter((f) => f.dir === 'Settlement')
      const sold = fs.filter((f) => f.side === 'A' && f.dir !== 'Settlement')
      const cost = bought.reduce((s, f) => s + Number(f.px) * Number(f.sz) + Number(f.fee ?? 0), 0)
      const payout = settlement.reduce((s, f) => s + amount(f), 0)
      const value = sold.reduce((s, f) => s + amount(f), 0) + payout
      const sharesIn = bought.reduce((s, f) => s + Number(f.sz), 0)

      // Outcomes that settled long ago drop out of outcomeMeta; their spec is still on the settlement record.
      const o = outcomes.get(outcomeId) ?? (await post<{ spec?: OutcomeSpec } | null>({ type: 'settledOutcome', outcome: outcomeId }).catch(() => null))?.spec
      const { title, ends } = o ? describe(o) : { title: `Outcome ${outcomeId}`, ends: new Date(fs[0].time).toISOString() }

      return {
        venue: 'hyperliquid',
        id: `#${enc}-closed`,
        title,
        outcome: enc % 10 === 0 ? 'Yes' : 'No',
        shares: sharesIn,
        cost,
        value,
        payoutIfRight: sharesIn,
        pnl: value - cost,
        status: settlement.length ? (payout > 0 ? 'won' : 'lost') : 'sold',
        ends,
        link,
      }
    }),
  )

  return [...open, ...closed]
}
