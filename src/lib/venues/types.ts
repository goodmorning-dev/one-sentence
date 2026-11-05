export type Asset = 'ETH' | 'BTC'

// One sentence from the user: "I think ETH will be above $2,400 on 2026-10-30, and I'll put in $100."
export interface Belief {
  asset: Asset
  direction: 'above'
  level: number
  date: string // YYYY-MM-DD
  stake: number
}

export type VenueId = 'derive' | 'polymarket' | 'hyperliquid'

export interface Quote {
  venue: VenueId
  available: true
  actualLevel: number
  settles: string // ISO time
  priceSource: string
  cost: number
  payoutIfRight: number
  impliedChance: number
  how: string
  link: string
  warnings: string[]
  // A spread (Derive) pays in full only above actualLevel and part of it from this lower price up. Its chance is
  // the market's view of ending around the middle of the two, not above actualLevel.
  partialFrom?: number
  // The payout can't be filled at these prices (thin book, real price via RFQ). Shown, never crowned "Pays most".
  estimate?: boolean
  // What the venue's executor needs to place this exact trade. Absent when we can only link out.
  ticket?: Ticket
}

export type Ticket = PolymarketTicket | HyperliquidTicket | DeriveTicket

// A call spread asked for as one RFQ package: buy `lower`, sell `upper`, the same amount of each. Market makers
// price it at the moment of the bet; it fills whole or not at all, and only if it costs no more than `maxCost`.
export type DeriveTicket = {
  venue: 'derive'
  lower: string // instrument names, e.g. ETH-20261127-2500-C
  upper: string
  amount: string // contracts, on the instrument's step
  width: number // upper strike - lower strike: what each contract pays if right
  maxCost: number // USD, fees included: the user's stake
  // USD the account must hold for a moment: on the order book the lower call is bought before the upper one is
  // sold, so its full price (plus fees) is paid first and the difference comes back seconds later.
  upfront: number
  depthChecked: true
}

// An immediate-or-cancel buy of whole YES shares, priced at the last book level the stake needs.
export type HyperliquidTicket = {
  venue: 'hyperliquid'
  asset: number // 100_000_000 + 10 × outcome + side
  limitPx: string // as the book prints it, so it is a valid price
  size: string // whole shares
  depthChecked: true
}

export type PolymarketTicket = {
  venue: 'polymarket'
  tokenId: string // YES outcome token
  maxPrice: number // worst price per share we accept
  stake: number // what the user asked to spend; `cost` can be lower when the book is thin
  feeRate: number
  tick: number
  minSize: number // shares
  depthChecked: boolean // false: priced from the summary feed only, the order book still has to be walked
}

export interface Unavailable {
  venue: VenueId
  available: false
  reason: string
  link?: string
  // A nearby sentence this venue can actually take, offered as a one-click "Try" in the UI.
  suggest?: { level: number; date: string }
}

export type VenueResult = Quote | Unavailable

export interface Venue {
  id: VenueId
  name: string
  quote(b: Belief): Promise<VenueResult>
}
