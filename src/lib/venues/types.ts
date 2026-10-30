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
  // The payout can't be filled at these prices (thin book, real price via RFQ). Shown, never crowned "Pays most".
  estimate?: boolean
  // What the venue's executor needs to place this exact trade. Absent when we can only link out.
  ticket?: Ticket
}

export type Ticket = {
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
}

export type VenueResult = Quote | Unavailable

export interface Venue {
  id: VenueId
  name: string
  quote(b: Belief): Promise<VenueResult>
}
