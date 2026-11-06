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

// Derive has no binary options, so "above X" becomes a call spread: buy the strike below X, sell the X call.
// It pays the full width whenever the belief is true (ETH at or above X); between the strikes it pays part of it.
async function quote(b: Belief): Promise<VenueResult> {
  const link = 'https://app.derive.xyz'
  const { tickers } = await rpc<{ tickers: Record<string, Ticker> }>('public/get_tickers', {
    currency: b.asset,
    instrument_type: 'option',
    expiry_date: b.date.replaceAll('-', ''),
  })
  const calls = Object.entries(tickers)
    .filter(([name]) => name.endsWith('-C'))
    .map(([name, t]) => ({ name, strike: Number(name.split('-')[2]), bid: +t.b, bidSize: +t.B, ask: +t.a, askSize: +t.A, index: +t.I }))
    .sort((x, y) => x.strike - y.strike)

  // No options expire that day: point at the nearest day that has them, so the UI can offer it in one click.
  if (!calls.length) {
    const date = await nearestExpiry(b.asset, b.date).catch(() => null)
    return { venue: 'derive', available: false, reason: 'No market that day', link, ...(date ? { suggest: { level: b.level, date } } : {}) }
  }

  const upper = calls.find((c) => c.strike >= b.level && c.bid > 0)
  const lower = upper && calls.findLast((c) => c.strike < upper.strike && c.ask > 0)
  if (!upper || !lower) return { venue: 'derive', available: false, reason: `No tradable call spread at or above $${b.level} for ${b.date}`, link }

  const inst = await rpc<{
    amount_step: string; minimum_amount: string; taker_fee_rate: string; base_fee: string; mark_price_fee_rate_cap: string
    option_details: { expiry: number }
  }>('public/get_instrument', { instrument_name: lower.name })
  const step = Number(inst.amount_step)
  const minAmount = Number(inst.minimum_amount)
  const takerRate = Number(inst.taker_fee_rate)
  const baseFee = Number(inst.base_fee)
  const cap = Number(inst.mark_price_fee_rate_cap)

  // Two orderbook taker orders: each pays the base fee plus min(0.03% notional, 12.5% premium) per contract.
  const legFee = (premium: number) => Math.min(takerRate * lower.index, cap * premium)
  const perSpread = lower.ask - upper.bid + legFee(lower.ask) + legFee(upper.bid)
  const amount = floorTo((b.stake - 2 * baseFee) / perSpread, step)
  if (amount < minAmount) {
    return { venue: 'derive', available: false, reason: `Stake too small: minimum is ${minAmount} spreads (about $${(minAmount * perSpread + 2 * baseFee).toFixed(2)})`, link }
  }

  const width = upper.strike - lower.strike
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const thinBook = amount > lower.askSize || amount > upper.bidSize
  // On the book the lower call is bought before the upper one is sold, so its full price sits in the account for a
  // moment. A spread too big for the top of book goes by RFQ instead, which needs only the net cost.
  const upfront = thinBook ? 0 : Math.ceil((amount * (lower.ask + legFee(lower.ask)) + baseFee) * 1.01 * 100) / 100
  return {
    venue: 'derive',
    available: true,
    actualLevel: upper.strike,
    partialFrom: lower.strike,
    settles: new Date(inst.option_details.expiry * 1000).toISOString(),
    priceSource: `Derive ${b.asset}-USD index, 30-min TWAP`,
    cost: amount * perSpread + 2 * baseFee,
    payoutIfRight: amount * width,
    estimate: thinBook,
    impliedChance: (lower.ask - upper.bid) / width,
    how: `Buy ${amount} × ${lower.name} @ ${lower.ask}, sell ${amount} × ${upper.name} @ ${upper.bid}`,
    link,
    ticket: {
      venue: 'derive', lower: lower.name, upper: upper.name, amount: amount.toFixed(decimals), width, maxCost: b.stake, depthChecked: true,
      upfront,
    },
    warnings: [
      ...(thinBook ? [`Top of book holds only ${lower.askSize} / ${upper.bidSize} contracts; market makers price the real bet`] : []),
      ...(upfront ? [`Needs $${upfront.toFixed(2)} in your Derive account for a moment: the lower call is bought first, the difference comes back seconds later`] : []),
    ],
  }
}

export const derive: Venue = { id: 'derive', name: 'Derive', quote }
