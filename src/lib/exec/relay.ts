import { createPublicClient, http, type Address, type Hex, type WalletClient } from 'viem'
import { CHAINS } from '../wallet'
import type { ChainId } from './types'

// Relay (docs.relay.link) moves USDC between chains in seconds: the user's wallet sends it to Relay on the source
// chain and a solver pays the same address on the destination, minus a few cents. Called from the browser (CORS
// is open). Used where a venue only takes deposits from one chain, e.g. Hyperliquid from Arbitrum.
const API = 'https://api.relay.link'

interface TxData { to: Address; data: Hex; value: string; chainId: number }
interface Step { id: string; requestId: string; items: { status: string; data: TxData }[] }
interface QuoteBody { steps?: Step[]; details?: { currencyOut?: { amount: string } }; message?: string }

// Sends `amount` (base units) of `fromToken` on `fromChain` to the same wallet as `toToken` on `toChain`.
// Resolves with what arrived, in the destination token's base units, once Relay reports it delivered.
export async function bridgeToSelf(
  wallet: WalletClient,
  from: { chainId: ChainId; token: Address },
  to: { chainId: ChainId; token: Address },
  amount: bigint,
  progress: (text: string) => void,
): Promise<bigint> {
  const user = wallet.account!.address
  const r = await fetch(`${API}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user,
      recipient: user,
      originChainId: from.chainId,
      destinationChainId: to.chainId,
      originCurrency: from.token,
      destinationCurrency: to.token,
      amount: amount.toString(),
      tradeType: 'EXACT_INPUT',
    }),
  })
  const quote: QuoteBody = await r.json()
  if (!r.ok || !quote.steps) throw new Error(quote.message ?? `Relay: ${r.status}`)

  const client = createPublicClient({ chain: CHAINS[from.chainId], transport: http() })
  let requestId = ''
  // Usually an approval then the deposit, each confirmed before the next is sent.
  for (const step of quote.steps) {
    for (const item of step.items) {
      if (item.status === 'complete') continue
      progress(step.id === 'approve' ? 'Confirm the approval in your wallet (1 of 3)' : 'Confirm the move to Arbitrum in your wallet (2 of 3)')
      const hash = await wallet.sendTransaction({
        to: item.data.to,
        data: item.data.data,
        value: BigInt(item.data.value ?? '0'),
        chain: CHAINS[from.chainId],
        account: wallet.account!,
      })
      progress('Waiting for the transaction to confirm…')
      const receipt = await client.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The transaction failed on-chain; nothing was moved')
    }
    requestId = step.requestId
  }

  progress('Moving your USDC to Arbitrum…')
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 3000))
    const s = await fetch(`${API}/intents/status/v3?requestId=${requestId}`).then((x) => x.json()).catch(() => null)
    if (s?.status === 'success') return BigInt(quote.details?.currencyOut?.amount ?? '0')
    if (s?.status === 'failure' || s?.status === 'refund') throw new Error('Relay couldn’t complete the move; your USDC is refunded on the original chain')
  }
  throw new Error('The move to Arbitrum is taking longer than usual. It will still arrive; add it to Hyperliquid from Arbitrum then.')
}
