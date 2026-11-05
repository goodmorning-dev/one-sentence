import { createPublicClient, decodeFunctionData, erc20Abi, http, isAddressEqual, parseAbi, type Address, type Hex, type WalletClient } from 'viem'
import { CHAINS } from '../wallet'
import type { ChainId } from './types'

// Relay (docs.relay.link) moves USDC between chains in seconds: the user's wallet sends it to Relay on the source
// chain and a solver pays the same address on the destination, minus a few cents. Called from the browser (CORS
// is open). Used where a venue only takes deposits from one chain, e.g. Hyperliquid from Arbitrum.
const API = 'https://api.relay.link'

interface TxData { to: Address; data: Hex; value: string; chainId: number }
interface Step { id: string; requestId: string; items: { status: string; data: TxData }[] }
interface QuoteBody { steps?: Step[]; details?: { currencyOut?: { amount: string } }; message?: string }

// Relay's depository, the same address on every chain we use (checked against live quotes). The approval must
// name it as the spender and the deposit must go to it; anything else in a quote is refused before the wallet sees it.
const DEPOSITORY: Address = '0x4cd00e387622c35bddb9b4c962c136462338bc31'
const depositAbi = parseAbi(['function depositErc20(address depositor, address token, uint256 amount, bytes32 id)'])

// Checks one transaction from a Relay quote against what we asked for, so a tampered or compromised response
// can't get the wallet to approve or pay anyone else, or more than the amount.
export function check(tx: TxData, user: Address, from: { chainId: ChainId; token: Address }, amount: bigint) {
  const bad = (why: string) => new Error(`Relay sent an unexpected transaction (${why}), so nothing was sent. Please try again later.`)
  if (Number(tx.chainId) !== from.chainId) throw bad('wrong network')
  if (BigInt(tx.value ?? '0') !== BigInt(0)) throw bad('it asks for ETH')
  if (isAddressEqual(tx.to, from.token)) {
    const call = decodeFunctionData({ abi: erc20Abi, data: tx.data })
    if (call.functionName !== 'approve') throw bad('not an approval')
    const [spender, value] = call.args as [Address, bigint]
    if (!isAddressEqual(spender, DEPOSITORY)) throw bad('unknown spender')
    if (value > amount) throw bad('approval above the amount')
    return
  }
  if (!isAddressEqual(tx.to, DEPOSITORY)) throw bad('unknown contract')
  const call = decodeFunctionData({ abi: depositAbi, data: tx.data })
  const [depositor, token, value] = call.args
  if (!isAddressEqual(depositor, user) || !isAddressEqual(token, from.token) || value !== amount) throw bad('deposit details don’t match')
}

// Sends `amount` (base units) of `fromToken` on `fromChain` to the same wallet as `toToken` on `toChain`, or to
// `recipient` there (a venue's deposit address). Resolves with what arrived, in the destination token's base
// units, once Relay reports it delivered. `minOut` refuses a quote that would deliver less, before anything is sent.
export async function bridgeToSelf(
  wallet: WalletClient,
  from: { chainId: ChainId; token: Address },
  to: { chainId: ChainId; token: Address },
  amount: bigint,
  progress: (text: string) => void,
  opts: { recipient?: Address; toName?: string; minOut?: bigint; of?: number } = {},
): Promise<bigint> {
  const user = wallet.account!.address
  const recipient = opts.recipient ?? user
  const toName = opts.toName ?? 'Arbitrum'
  const of = opts.of ?? 3 // wallet confirmations in the whole flow, for the "1 of 3" counter
  const r = await fetch(`${API}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user,
      recipient,
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

  for (const step of quote.steps) for (const item of step.items) if (item.status !== 'complete') check(item.data, user, from, amount)
  const quotedOut = BigInt(quote.details?.currencyOut?.amount ?? '0')
  if (opts.minOut != null && !quote.details?.currencyOut?.amount) {
    throw new Error('Relay didn’t say how much would arrive, so nothing was sent. Try again in a moment.')
  }
  if (opts.minOut != null && quotedOut < opts.minOut) {
    throw new Error(`After Relay's fee only ${(Number(quotedOut) / 1e6).toFixed(2)} USDC would arrive, under the ${(Number(opts.minOut) / 1e6).toFixed(2)} minimum. Nothing was sent; try a larger amount.`)
  }

  // What arrives is read from the chain, not taken from the quote, so the next step never sends more than is there.
  const dest = createPublicClient({ chain: CHAINS[to.chainId], transport: http() })
  const destBalance = () => dest.readContract({ address: to.token, abi: erc20Abi, functionName: 'balanceOf', args: [recipient] })
  const startBalance = await destBalance()

  const client = createPublicClient({ chain: CHAINS[from.chainId], transport: http() })
  let requestId = ''
  // Usually an approval then the deposit, each confirmed before the next is sent.
  for (const step of quote.steps) {
    for (const item of step.items) {
      if (item.status === 'complete') continue
      progress(step.id === 'approve' ? `Confirm the approval in your wallet (1 of ${of})` : `Confirm the move to ${toName} in your wallet (2 of ${of})`)
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

  progress(`Moving your USDC to ${toName}…`)
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 3000))
    const s = await fetch(`${API}/intents/status/v3?requestId=${requestId}`).then((x) => x.json()).catch(() => null)
    if (s?.status === 'success') {
      const quoted = quotedOut
      // The node can lag the solver by a block or two.
      for (let i = 0; i < 10; i++) {
        const arrived = (await destBalance()) - startBalance
        if (arrived > BigInt(0)) return arrived < quoted || quoted === BigInt(0) ? arrived : quoted
        await new Promise((res) => setTimeout(res, 2000))
      }
      return BigInt(0)
    }
    if (s?.status === 'failure' || s?.status === 'refund') throw new Error('Relay couldn’t complete the move; your USDC is refunded on the original chain')
  }
  throw new Error(`The move to ${toName} is taking longer than usual. It will still arrive.`)
}
