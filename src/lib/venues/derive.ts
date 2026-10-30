import type { Belief, Venue, VenueResult } from './types'

const API = 'https://api.derive.xyz/v3'

interface Ticker { b: string; B: string; a: string; A: string; I: string }

async function rpc<T>(method: string, params: object): Promise<T> {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    next: { revalidate: 15 },
  })
  const j = await r.json()
  if (j.error) throw new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)}`)
  return j.result as T
}

const floorTo = (n: number, step: number) => Math.floor(n / step + 1e-9) * step

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
  const thinBook = amount > lower.askSize || amount > upper.bidSize
  return {
    venue: 'derive',
    available: true,
    actualLevel: upper.strike,
    settles: new Date(inst.option_details.expiry * 1000).toISOString(),
    priceSource: `Derive ${b.asset}-USD index, 30-min TWAP`,
    cost: amount * perSpread + 2 * baseFee,
    payoutIfRight: amount * width,
    estimate: thinBook,
    impliedChance: (lower.ask - upper.bid) / width,
    how: `Buy ${amount} × ${lower.name} @ ${lower.ask}, sell ${amount} × ${upper.name} @ ${upper.bid}`,
    link,
    warnings: [
      ...(thinBook ? [`Top of book holds only ${lower.askSize} / ${upper.bidSize} contracts; a real order goes through RFQ`] : []),
      `Also pays part of it between $${lower.strike} and $${upper.strike}`,
      'Fees assume two orderbook orders; an RFQ for the spread is cheaper',
    ],
  }
}

export const derive: Venue = { id: 'derive', name: 'Derive', quote }
