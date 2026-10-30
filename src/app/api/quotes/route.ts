import { NextResponse } from 'next/server'
import { finalize } from '@/lib/compare'
import { derive } from '@/lib/venues/derive'
import { hyperliquid } from '@/lib/venues/hyperliquid'
import { polymarket } from '@/lib/venues/polymarket'
import type { Asset, Belief, VenueResult } from '@/lib/venues/types'

const VENUES = [derive, polymarket, hyperliquid]
const ASSETS: Asset[] = ['ETH', 'BTC']

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

  const results: VenueResult[] = await Promise.all(
    VENUES.map((v) => v.quote(belief).catch((e: Error): VenueResult => ({ venue: v.id, available: false, reason: e.message }))),
  )
  return NextResponse.json({ belief, ...finalize(results) })
}
