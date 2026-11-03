import type { Position } from './types'

// Public Polymarket APIs, read from the browser (CORS allowed). Gamma maps the user's own wallet to their
// Polymarket account (the Deposit Wallet), and the Data API lists what that account holds.
const GAMMA = 'https://gamma-api.polymarket.com'
const DATA = 'https://data-api.polymarket.com'

// Data API v2 (docs.polymarket.com/migrate/data-api-v1-to-v2). v1 now answers 410 without CORS headers, which
// the browser reports as a failed request. One row shape for every state: OPEN rows include markets already
// decided whose payout isn't collected (status REDEEMABLE); CLOSED rows are sold or redeemed.
interface Row {
  token_id: string; title: string; outcome: string; status: string; current_size: number; total_size: number
  avg_price: number; current_value: number; current_price: number; realized_pnl: number; total_pnl: number
  end_date: string; event_slug: string; slug: string
}

const link = (r: Row) => `https://polymarket.com/event/${r.event_slug}/${r.slug}`

// The Polymarket account is the user's own and may hold anything (elections, sports). We only show the kind of
// bet One sentence places: the daily "Ethereum/Bitcoin above ___ on <date>" events (see venues/polymarket.ts).
const OURS = /^(ethereum|bitcoin)-above-on-/

async function rows(account: string, status: 'OPEN' | 'CLOSED', limit: number): Promise<Row[]> {
  const r = await fetch(`${DATA}/v2/positions?user=${account}&status=${status}&limit=${limit}`)
  if (!r.ok) throw new Error(`Polymarket positions: ${r.status}`)
  const data: Row[] = (await r.json()).data ?? []
  return data.filter((row) => OURS.test(row.event_slug))
}

export async function polymarketPositions(owner: string): Promise<Position[]> {
  const profile = await fetch(`${GAMMA}/public-profile?address=${owner}`)
  if (profile.status === 404) return [] // never used Polymarket
  const account: string | undefined = (await profile.json()).proxyWallet
  if (!account) return []

  const [open, closed] = await Promise.all([rows(account, 'OPEN', 200), rows(account, 'CLOSED', 200)])

  return [
    ...open.map((r): Position => ({
      venue: 'polymarket',
      id: r.token_id,
      title: r.title,
      outcome: r.outcome,
      shares: r.current_size,
      cost: r.avg_price * r.current_size,
      value: r.current_value,
      payoutIfRight: r.current_size,
      pnl: r.total_pnl,
      status: r.status !== 'REDEEMABLE' ? 'live' : r.current_price > 0.5 ? 'claimable' : 'lost',
      ends: r.end_date,
      link: link(r),
    })),
    // Everything held at some point is gone: sold early, or decided and redeemed.
    ...closed.map((r): Position => {
      const cost = r.avg_price * r.total_size
      return {
        venue: 'polymarket',
        id: `${r.token_id}-closed`,
        title: r.title,
        outcome: r.outcome,
        shares: r.total_size,
        cost,
        value: cost + r.realized_pnl,
        payoutIfRight: r.total_size,
        pnl: r.realized_pnl,
        status: r.current_price === 1 ? 'won' : r.current_price === 0 ? 'lost' : 'sold',
        ends: r.end_date,
        link: link(r),
      }
    }),
  ]
}
