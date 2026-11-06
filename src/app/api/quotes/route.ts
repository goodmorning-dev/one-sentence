import { NextResponse } from 'next/server'
import { finalize } from '@/lib/compare'
import { derive } from '@/lib/venues/derive'
import { hyperliquid } from '@/lib/venues/hyperliquid'
import { polymarket } from '@/lib/venues/polymarket'
import type { Asset, Belief, Direction, Venue, VenueResult } from '@/lib/venues/types'

const VENUES = [derive, polymarket, hyperliquid]
const ASSETS: Asset[] = ['ETH', 'BTC']
const NEARBY = 0.03 // how far on the easier side of the sentence's price an alternative may be

// A calendar date that exists (no 31 February) and isn't before today in UTC, where every venue's day is counted.
function realDate(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const t = new Date(`${d}T00:00:00Z`)
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d && d >= new Date().toISOString().slice(0, 10)
}

// GET /api/quotes?asset=ETH&direction=above&level=2400&date=2026-10-30&stake=100 (direction defaults to above)
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const belief: Belief = {
    asset: (q.get('asset') ?? 'ETH').toUpperCase() as Asset,
    direction: (q.get('direction') ?? 'above') as Direction,
    level: Number(q.get('level')),
    date: q.get('date') ?? '',
    stake: Number(q.get('stake') ?? 100),
  }
  if (!ASSETS.includes(belief.asset) || !['above', 'below'].includes(belief.direction) || !(belief.level > 0) || !realDate(belief.date) || !(belief.stake > 0)) {
    return NextResponse.json({ error: 'Expected asset (ETH|BTC), direction (above|below), level > 0, a real date YYYY-MM-DD from today on, stake > 0' }, { status: 400 })
  }

  const ask = (v: Venue, b: Belief) => v.quote(b).catch((e: Error): VenueResult => ({ venue: v.id, available: false, reason: e.message }))
  const results: VenueResult[] = await Promise.all(
    VENUES.map(async (v) => {
      const r = await ask(v, belief)
      // Venues only quote a price at or past the sentence's. One that has nothing there but a price just short of
      // it on the same day ($2,293 for "above $2,300") shows that bet too, as an alternative, rather than only a "Try".
      const s = !r.available ? r.suggest : undefined
      const easier = s && (belief.direction === 'below' ? s.level > belief.level : s.level < belief.level)
      if (!s || s.date !== belief.date || !easier || Math.abs(belief.level - s.level) / belief.level > NEARBY) return r
      const near = await ask(v, { ...belief, level: s.level })
      return near.available ? near : r
    }),
  )
  return NextResponse.json({ belief, ...finalize(results, belief.level, belief.stake, belief.direction) })
}
