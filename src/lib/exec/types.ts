import type { WalletClient } from 'viem'
import type { Quote, VenueId, VenueResult } from '../venues/types'

// Execution runs in the browser: the user's wallet signs, the venue holds the funds, we only attach our builder code.
// Every venue fits the same three moves: open a session, finish any one-time setup steps, trade.

export interface SetupStep {
  id: string
  label: string
  detail?: string
  done: boolean
  // Steps without an action are done by the user elsewhere (for example sending funds).
  runnable: boolean
}

export interface VenueAccount {
  address: string // the account that holds funds and positions on the venue
  balance: number | null // USD available to trade
  steps: SetupStep[]
  link: string // the same account in the venue's own app
}

export interface TradeResult {
  ok: boolean
  message: string
  link?: string
}

export type ChainId = 1 | 10 | 137 | 8453 | 42161

// A token in the user's own wallet that the venue accepts as a deposit.
export interface FundingSource {
  chainId: ChainId
  chainName: string
  token: `0x${string}`
  symbol: string
  decimals: number
  balance: number // in the user's wallet on that chain
  min: number // venue minimum in USD
}

export type FundingState = 'waiting' | 'processing' | 'done' | 'failed'

export interface Funding {
  sources(): Promise<FundingSource[]>
  // Sends `amount` from the user's wallet (on the source chain) and returns an id to follow the transfer.
  deposit(source: FundingSource, amount: number, wallet: WalletClient): Promise<string>
  status(id: string): Promise<FundingState>
}

export interface VenueSession {
  account(): Promise<VenueAccount>
  runStep(id: string): Promise<void>
  trade(q: Quote): Promise<TradeResult>
  funding?: Funding // absent when deposits happen only on the venue's own site
}

// live: not decided yet. claimable: won, payout not collected. won/lost: decided and settled. sold: exited early.
export type PositionStatus = 'live' | 'claimable' | 'won' | 'lost' | 'sold'

export interface Position {
  venue: VenueId
  id: string
  title: string
  outcome: string
  shares: number
  cost: number // what the user paid
  value: number // worth now (live) or what they got back (closed)
  payoutIfRight: number
  pnl: number
  status: PositionStatus
  ends: string // YYYY-MM-DD or ISO
  link: string
}

export interface Executor {
  venue: VenueId
  chainId: ChainId // the chain the wallet must be on to sign
  open(wallet: WalletClient): Promise<VenueSession>
  // Read-only, no signature: everything the user's wallet holds on this venue, open and closed.
  positions(owner: `0x${string}`): Promise<Position[]>
  // Re-prices a quote the server could only estimate, from the browser's own view of the venue.
  refine?(q: Quote): Promise<VenueResult>
}

// Quotes are shown only once every estimate is re-priced. A quote we can't check is withdrawn rather than shown
// with numbers we don't trust.
export async function refineAll(results: VenueResult[], executors: Partial<Record<VenueId, Executor>>): Promise<VenueResult[]> {
  return Promise.all(
    results.map(async (r) => {
      const refine = r.available && r.ticket && !r.ticket.depthChecked ? executors[r.venue]?.refine : undefined
      if (!refine || !r.available) return r
      try {
        return await refine(r)
      } catch {
        return { venue: r.venue, available: false, reason: 'Couldn’t check how much is on offer from this network', link: r.link }
      }
    }),
  )
}
