'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createWalletClient, custom, type Address, type EIP1193Provider, type WalletClient } from 'viem'
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains'

// Injected wallets only (MetaMask, Rabby, Coinbase extension). WalletConnect needs a project ID; add it later.
declare global {
  interface Window { ethereum?: EIP1193Provider }
}

export const CHAINS = {
  [mainnet.id]: mainnet,
  [optimism.id]: optimism,
  [polygon.id]: polygon,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
} as const

interface WalletState {
  address: Address | null
  available: boolean
  connect(): Promise<void>
  disconnect(): void
  // A wallet client on the given chain, switching (or adding) the chain in the wallet first.
  clientOn(chainId: keyof typeof CHAINS): Promise<WalletClient>
}

const WalletContext = createContext<WalletState | null>(null)

// The site can't revoke its own access in most wallets, so "Disconnect" is remembered here and the wallet's
// existing permission is ignored until the user presses Connect again.
const OFF = 'wallet:disconnected'
const remember = (off: boolean) => {
  try {
    if (off) localStorage.setItem(OFF, '1')
    else localStorage.removeItem(OFF)
  } catch {}
}
const isOff = () => {
  try {
    return localStorage.getItem(OFF) === '1'
  } catch {
    return false
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    const eth = window.ethereum
    setAvailable(!!eth)
    if (!eth) return
    if (!isOff()) eth.request({ method: 'eth_accounts' }).then((a) => setAddress(a[0] ?? null)).catch(() => {})
    const onAccounts = (a: Address[]) => !isOff() && setAddress(a[0] ?? null)
    eth.on('accountsChanged', onAccounts)
    return () => eth.removeListener('accountsChanged', onAccounts)
  }, [])

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error('No browser wallet found. Install MetaMask or Rabby.')
    const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' })
    remember(false)
    setAddress(a ?? null)
  }, [])

  const disconnect = useCallback(() => {
    remember(true)
    setAddress(null)
    // Wallets that support it drop the permission too; others ignore this.
    window.ethereum?.request({ method: 'wallet_revokePermissions' as never, params: [{ eth_accounts: {} }] as never }).catch(() => {})
  }, [])

  const clientOn = useCallback(async (chainId: keyof typeof CHAINS) => {
    if (!window.ethereum || !address) throw new Error('Connect a wallet first')
    const chain = CHAINS[chainId]
    const client = createWalletClient({ account: address, chain, transport: custom(window.ethereum) })
    if ((await client.getChainId()) !== chainId) {
      try {
        await client.switchChain({ id: chainId })
      } catch {
        await client.addChain({ chain })
      }
    }
    return client
  }, [address])

  return (
    <WalletContext.Provider value={{ address, available, connect, disconnect, clientOn }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const w = useContext(WalletContext)
  if (!w) throw new Error('useWallet outside WalletProvider')
  return w
}
