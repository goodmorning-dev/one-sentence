'use client'

import { useState } from 'react'
import { short } from '@/lib/format'
import { useWallet } from '@/lib/wallet'

export function WalletButton({ big = false }: { big?: boolean }) {
  const wallet = useWallet()
  const [error, setError] = useState<string | null>(null)

  if (!wallet.address) {
    return (
      <div className="flex flex-col items-end">
        <button
          onClick={() => wallet.connect().then(() => setError(null), (e: Error) => setError(e.message))}
          disabled={!wallet.available}
          title={wallet.available ? undefined : 'Install MetaMask or Rabby to connect'}
          className={
            big
              ? 'min-h-12 rounded-[14px] bg-win px-[22px] text-[15px] font-semibold text-bg transition hover:bg-win-hover disabled:bg-track disabled:text-muted'
              : 'min-h-11 whitespace-nowrap rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink transition hover:bg-raised disabled:text-faint'
          }
        >
          {wallet.available ? 'Connect wallet' : 'No wallet found'}
        </button>
        {error && <span className="mt-1 text-xs text-lose">{error}</span>}
      </div>
    )
  }

  return (
    <a
      href="#wallet"
      className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink no-underline transition hover:bg-raised"
    >
      <span className="h-2 w-2 rounded-full bg-win" aria-hidden />
      {short(wallet.address)}
    </a>
  )
}
