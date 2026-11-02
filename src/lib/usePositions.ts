'use client'

import { useCallback, useEffect, useState } from 'react'
import { executors } from './exec'
import type { Position, Transfer } from './exec/types'
import type { VenueId } from './venues/types'
import { useWallet } from './wallet'

export type Cash = Partial<Record<VenueId, number>>

// Everything the connected wallet holds across venues: positions, the cash in each venue account, and the
// deposits and withdrawals that moved it.
// Read-only: no signatures. Refreshes every 30s.
export function usePositions() {
  const { address } = useWallet()
  const [positions, setPositions] = useState<Position[] | null>(null)
  const [cash, setCash] = useState<Cash>({})
  const [history, setHistory] = useState<Transfer[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!address) return
    setLoading(true)
    const list = Object.values(executors)
    const [results, balances, moves] = await Promise.all([
      Promise.allSettled(list.map((e) => e!.positions(address))),
      Promise.allSettled(list.map(async (e) => [e!.venue, e!.cash ? await e!.cash(address) : 0] as const)),
      Promise.allSettled(list.map((e) => (e!.history ? e!.history(address) : Promise.resolve([])))),
    ])
    setHistory(moves.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).sort((a, b) => b.time - a.time))
    setHistoryError(moves.some((r) => r.status === 'rejected') ? 'Some venues could not be reached; their history is missing.' : null)
    setPositions(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))
    setCash(Object.fromEntries(balances.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))))
    const failed = results.filter((r) => r.status === 'rejected')
    setError(failed.length ? 'Some venues could not be reached; their bets are missing.' : null)
    setLoading(false)
  }, [address])

  useEffect(() => {
    setPositions(null)
    setCash({})
    setHistory(null)
    if (!address) return
    refresh()
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [address, refresh])

  return { positions, cash, history, historyError, error, loading, refresh }
}
