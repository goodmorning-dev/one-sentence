import { createPublicClient, erc20Abi, http, parseUnits, type Address } from 'viem'
import { CHAINS } from '../wallet'
import { chainName, type ChainId, type Funding, type FundingSource, type FundingState, type Transfer, type Withdrawal, type WithdrawTarget } from './types'

// Polymarket Bridge API (docs.polymarket.com/trading/bridge/deposit): it gives each Polymarket wallet its own
// deposit address per chain family. USDC sent there from any supported chain is swapped to pUSD and credited to the
// wallet, usually within minutes. Called from the browser: it allows CORS, and our server's network blocks it.
const BRIDGE = 'https://bridge.polymarket.com'
const BUILDER_CODE = process.env.NEXT_PUBLIC_POLY_BUILDER_CODE

// The EVM chains we offer as sources. The bridge supports many more (Solana, Bitcoin, Tron), which a browser
// EVM wallet cannot send from.
const SOURCE_CHAINS: ChainId[] = [137, 42161, 8453, 10, 1]

interface BridgeAsset { chainId: string; chainName: string; token: { symbol: string; address: Address; decimals: number }; minCheckoutUsd: number }

const STATE: Record<string, FundingState> = {
  DEPOSIT_DETECTED: 'processing',
  PROCESSING: 'processing',
  ORIGIN_TX_CONFIRMED: 'processing',
  SUBMITTED: 'processing',
  COMPLETED: 'done',
  FAILED: 'failed',
}

// `account` is the Polymarket wallet that receives pUSD; `owner` is the user's own wallet that pays.
export function polymarketFunding(account: Address, owner: Address): Funding {
  return {
    // Every USDC the bridge accepts on our chains, with the user's balance there; the ones they hold come first.
    async sources() {
      const r = await fetch(`${BRIDGE}/supported-assets`)
      if (!r.ok) throw new Error(`Polymarket bridge: ${r.status}`)
      const body = await r.json()
      const assets: BridgeAsset[] = (body.supportedAssets ?? body).filter(
        (a: BridgeAsset) => SOURCE_CHAINS.includes(Number(a.chainId) as ChainId) && /^USDC(\.e)?$/.test(a.token.symbol),
      )
      const sources = await Promise.all(
        assets.map(async (a): Promise<FundingSource> => {
          const chainId = Number(a.chainId) as ChainId
          const client = createPublicClient({ chain: CHAINS[chainId], transport: http() })
          const raw = await client
            .readContract({ address: a.token.address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
            .catch(() => BigInt(0))
          return {
            chainId,
            chainName: a.chainName,
            token: a.token.address,
            symbol: a.token.symbol,
            decimals: a.token.decimals,
            balance: Number(raw) / 10 ** a.token.decimals,
            min: a.minCheckoutUsd,
          }
        }),
      )
      return sources.sort((x, y) => y.balance - x.balance)
    },

    async deposit(source, amount, wallet) {
      if (amount < source.min) throw new Error(`Minimum deposit from ${source.chainName} is $${source.min}`)
      const r = await fetch(`${BRIDGE}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(BUILDER_CODE ? { 'X-Builder-Code': BUILDER_CODE } : {}) },
        body: JSON.stringify({ address: account }),
      })
      const body = await r.json()
      const to: Address | undefined = body.address?.evm
      if (!r.ok || !to) throw new Error(body.error ?? `Polymarket bridge: ${r.status}`)

      await wallet.writeContract({
        address: source.token,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, parseUnits(amount.toFixed(source.decimals), source.decimals)],
        chain: CHAINS[source.chainId],
        account: wallet.account!,
      })
      return to
    },

    // The id is the bridge address; its newest transfer is the one we just sent.
    status: (id) => bridgeStatus(id),
  }
}

// Polymarket's collateral on Polygon. Bets, winnings and sales all settle in it.
export const PUSD: Address = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB'

// Native USDC on each chain a withdrawal can land on, the user's choice; the bridge swaps pUSD into it for free.
const WITHDRAW_TARGETS: WithdrawTarget[] = [
  { chainId: 8453, chainName: 'Base', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },
  { chainId: 42161, chainName: 'Arbitrum', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC' },
  { chainId: 137, chainName: 'Polygon', token: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC' },
  { chainId: 10, chainName: 'Optimism', token: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC' },
  { chainId: 1, chainName: 'Ethereum', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' },
]

async function bridgeStatus(id: string): Promise<FundingState> {
  const r = await fetch(`${BRIDGE}/status/${id}?limit=1`)
  if (!r.ok) return 'waiting'
  const { transactions } = await r.json()
  return transactions?.[0] ? (STATE[transactions[0].status] ?? 'processing') : 'waiting'
}

// Bridge API withdraw (docs.polymarket.com/trading/bridge/withdraw): ask for an address configured for the
// destination, then send pUSD to it from the Polymarket account. `sendPusd` is the account's own gasless transfer.
export function polymarketWithdrawal(account: Address, owner: Address, sendPusd: (to: Address, amount: bigint) => Promise<void>): Withdrawal {
  return {
    targets: WITHDRAW_TARGETS,
    fee: 0,
    min: 2,
    eta: 'a few minutes',
    async withdraw(amount, to) {
      // Generated only now, right before sending: each address is tied to one destination.
      const r = await fetch(`${BRIDGE}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(BUILDER_CODE ? { 'X-Builder-Code': BUILDER_CODE } : {}) },
        body: JSON.stringify({ address: account, toChainId: String(to.chainId), toTokenAddress: to.token, recipientAddr: owner }),
      })
      const body = await r.json()
      const bridge: Address | undefined = body.address?.evm
      if (!r.ok || !bridge) throw new Error(body.error ?? `Polymarket bridge: ${r.status}`)
      rememberWithdrawal(owner, bridge) // before sending, so the history finds it even if the page closes mid-way
      await sendPusd(bridge, parseUnits(amount.toFixed(6), 6))
      return bridge
    },
    status: bridgeStatus,
  }
}

// Read-only: pUSD in the user's Polymarket account, found from their wallet through Gamma's public profile.
export async function polymarketCash(owner: string): Promise<number> {
  const profile = await fetch(`https://gamma-api.polymarket.com/public-profile?address=${owner}`)
  if (!profile.ok) return 0
  const account: Address | undefined = (await profile.json()).proxyWallet
  if (!account) return 0
  const client = createPublicClient({ chain: CHAINS[137], transport: http() })
  const raw = await client.readContract({ address: PUSD, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
  return Number(raw) / 1e6
}

// Withdrawal addresses are new every time, so the bridge can't list them back: we remember the ones made here.
const withdrawalsKey = (owner: string) => `pm-withdrawals:${owner.toLowerCase()}`
function rememberedWithdrawals(owner: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(withdrawalsKey(owner)) ?? '[]')
  } catch {
    return []
  }
}
export function rememberWithdrawal(owner: string, bridgeAddress: string) {
  try {
    localStorage.setItem(withdrawalsKey(owner), JSON.stringify([...new Set([bridgeAddress, ...rememberedWithdrawals(owner)])].slice(0, 50)))
  } catch {}
}

interface BridgeTx { fromChainId: string; toChainId: string; fromAmountBaseUnit: string; status: string; createdTimeMs?: number; txHash?: string }

// The bridge reports a transfer as legs a few seconds apart (e.g. Base → Polygon, then the USDC → pUSD swap on
// Polygon). A Polygon leg with a same-amount twin from another chain within a few minutes is that twin's second
// leg, so only the leg naming the outside chain is kept. A transfer that really is from Polygon has no twin.
const LEG_WINDOW_MS = 10 * 60 * 1000
function oneLegEach(txs: BridgeTx[], outside: (t: BridgeTx) => string) {
  return txs.filter(
    (t) =>
      outside(t) !== '137' ||
      !txs.some(
        (o) => o !== t && outside(o) !== '137' && o.fromAmountBaseUnit === t.fromAmountBaseUnit && Math.abs((o.createdTimeMs ?? 0) - (t.createdTimeMs ?? 0)) < LEG_WINDOW_MS,
      ),
  )
}

const toTransfer = (kind: Transfer['kind'], outside: (t: BridgeTx) => string) => (t: BridgeTx, i: number): Transfer => ({
  venue: 'polymarket',
  id: `${kind}-${t.createdTimeMs ?? i}-${t.txHash ?? ''}`,
  kind,
  amount: Number(t.fromAmountBaseUnit) / 1e6,
  chain: chainName(outside(t)),
  status: STATE[t.status] ?? 'processing',
  time: t.createdTimeMs ?? 0,
})

// Deposits: the wallet's deposit address is permanent, so its status lists every deposit ever made through the
// bridge. Withdrawals: the status of each withdrawal address remembered in this browser.
export async function polymarketHistory(owner: string): Promise<Transfer[]> {
  const profile = await fetch(`https://gamma-api.polymarket.com/public-profile?address=${owner}`)
  if (!profile.ok) return []
  const account: string | undefined = (await profile.json()).proxyWallet
  if (!account) return []
  const status = async (addr: string): Promise<BridgeTx[]> => (await (await fetch(`${BRIDGE}/status/${addr}?limit=100`)).json()).transactions ?? []

  const dep = await fetch(`${BRIDGE}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(BUILDER_CODE ? { 'X-Builder-Code': BUILDER_CODE } : {}) },
    body: JSON.stringify({ address: account }),
  }).then((r) => r.json())
  const [deposits, ...withdrawals] = await Promise.all([dep.address?.evm ? status(dep.address.evm) : [], ...rememberedWithdrawals(owner).map(status)])

  return [
    ...oneLegEach(deposits, (t) => t.fromChainId).map(toTransfer('deposit', (t) => t.fromChainId)),
    ...withdrawals.flatMap((w) => oneLegEach(w, (t) => t.toChainId).map(toTransfer('withdrawal', (t) => t.toChainId))),
  ]
}
