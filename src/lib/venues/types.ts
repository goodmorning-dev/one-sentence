export type Asset = 'ETH' | 'BTC'

// Which way the user thinks the price goes: ends above the level, or at/below it.
export type Direction = 'above' | 'below'

// One sentence from the user: "I think ETH will be above $2,400 on 2026-10-30, and I'll put in $100."
export interface Belief {
  asset: Asset
  direction: Direction
  level: number
  date: string // YYYY-MM-DD
  stake: number
}

export type VenueId = 'derive' | 'polymarket' | 'hyperliquid'

export interface Quote {
  venue: VenueId
  available: true
  direction: Direction // the bet wins when the price ends this side of actualLevel
  actualLevel: number
  settles: string // ISO time
  priceSource: string
  cost: number
  payoutIfRight: number
  impliedChance: number
  how: string
  link: string
  warnings: string[]
  // A spread (Derive) pays in full only past actualLevel and part of it from this other strike on. Its chance is
  // the market's view of ending around the middle of the two, not past actualLevel.
  partialFrom?: number
  // The payout can't be filled at these prices (thin book, real price via RFQ). Shown, never crowned "Pays most".
  estimate?: boolean
  // What the venue's executor needs to place this exact trade. Absent when we can only link out.
  ticket?: Ticket
}

export type Ticket = PolymarketTicket | HyperliquidTicket | DeriveTicket

// A spread asked for as one RFQ package: buy `long`, sell `short`, the same amount of each. "Above" is a call
// spread (long the lower call, short the higher one); "below" a put spread (long the higher put, short the lower
// one). Market makers price it at the moment of the bet; it fills whole or not at all, and only if it costs no
// more than `maxCost`.
export type DeriveTicket = {
  venue: 'derive'
  long: string // instrument names, e.g. ETH-20261127-2450-C
  short: string // e.g. ETH-20261127-2500-C
  amount: string // contracts, on the instrument's step
  width: number // the distance between the strikes: what each contract pays if right
  maxCost: number // USD, fees included: the user's stake
  // USD the account must hold for a moment: on the order book the long leg is bought before the short one is
  // sold, so its full price (plus fees) is paid first and the difference comes back seconds later.
  upfront: number
  depthChecked: true
}

// An immediate-or-cancel buy of whole YES shares ("above") or NO shares ("below"), priced at the last book level the stake needs.
export type HyperliquidTicket = {
  venue: 'hyperliquid'
  asset: number // 100_000_000 + 10 × outcome + side
  limitPx: string // as the book prints it, so it is a valid price
  size: string // whole shares
  depthChecked: true
}

export type PolymarketTicket = {
  venue: 'polymarket'
  tokenId: string // YES outcome token for "above", NO for "below"
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
