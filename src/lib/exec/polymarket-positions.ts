import type { Position } from './types'

// Public Polymarket APIs, read from the browser (CORS allowed). Gamma maps the user's own wallet to their
// Polymarket account (the Deposit Wallet), and the Data API lists what that account holds.
const GAMMA = 'https://gamma-api.polymarket.com'
const DATA = 'https://data-api.polymarket.com'

interface OpenRow {
  asset: string; title: string; outcome: string; size: number; initialValue: number; currentValue: number
  cashPnl: number; curPrice: number; redeemable: boolean; endDate: string; eventSlug: string; slug: string
}
interface ClosedRow {
  asset: string; title: string; outcome: string; avgPrice: number; totalBought: number; realizedPnl: number
  curPrice: number; endDate: string; eventSlug: string; slug: string
}

const link = (r: { eventSlug: string; slug: string }) => `https://polymarket.com/event/${r.eventSlug}/${r.slug}`

export async function polymarketPositions(owner: string): Promise<Position[]> {
  const profile = await fetch(`${GAMMA}/public-profile?address=${owner}`)
  if (profile.status === 404) return [] // never used Polymarket
  const account: string | undefined = (await profile.json()).proxyWallet
  if (!account) return []

  const [open, closed]: [OpenRow[], ClosedRow[]] = await Promise.all([
    fetch(`${DATA}/positions?user=${account}&sizeThreshold=0&limit=200`).then((r) => r.json()),
    fetch(`${DATA}/closed-positions?user=${account}&limit=50`).then((r) => r.json()),
  ])

  return [
    // Open rows include decided markets whose payout is not collected yet (redeemable).
    ...open.map((r): Position => ({
      venue: 'polymarket',
      id: r.asset,
      title: r.title,
      outcome: r.outcome,
      shares: r.size,
      cost: r.initialValue,
      value: r.currentValue,
      payoutIfRight: r.size,
      pnl: r.cashPnl,
      status: !r.redeemable ? 'live' : r.curPrice > 0.5 ? 'claimable' : 'lost',
      ends: r.endDate,
      link: link(r),
    })),
    ...closed.map((r): Position => {
      const cost = r.avgPrice * r.totalBought
      return {
        venue: 'polymarket',
        id: `${r.asset}-closed`,
        title: r.title,
        outcome: r.outcome,
        shares: r.totalBought,
        cost,
        value: cost + r.realizedPnl,
        payoutIfRight: r.totalBought,
        pnl: r.realizedPnl,
        status: r.curPrice === 1 ? 'won' : r.curPrice === 0 ? 'lost' : 'sold',
        ends: r.endDate,
        link: link(r),
      }
    }),
  ]
}
