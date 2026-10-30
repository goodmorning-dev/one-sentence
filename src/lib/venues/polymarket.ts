import type { Belief, Quote, Venue, VenueResult } from './types'

const GAMMA = 'https://gamma-api.polymarket.com'
export const CLOB = 'https://clob.polymarket.com'

// Taker fee: shares × rate × p × (1 − p). Gamma returns the rate per market in feeSchedule; 0.07 is the crypto default.
const CRYPTO_FEE_RATE = 0.07

const ASSET_NAMES = { ETH: 'ethereum', BTC: 'bitcoin' } as const

interface GammaMarket {
  question: string; groupItemTitle: string; bestAsk: number; closed: boolean; endDate: string; orderMinSize: number; feesEnabled: boolean
  clobTokenIds: string; acceptingOrders: boolean; feeSchedule?: { rate: number }; orderPriceMinTickSize: number
}
interface GammaEvent { slug: string; closed: boolean; restricted: boolean; markets: GammaMarket[] }

export interface BookLevel { price: string | number; size: string | number }

const money = (n: number) => `$${n.toFixed(2)}`
const ESTIMATE_WARNING = 'Estimated from the last price; the order book has not been checked yet'

// Polymarket lists "Ethereum above ___ on <Month> <day>?" events with one YES/NO market per strike.
async function quote(b: Belief): Promise<VenueResult> {
  const d = new Date(`${b.date}T00:00:00Z`)
  const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase()
  const slug = `${ASSET_NAMES[b.asset]}-above-on-${month}-${d.getUTCDate()}-${d.getUTCFullYear()}`
  const link = `https://polymarket.com/event/${slug}`
  const events: GammaEvent[] = await (await fetch(`${GAMMA}/events?slug=${slug}`, { next: { revalidate: 15 } })).json()
  const event = events[0]
  if (!event || event.closed) return { venue: 'polymarket', available: false, reason: `No open "${b.asset} above" event for ${b.date}` }

  const m = event.markets
    .filter((x) => !x.closed && x.bestAsk > 0)
    .map((x) => ({ ...x, strike: Number(String(x.groupItemTitle).replace(/[^0-9.]/g, '')) }))
    .sort((x, y) => x.strike - y.strike)
    .find((x) => x.strike >= b.level)
  if (!m) return { venue: 'polymarket', available: false, reason: `No strike at or above $${b.level}`, link }
  if (!m.acceptingOrders) return { venue: 'polymarket', available: false, reason: 'This market is not taking orders right now', link }

  // Gamma's bestAsk is a lagging summary: good enough to find the market, never to price the bet.
  const p = Number(m.bestAsk)
  const feeRate = m.feesEnabled ? (m.feeSchedule?.rate ?? CRYPTO_FEE_RATE) : 0
  const shares = b.stake / (p + feeRate * p * (1 - p))
  const tokenId: string = JSON.parse(m.clobTokenIds)[0]
  const estimate: Quote = {
    venue: 'polymarket',
    available: true,
    actualLevel: m.strike,
    settles: m.endDate,
    priceSource: `Binance ${b.asset}/USDT 1-min candle close at 12:00 ET, strictly higher`,
    cost: b.stake,
    payoutIfRight: shares,
    impliedChance: p,
    how: `Buy about ${shares.toFixed(2)} YES "${m.question}" @ ${p}`,
    link,
    warnings: [ESTIMATE_WARNING, ...(event.restricted ? ['Blocked for orders in about 33 countries'] : [])],
    ticket: {
      venue: 'polymarket',
      tokenId,
      maxPrice: p,
      stake: b.stake,
      feeRate,
      tick: Number(m.orderPriceMinTickSize) || 0.001,
      minSize: Number(m.orderMinSize) || 5,
      depthChecked: false,
    },
  }

  // Walk the real book when this server can reach the CLOB. Where it can't (some networks block it),
  // the browser does the same walk before the quote is shown (see exec/polymarket.ts `refine`).
  try {
    const book = await (await fetch(`${CLOB}/book?token_id=${tokenId}`, { cache: 'no-store', signal: AbortSignal.timeout(2500) })).json()
    return priceFromBook(estimate, book.asks ?? [])
  } catch {
    return estimate
  }
}

// Buys YES from the cheapest ask upwards, spending at most `budget` including the taker fee at each price.
export function fillFromBook(asks: BookLevel[], budget: number, feeRate: number) {
  const levels = asks.map((a) => ({ price: Number(a.price), size: Number(a.size) })).filter((a) => a.price > 0 && a.size > 0)
  levels.sort((a, b) => a.price - b.price)
  let left = budget
  let shares = 0
  let worst = 0
  for (const { price, size } of levels) {
    if (left < 1e-6) break
    const perShare = price + feeRate * price * (1 - price)
    const take = Math.min(size, left / perShare)
    shares += take
    left -= take * perShare
    worst = price
  }
  return { shares, spent: budget - left, best: levels[0]?.price ?? 0, worst }
}

// Turns an estimate into the real price for its stake: what the book actually sells, the market's real odds,
// and a price cap one tick above the last level we need, so the order fills what we quoted and no worse.
export function priceFromBook(q: Quote, asks: BookLevel[]): VenueResult {
  const t = q.ticket!
  const f = fillFromBook(asks, t.stake, t.feeRate)
  const unavailable = (reason: string): VenueResult => ({ venue: q.venue, available: false, reason, link: q.link })
  if (f.shares === 0) return unavailable('Nobody is selling this right now')
  if (f.shares < t.minSize) return unavailable(`Not enough on offer: the minimum is ${t.minSize} shares`)

  const short = t.stake - f.spent
  const avg = f.spent / f.shares
  return {
    ...q,
    cost: short > 0.01 ? f.spent : t.stake, // float dust from the walk is not a partial fill
    payoutIfRight: f.shares,
    impliedChance: f.best,
    how: `Buy ${f.shares.toFixed(2)} YES @ ${avg.toFixed(4)} average incl. fee (from ${f.best} up to ${f.worst})`,
    warnings: [
      ...q.warnings.filter((w) => w !== ESTIMATE_WARNING),
      ...(short > 0.01 ? [`Only ${money(f.spent)} of your ${money(t.stake)} can be bought right now`] : []),
      ...(f.worst > f.best ? [`Your stake moves the price from ${f.best} to ${f.worst}`] : []),
    ],
    ticket: { ...t, maxPrice: Math.min(1 - t.tick, +(f.worst + t.tick).toFixed(4)), depthChecked: true },
  }
}

export const polymarket: Venue = { id: 'polymarket', name: 'Polymarket', quote }
