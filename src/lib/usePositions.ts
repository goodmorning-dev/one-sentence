'use client'

import { useCallback, useEffect, useState } from 'react'
import { executors } from './exec'
import type { Position } from './exec/types'
import type { VenueId } from './venues/types'
import { useWallet } from './wallet'

export type Cash = Partial<Record<VenueId, number>>

// Everything the connected wallet holds across venues: positions and the cash sitting in each venue account.
// Read-only: no signatures. Refreshes every 30s.
export function usePositions() {
  const { address } = useWallet()
  const [positions, setPositions] = useState<Position[] | null>(null)
  const [cash, setCash] = useState<Cash>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!address) return
    setLoading(true)
    const list = Object.values(executors)
    const [results, balances] = await Promise.all([
      Promise.allSettled(list.map((e) => e!.positions(address))),
      Promise.allSettled(list.map(async (e) => [e!.venue, e!.cash ? await e!.cash(address) : 0] as const)),
    ])
    setPositions(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))
    setCash(Object.fromEntries(balances.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))))
    const failed = results.filter((r) => r.status === 'rejected')
    setError(failed.length ? 'Some venues could not be reached; their bets are missing.' : null)
    setLoading(false)
  }, [address])

  useEffect(() => {
    setPositions(null)
    setCash({})
    if (!address) return
    refresh()
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [address, refresh])

  return { positions, cash, error, loading, refresh }
}
