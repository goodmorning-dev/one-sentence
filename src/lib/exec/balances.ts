import { createPublicClient, erc20Abi, http, type Address } from 'viem'
import { CHAINS } from '../wallet'
import type { ChainId } from './types'

// Native USDC on the chains a bet can be funded from. Ethereum is left out: moving from it costs more in gas
// than the small amounts people bet here.
export const USDC: { chainId: ChainId; chainName: string; token: Address }[] = [
  { chainId: 42161, chainName: 'Arbitrum', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  { chainId: 8453, chainName: 'Base', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  { chainId: 137, chainName: 'Polygon', token: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  { chainId: 10, chainName: 'Optimism', token: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
]

// Read-only: USDC in the user's own wallet on each of those chains. A chain that can't be read counts as zero.
export async function usdcBalance(owner: Address, chainId: ChainId, token: Address): Promise<number> {
  const client = createPublicClient({ chain: CHAINS[chainId], transport: http() })
  const raw = await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }).catch(() => BigInt(0))
  return Number(raw) / 1e6
}

export const walletUsdc = (owner: Address) =>
  Promise.all(USDC.map(async (c) => ({ ...c, balance: await usdcBalance(owner, c.chainId, c.token) })))
