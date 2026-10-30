import type { WalletClient } from 'viem'
import { polymarketFunding } from './polymarket-funding'
import { polymarketPositions } from './polymarket-positions'
import { CLOB, priceFromBook } from '../venues/polymarket'
import type { Quote, VenueResult } from '../venues/types'
import type { Executor, VenueSession } from './types'

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

  return {
    funding,

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

export const polymarketExecutor: Executor = { venue: 'polymarket', chainId: 137, open, positions: polymarketPositions, refine }
