import { createPublicClient, erc20Abi, http, parseUnits, type Address } from 'viem'
import { CHAINS } from '../wallet'
import type { ChainId, Funding, FundingSource, FundingState } from './types'

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
    async status(id) {
      const r = await fetch(`${BRIDGE}/status/${id}?limit=1`)
      if (!r.ok) return 'waiting'
      const { transactions } = await r.json()
      return transactions?.[0] ? (STATE[transactions[0].status] ?? 'processing') : 'waiting'
    },
  }
}
