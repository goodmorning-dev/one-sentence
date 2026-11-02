import { createPublicClient, erc20Abi, http, parseUnits, type Address, type Hex, type WalletClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arbitrum } from 'viem/chains'
import type { AbstractWallet } from '@nktkas/hyperliquid/signing'
import type { Quote } from '../venues/types'
import { hyperliquidPositions } from './hyperliquid-positions'
import type { Executor, Funding, FundingState, Position, SellQuote, SetupStep, VenueSession } from './types'

// Hyperliquid account model: the account IS the user's wallet address. HIP-4 outcome shares trade like spot
// against USDC. Three one-time steps, all signed by the user's wallet on Arbitrum, none moving money:
//   1. approve an agent key that lives in this browser and signs orders (it can trade, never withdraw);
//   2. approve our builder fee (Hyperliquid only charges it when the user sells, never on buys);
//   3. in standard accounts, move USDC from the perps balance (where deposits land) to the spot balance.
// Builder codes need nothing but the public builder address; there is no API key or secret.

const BUILDER = process.env.NEXT_PUBLIC_HL_BUILDER as Address | undefined
const FEE_PERCENT = Number(process.env.NEXT_PUBLIC_HL_BUILDER_FEE_PERCENT ?? '0.1')
const FEE_UNITS = Math.round(FEE_PERCENT * 1000) // the order's `f`, in 0.001% steps (0.1% = 100)

const BRIDGE: Address = '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7' // Arbitrum → Hyperliquid USDC bridge
const ARBITRUM_USDC: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const MIN_DEPOSIT = 5 // the bridge loses anything smaller
const AGENT_NAME = 'one sentence' // named, so it never replaces the agent of the user's own Hyperliquid app

const storageKey = (user: string) => `hl-agent:${user.toLowerCase()}`
function loadAgent(user: string): Hex | null {
  try {
    return localStorage.getItem(storageKey(user)) as Hex | null
  } catch {
    return null
  }
}

async function open(wallet: WalletClient): Promise<VenueSession> {
  const { ExchangeClient, HttpTransport, InfoClient } = await import('@nktkas/hyperliquid')
  const transport = new HttpTransport()
  const info = new InfoClient({ transport })
  const user = wallet.account!.address
  // Signs the user-level actions on Arbitrum. viem's client type is wider than the SDK's, same shape at runtime.
  const master = new ExchangeClient({ transport, wallet: wallet as unknown as AbstractWallet })
  let agentKey = loadAgent(user)

  async function state() {
    const [abstraction, spot, perps, agents, maxFee] = await Promise.all([
      info.userAbstraction({ user }),
      info.spotClearinghouseState({ user }),
      info.clearinghouseState({ user }),
      info.extraAgents({ user }),
      BUILDER ? info.maxBuilderFee({ user, builder: BUILDER }) : Promise.resolve(FEE_UNITS),
    ])
    const usdc = spot.balances.find((b) => b.coin === 'USDC')
    const agent = agentKey ? privateKeyToAccount(agentKey).address.toLowerCase() : null
    return {
      unified: abstraction === 'unifiedAccount' || abstraction === 'portfolioMargin',
      spotFree: usdc ? Number(usdc.total) - Number(usdc.hold) : 0,
      perpsFree: Number(perps.withdrawable),
      total: (usdc ? Number(usdc.total) : 0) + Number(perps.marginSummary.accountValue),
      agentOk: !!agent && agents.some((a) => a.address.toLowerCase() === agent),
      feeOk: maxFee >= FEE_UNITS,
    }
  }

  async function approveAgent() {
    const key = generatePrivateKey()
    await master.approveAgent({ agentAddress: privateKeyToAccount(key).address, agentName: AGENT_NAME })
    localStorage.setItem(storageKey(user), key)
    agentKey = key
  }

  async function approveBuilder() {
    if (!BUILDER) throw new Error('Hyperliquid builder address is not configured')
    await master.approveBuilderFee({ builder: BUILDER, maxFeeRate: `${FEE_PERCENT}%` })
  }

  // What the bet still needs on the spot side, rounded up to the cent.
  const shortfall = (q: Quote | undefined, spotFree: number) => Math.max(0, Math.ceil(((q?.cost ?? 0) - spotFree) * 100) / 100)

  const funding: Funding = {
    async sources() {
      const client = createPublicClient({ chain: arbitrum, transport: http() })
      const raw = await client.readContract({ address: ARBITRUM_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [user] }).catch(() => BigInt(0))
      return [{ chainId: 42161, chainName: 'Arbitrum', token: ARBITRUM_USDC, symbol: 'USDC', decimals: 6, balance: Number(raw) / 1e6, min: MIN_DEPOSIT, eta: 'under a minute' }]
    },
    async deposit(source, amount, w) {
      if (amount < MIN_DEPOSIT) throw new Error(`The Hyperliquid bridge needs at least $${MIN_DEPOSIT}; less would be lost`)
      const before = (await state()).total
      await w.writeContract({
        address: ARBITRUM_USDC,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [BRIDGE, parseUnits(amount.toFixed(6), 6)],
        chain: arbitrum,
        account: w.account!,
      })
      return JSON.stringify({ before, amount })
    },
    // The bridge credits the sending address; we watch the account grow by the amount sent.
    async status(id): Promise<FundingState> {
      const { before, amount } = JSON.parse(id)
      const now = (await state()).total
      return now >= before + amount - 0.01 ? 'done' : 'processing'
    },
  }

  return {
    funding,

    async account(q) {
      const s = await state()
      const need = shortfall(q, s.spotFree)
      const canMove = !s.unified && need > 0 && s.perpsFree > 0
      const steps: SetupStep[] = [
        { id: 'wallet', label: 'Hyperliquid account', detail: user, done: true, runnable: false },
        {
          id: 'agent',
          label: 'Allow betting from here',
          detail: 'One signature, no gas. It can place bets, never withdraw.',
          done: s.agentOk,
          runnable: true,
          prompt: 'It’s asking you to let One sentence place bets on your Hyperliquid account. It can’t withdraw. This doesn’t move money.',
        },
        {
          id: 'builder',
          label: 'Approve our fee',
          detail: `Up to ${FEE_PERCENT}%, only when you sell; nothing when you buy`,
          done: s.feeOk,
          runnable: true,
          prompt: `It’s asking you to approve One sentence’s fee of up to ${FEE_PERCENT}%, charged only when you sell. This doesn’t move money.`,
        },
        ...(canMove
          ? [{
              id: 'move',
              label: `Move ${usd(Math.min(need, s.perpsFree))} to your trading balance`,
              detail: 'Outcome bets use your spot USDC; deposits land in perps',
              done: false,
              runnable: true,
              prompt: `It’s asking you to move ${usd(Math.min(need, s.perpsFree))} from your Hyperliquid perps balance to your spot balance. It stays in your account.`,
            }]
          : []),
        {
          id: 'funds',
          label: 'Add money',
          detail: s.spotFree > 0 ? `${usd(s.spotFree)} available` : 'USDC from Arbitrum, arrives in under a minute',
          done: need === 0 && s.spotFree > 0,
          runnable: false,
        },
      ]
      return { address: user, balance: s.spotFree, steps, link: 'https://app.hyperliquid.xyz/portfolio' }
    },

    async runStep(id, q) {
      if (id === 'agent') {
        await approveAgent()
      } else if (id === 'builder') {
        await approveBuilder()
      } else if (id === 'move') {
        const s = await state()
        const amount = Math.min(shortfall(q, s.spotFree), s.perpsFree)
        await master.usdClassTransfer({ amount: amount.toFixed(2), toPerp: false })
      }
    },

    // Selling is where our builder fee applies, so a sale makes sure both approvals exist first. Someone who
    // bought on Hyperliquid's own app reaches this with neither: up to two one-time signatures, no money moved.
    async sell(p, q) {
      const s = await state()
      if (!s.agentOk) await approveAgent()
      if (!s.feeOk) await approveBuilder()
      const agent = new ExchangeClient({ transport, wallet: privateKeyToAccount(agentKey!) })
      const r = await agent.order({
        orders: [{ a: 100_000_000 + Number(p.id.slice(1)), b: false, p: q.limit, s: String(q.shares), r: false, t: { limit: { tif: 'Ioc' } } }],
        grouping: 'na',
        ...(BUILDER ? { builder: { b: BUILDER, f: FEE_UNITS } } : {}),
      })
      const status = r.response.data.statuses[0]
      if (typeof status === 'object' && 'filled' in status) {
        const { totalSz, avgPx } = status.filled
        return { ok: true, message: `Sold ${Number(totalSz)} shares at ${Number(avgPx).toFixed(4)}` }
      }
      if (typeof status === 'object' && 'error' in status) return { ok: false, message: String(status.error) }
      return { ok: false, message: 'Nothing sold at this price; the bids moved. Try again.' }
    },

    async trade(q) {
      if (q.ticket?.venue !== 'hyperliquid') return { ok: false, message: 'This quote cannot be traded here' }
      if (!agentKey) return { ok: false, message: 'Allow betting from here first' }
      const agent = new ExchangeClient({ transport, wallet: privateKeyToAccount(agentKey) })
      // Immediate-or-cancel at the last book level the stake needs: fills what we quoted or less, never more.
      const r = await agent.order({
        orders: [{ a: q.ticket.asset, b: true, p: q.ticket.limitPx, s: q.ticket.size, r: false, t: { limit: { tif: 'Ioc' } } }],
        grouping: 'na',
        ...(BUILDER ? { builder: { b: BUILDER, f: FEE_UNITS } } : {}),
      })
      const status = r.response.data.statuses[0]
      if (typeof status === 'object' && 'filled' in status) {
        const { totalSz, avgPx } = status.filled
        return { ok: true, message: `Bought ${Number(totalSz)} YES at ${Number(avgPx).toFixed(4)}`, link: 'https://app.hyperliquid.xyz/portfolio' }
      }
      if (typeof status === 'object' && 'error' in status) return { ok: false, message: String(status.error) }
      return { ok: false, message: 'Nothing filled at this price; the book moved. Try again.' }
    },
  }
}

const usd = (n: number) => `$${n.toFixed(2)}`

const CLOSE_FEE_RATE = 0.0007 // Hyperliquid's own fee when closing an outcome position, base tier
const MIN_ORDER_USD = 10

// Walks the YES bids from the top with the whole-share position, Hyperliquid's close fee and our builder fee included.
async function sellQuote(p: Position): Promise<SellQuote> {
  const r = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'l2Book', coin: `#${p.id.slice(1)}` }),
  })
  const bids: { px: string; sz: string }[] = (await r.json()).levels?.[0] ?? []
  let left = Math.floor(p.shares)
  let shares = 0
  let gross = 0
  let limit = ''
  for (const { px, sz } of bids) {
    if (left <= 0) break
    const take = Math.min(left, Math.floor(Number(sz)))
    if (take <= 0) continue
    shares += take
    gross += take * Number(px)
    left -= take
    limit = px
  }
  if (!shares) throw new Error('Nobody is buying this right now')
  const fees = gross * (CLOSE_FEE_RATE + FEE_PERCENT / 100)
  const notes = [
    ...(shares < Math.floor(p.shares) ? [`Only ${shares} of your ${Math.floor(p.shares)} shares can be sold right now`] : []),
    ...(shares * Number(limit) < MIN_ORDER_USD ? [`Hyperliquid may refuse sales under $${MIN_ORDER_USD}`] : []),
  ]
  return { shares, proceeds: gross - fees, fees, avgPrice: gross / shares, limit, note: notes.join('. ') || undefined }
}

export const hyperliquidExecutor: Executor = {
  venue: 'hyperliquid',
  chainId: 42161,
  open,
  positions: hyperliquidPositions,
  sellQuote,
  sellNote: 'If you bought this outside One sentence, your wallet asks for up to two one-time approvals first. Neither moves money.',
}
