import { NextResponse } from 'next/server'
import { finalize } from '@/lib/compare'
import { derive } from '@/lib/venues/derive'
import { hyperliquid } from '@/lib/venues/hyperliquid'
import { polymarket } from '@/lib/venues/polymarket'
import type { Asset, Belief, Venue, VenueResult } from '@/lib/venues/types'

const VENUES = [derive, polymarket, hyperliquid]
const ASSETS: Asset[] = ['ETH', 'BTC']
const NEARBY = 0.03 // how far below the sentence's price an alternative may be

// GET /api/quotes?asset=ETH&level=2400&date=2026-10-30&stake=100
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const belief: Belief = {
    asset: (q.get('asset') ?? 'ETH').toUpperCase() as Asset,
    direction: 'above',
    level: Number(q.get('level')),
    date: q.get('date') ?? '',
    stake: Number(q.get('stake') ?? 100),
  }
  if (!ASSETS.includes(belief.asset) || !(belief.level > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(belief.date) || !(belief.stake > 0)) {
    return NextResponse.json({ error: 'Expected asset (ETH|BTC), level > 0, date YYYY-MM-DD, stake > 0' }, { status: 400 })
  }

  const ask = (v: Venue, b: Belief) => v.quote(b).catch((e: Error): VenueResult => ({ venue: v.id, available: false, reason: e.message }))
  const results: VenueResult[] = await Promise.all(
    VENUES.map(async (v) => {
      const r = await ask(v, belief)
      // Venues only quote a price at or above the sentence's. One that has nothing there but a price just below
      // it on the same day ($2,293 for $2,300) shows that bet too, as an alternative, rather than only a "Try".
      const s = !r.available ? r.suggest : undefined
      if (!s || s.date !== belief.date || s.level >= belief.level || (belief.level - s.level) / belief.level > NEARBY) return r
      const near = await ask(v, { ...belief, level: s.level })
      return near.available ? near : r
    }),
  )
  return NextResponse.json({ belief, ...finalize(results, belief.level) })
}
