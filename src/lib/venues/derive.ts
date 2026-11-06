import type { Belief, Venue, VenueResult } from './types'

const API = 'https://api.derive.xyz/v3'

interface Ticker { b: string; B: string; a: string; A: string; I: string }

async function rpc<T>(method: string, params: object): Promise<T> {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    // Always fresh: a revalidating cache serves its old copy first, which can be days old after a quiet spell.
    cache: 'no-store',
  })
  const j = await r.json()
  if (j.error) throw new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)}`)
  return j.result as T
}

const floorTo = (n: number, step: number) => Math.floor(n / step + 1e-9) * step

// The option expiry closest to `date` (YYYY-MM-DD), the later one on a tie. Derive lists every live instrument by
// name ("ETH-20261113-2450-C"), so the expiries are read from the names.
async function nearestExpiry(asset: string, date: string): Promise<string | null> {
  const names = await rpc<string[]>('public/get_all_live_instruments', { currency: asset, instrument_type: 'option' })
  const today = new Date().toISOString().slice(0, 10)
  const days = [...new Set(names.filter((n) => n.startsWith(`${asset}-`)).map((n) => n.split('-')[1]).filter((d) => /^\d{8}$/.test(d)))]
    .map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`)
    .filter((d) => d > today) // today's options expire at 08:00 UTC, often already gone
  const gap = (d: string) => Math.abs(Date.parse(d) - Date.parse(date))
  return days.sort((x, y) => gap(x) - gap(y) || (x < y ? 1 : -1))[0] ?? null
}

// Derive has no binary options, so the sentence becomes a spread of two options. "Above X" is a call spread: buy
// the call just under X, sell the X call. "Below X" is a put spread: buy the put just over X, sell the X put. Either
// pays the full width whenever the belief is true; between the two strikes it pays part of it.
async function quote(b: Belief): Promise<VenueResult> {
  const link = 'https://app.derive.xyz'
  const below = b.direction === 'below'
  const { tickers } = await rpc<{ tickers: Record<string, Ticker> }>('public/get_tickers', {
    currency: b.asset,
    instrument_type: 'option',
    expiry_date: b.date.replaceAll('-', ''),
  })
  const options = Object.entries(tickers)
    .filter(([name]) => name.endsWith(below ? '-P' : '-C'))
    .map(([name, t]) => ({ name, strike: Number(name.split('-')[2]), bid: +t.b, bidSize: +t.B, ask: +t.a, askSize: +t.A, index: +t.I }))
    .sort((x, y) => x.strike - y.strike)

  // No options expire that day: point at the nearest day that has them, so the UI can offer it in one click.
  if (!options.length) {
    const date = await nearestExpiry(b.asset, b.date).catch(() => null)
    return { venue: 'derive', available: false, reason: 'No market that day', link, ...(date ? { suggest: { level: b.level, date } } : {}) }
  }

  // The short leg sits on the sentence's price (or the next strike past it); the long leg is the next strike back.
  const short = below
    ? options.findLast((c) => c.strike <= b.level && c.bid > 0)
    : options.find((c) => c.strike >= b.level && c.bid > 0)
  const long = short && (below
    ? options.find((c) => c.strike > short.strike && c.ask > 0)
    : options.findLast((c) => c.strike < short.strike && c.ask > 0))
  if (!short || !long) {
    return { venue: 'derive', available: false, reason: `No tradable ${below ? 'put' : 'call'} spread at or ${b.direction} $${b.level} for ${b.date}`, link }
  }

  const inst = await rpc<{
    amount_step: string; minimum_amount: string; taker_fee_rate: string; base_fee: string; mark_price_fee_rate_cap: string
    option_details: { expiry: number }
  }>('public/get_instrument', { instrument_name: long.name })
  const step = Number(inst.amount_step)
  const minAmount = Number(inst.minimum_amount)
  const takerRate = Number(inst.taker_fee_rate)
  const baseFee = Number(inst.base_fee)
  const cap = Number(inst.mark_price_fee_rate_cap)

  // Two orderbook taker orders: each pays the base fee plus min(0.03% notional, 12.5% premium) per contract.
  const legFee = (premium: number) => Math.min(takerRate * long.index, cap * premium)
  const perSpread = long.ask - short.bid + legFee(long.ask) + legFee(short.bid)
  const amount = floorTo((b.stake - 2 * baseFee) / perSpread, step)
  if (amount < minAmount) {
    return { venue: 'derive', available: false, reason: `Stake too small: minimum is ${minAmount} spreads (about $${(minAmount * perSpread + 2 * baseFee).toFixed(2)})`, link }
  }

  const width = Math.abs(short.strike - long.strike)
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const thinBook = amount > long.askSize || amount > short.bidSize
  // On the book the long leg is bought before the short one is sold, so its full price sits in the account for a
  // moment. A spread too big for the top of book goes by RFQ instead, which needs only the net cost.
  const upfront = thinBook ? 0 : Math.ceil((amount * (long.ask + legFee(long.ask)) + baseFee) * 1.01 * 100) / 100
  return {
    venue: 'derive',
    available: true,
    direction: b.direction,
    actualLevel: short.strike,
    partialFrom: long.strike,
    settles: new Date(inst.option_details.expiry * 1000).toISOString(),
    priceSource: `Derive ${b.asset}-USD index, 30-min TWAP`,
    cost: amount * perSpread + 2 * baseFee,
    payoutIfRight: amount * width,
    estimate: thinBook,
    impliedChance: (long.ask - short.bid) / width,
    how: `Buy ${amount} × ${long.name} @ ${long.ask}, sell ${amount} × ${short.name} @ ${short.bid}`,
    link,
    ticket: {
      venue: 'derive', long: long.name, short: short.name, amount: amount.toFixed(decimals), width, maxCost: b.stake, depthChecked: true,
      upfront,
    },
    warnings: [
      ...(thinBook ? [`Top of book holds only ${long.askSize} / ${short.bidSize} contracts; market makers price the real bet`] : []),
      ...(upfront ? [`Needs $${upfront.toFixed(2)} in your Derive account for a moment: the first option is bought before the second is sold, the difference comes back seconds later`] : []),
    ],
  }
}

export const derive: Venue = { id: 'derive', name: 'Derive', quote }
