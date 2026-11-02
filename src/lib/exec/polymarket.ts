import type { WalletClient } from 'viem'
import { polymarketCash, polymarketFunding, polymarketHistory, polymarketWithdrawal, PUSD } from './polymarket-funding'
import { polymarketPositions } from './polymarket-positions'
import { CLOB, priceFromBook } from '../venues/polymarket'
import type { Quote, VenueResult } from '../venues/types'
import type { Executor, Position, SellQuote, VenueSession } from './types'

const BUILDER_CODE = process.env.NEXT_PUBLIC_POLY_BUILDER_CODE

// Polymarket account model (2026 SDK): the user's wallet signs, and trades run from a Deposit Wallet that the SDK
// derives from that wallet and deploys gaslessly through Polymarket's relayer. The relayer call is authorised with
// our builder API key, signed server-side at /api/polymarket/sign. Logging into polymarket.com with the same wallet
// shows the same account.
async function open(wallet: WalletClient): Promise<VenueSession> {
  const { createSecureClient, remoteBuilderSigning, AssetType, OrderSide } = await import('@polymarket/client')
  const { signerFrom } = await import('@polymarket/client/viem')
  const { fetchBalanceAllowance } = await import('@polymarket/client/actions')

  const client = await createSecureClient({
    signer: signerFrom(wallet),
    apiKey: remoteBuilderSigning({ url: '/api/polymarket/sign' }),
  })
  const address = client.account.wallet
  const funding = polymarketFunding(address, client.account.signer)
  // pUSD leaves the account through its own gasless transfer, signed by the user's wallet.
  const withdrawal = polymarketWithdrawal(address, client.account.signer, async (to, amount) => {
    await (await client.transferErc20({ tokenAddress: PUSD, recipientAddress: to, amount })).wait()
  })

  return {
    funding,
    withdrawal,

    async account() {
      const [approvals, funds] = await Promise.all([
        client.fetchTradingApprovalsState(),
        fetchBalanceAllowance(client, { assetType: AssetType.COLLATERAL }),
      ])
      const balance = Number(funds.balance) / 1e6
      return {
        address,
        balance,
        link: 'https://polymarket.com/portfolio',
        steps: [
          { id: 'wallet', label: 'Polymarket account', detail: address, done: true, runnable: false },
          { id: 'approvals', label: 'Allow trading', detail: 'One signature, no gas', done: approvals.isFullyApproved, runnable: true },
          {
            id: 'funds',
            label: 'Add funds',
            detail: balance > 0 ? `$${balance.toFixed(2)} available` : 'USDC from Polygon, Arbitrum, Base, Optimism or Ethereum',
            done: balance > 0,
            runnable: false, // handled by `funding`
          },
        ],
      }
    },

    async runStep(id) {
      if (id === 'approvals') await client.setupTradingApprovals()
    },

    // Market sell, filling only at or above the quoted limit, with our builder code for attribution.
    async sell(p, q) {
      const r = await client.placeMarketOrder({
        assetId: p.id,
        side: OrderSide.SELL,
        shares: q.shares,
        minPrice: q.limit,
        builderCode: BUILDER_CODE,
      })
      if (!r.ok) return { ok: false, message: r.message }
      const got = Number(r.takingAmount)
      return got > 0
        ? { ok: true, message: `Sold ${Number(r.makingAmount).toFixed(2)} shares for $${got.toFixed(2)}` }
        : { ok: false, message: 'Nothing sold at this price; the bids moved. Try again.' }
    },

    async trade(q) {
      if (q.ticket?.venue !== 'polymarket') return { ok: false, message: 'This quote cannot be traded here' }
      if (!q.ticket.depthChecked) return { ok: false, message: 'This price hasn’t been checked against the order book yet' }
      // Market buy: spend at most the stake (fees included), never above maxPrice, fill what we can and cancel the rest.
      const r = await client.placeMarketOrder({
        assetId: q.ticket.tokenId,
        side: OrderSide.BUY,
        amount: q.cost,
        maxSpend: q.cost,
        maxPrice: q.ticket.maxPrice,
        builderCode: BUILDER_CODE,
      })
      if (!r.ok) return { ok: false, message: r.message }
      const shares = Number(r.takingAmount)
      return {
        ok: true,
        message: shares > 0
          ? `Bought ${shares.toFixed(2)} YES for $${Number(r.makingAmount).toFixed(2)}`
          : `Order ${r.status}, nothing filled yet`,
        link: 'https://polymarket.com/portfolio',
      }
    },
  }
}

// The browser reaches the CLOB even where our server can't, so it walks the book itself.
async function refine(q: Quote): Promise<VenueResult> {
  if (q.ticket?.venue !== 'polymarket') return q
  const r = await fetch(`${CLOB}/book?token_id=${q.ticket.tokenId}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error(`Polymarket book: ${r.status}`)
  return priceFromBook(q, (await r.json()).asks ?? [])
}

// Walks the bids from the top with the whole position, Polymarket's taker fee (rate × p × (1 − p) per share)
// included. The market's fee rate comes from Gamma by token id; the bids from the CLOB, in the browser.
async function sellQuote(p: Position): Promise<SellQuote> {
  const [markets, book] = await Promise.all([
    fetch(`https://gamma-api.polymarket.com/markets?clob_token_ids=${p.id}`).then((r) => r.json()),
    fetch(`${CLOB}/book?token_id=${p.id}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`Polymarket book: ${r.status}`)
      return r.json()
    }),
  ])
  const m = markets?.[0]
  const rate = m?.feesEnabled ? (m.feeSchedule?.rate ?? 0.07) : 0
  const bids = ((book.bids ?? []) as { price: string; size: string }[])
    .map((b) => ({ px: Number(b.price), sz: Number(b.size), raw: b.price }))
    .sort((a, b) => b.px - a.px)
  let left = p.shares
  let shares = 0
  let gross = 0
  let fees = 0
  let limit = ''
  for (const { px, sz, raw } of bids) {
    if (left < 1e-6) break
    const take = Math.min(left, sz)
    shares += take
    gross += take * px
    fees += take * rate * px * (1 - px)
    left -= take
    limit = raw
  }
  if (!shares) throw new Error('Nobody is buying this right now')
  return {
    shares: Math.floor(shares * 100) / 100,
    proceeds: gross - fees,
    fees,
    avgPrice: gross / shares,
    limit,
    note: left > 0.01 ? `Only ${shares.toFixed(2)} of your ${p.shares.toFixed(2)} shares can be sold right now` : undefined,
  }
}

export const polymarketExecutor: Executor = {
  venue: 'polymarket',
  chainId: 137,
  open,
  positions: polymarketPositions,
  refine,
  sellQuote,
  sellNote: 'Your wallet asks you to sign in to Polymarket first. That doesn’t move money.',
  cash: polymarketCash,
  history: polymarketHistory,
}
