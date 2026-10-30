'use client'

import { useCallback, useEffect, useState } from 'react'
import { executors } from './exec'
import type { Position } from './exec/types'
import { useWallet } from './wallet'

// Everything the connected wallet holds across venues. Read-only: no signatures. Refreshes every 30s.
export function usePositions() {
  const { address } = useWallet()
  const [positions, setPositions] = useState<Position[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!address) return
    setLoading(true)
    const results = await Promise.allSettled(Object.values(executors).map((e) => e!.positions(address)))
    setPositions(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))
    const failed = results.filter((r) => r.status === 'rejected')
    setError(failed.length ? 'Some venues could not be reached; their bets are missing.' : null)
    setLoading(false)
  }, [address])

  useEffect(() => {
    setPositions(null)
    if (!address) return
    refresh()
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [address, refresh])

  return { positions, error, loading, refresh }
}
