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
  // What the wallet will ask while this step runs, in plain words (and whether money moves).
  prompt?: string
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
  eta?: string // how long until it arrives, e.g. "under a minute"
}

export type FundingState = 'waiting' | 'processing' | 'done' | 'failed'

export interface Funding {
  sources(): Promise<FundingSource[]>
  // Sends `amount` from the user's wallet (on the source chain) and returns an id to follow the transfer.
  deposit(source: FundingSource, amount: number, wallet: WalletClient): Promise<string>
  status(id: string): Promise<FundingState>
}

// What selling a position right now would pay, walked against the live bids, fees included.
export interface SellQuote {
  shares: number // what the bids can take now (may be less than held)
  proceeds: number // USD after fees
  fees: number
  avgPrice: number // per share, before fees
  limit: string // lowest price the order accepts: the last bid level the walk used
  note?: string
}

// Where a venue can send money back: a token on a chain, always to the user's own wallet.
export interface WithdrawTarget {
  chainId: ChainId
  chainName: string
  token: `0x${string}`
  symbol: string
}

export interface Withdrawal {
  targets: WithdrawTarget[]
  fee: number // flat USD the venue keeps
  min: number // smallest amount worth sending (above the fee)
  eta: string
  // Sends `amount` of the user's venue balance to their own wallet on `to`; returns an id to follow it.
  withdraw(amount: number, to: WithdrawTarget): Promise<string>
  status(id: string): Promise<FundingState>
}

// Both take the quote being bet on, so a venue can size steps to it (e.g. move only what the bet needs).
export interface VenueSession {
  account(q?: Quote): Promise<VenueAccount>
  runStep(id: string, q?: Quote): Promise<void>
  trade(q: Quote): Promise<TradeResult>
  // Sells a live position at no less than the quote's limit; runs any one-time approval the sale needs first.
  sell?(p: Position, q: SellQuote): Promise<TradeResult>
  withdrawal?: Withdrawal
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
  // Read-only: what selling this position now would pay. Present when the venue supports selling from here.
  sellQuote?(p: Position): Promise<SellQuote>
  // Explains the wallet requests a sale may trigger, shown before the user confirms.
  sellNote?: string
  // Read-only: cash sitting in the user's venue account (winnings, sales, unused deposits), in USD.
  cash?(owner: `0x${string}`): Promise<number>
  // Read-only: money moved into and out of the venue account, newest first.
  history?(owner: `0x${string}`): Promise<Transfer[]>
}

export interface Transfer {
  venue: VenueId
  id: string
  kind: 'deposit' | 'withdrawal'
  amount: number // USD
  chain: string // where it came from (deposit) or went to (withdrawal)
  status: FundingState
  time: number // ms
  fee?: number
}

const CHAIN_NAMES: Record<string, string> = { '1': 'Ethereum', '10': 'Optimism', '137': 'Polygon', '8453': 'Base', '42161': 'Arbitrum', '1151111081099710': 'Solana' }
export const chainName = (id: string | number) => CHAIN_NAMES[String(id)] ?? `chain ${id}`

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
