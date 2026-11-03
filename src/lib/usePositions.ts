'use client'

import { useCallback, useEffect, useState } from 'react'
import { executors } from './exec'
import type { Position, Transfer } from './exec/types'
import type { VenueId } from './venues/types'
import { useWallet } from './wallet'

const NAMES: Record<VenueId, string> = { polymarket: 'Polymarket', hyperliquid: 'Hyperliquid', derive: 'Derive' }

// Polymarket is blocked by some countries' internet providers (Bulgaria's among them): the browser's request
// fails before reaching it. Say which venue is missing and the likely cause, not just "some venues".
function unreachable(failed: (VenueId | null)[], what: 'bets' | 'history') {
  const names = failed.filter((v): v is VenueId => !!v).map((v) => NAMES[v])
  if (!names.length) return null
  return `Couldn’t reach ${names.join(' or ')} from your network, so your ${names.join(' and ')} ${what} ${what === 'bets' ? 'are' : 'is'} missing. Some internet providers block ${names.length > 1 ? 'these sites' : 'it'}; a VPN usually fixes this.`
}

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
    setHistoryError(unreachable(moves.map((r, i) => (r.status === 'rejected' ? list[i]!.venue : null)), 'history'))
    setPositions(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))
    setCash(Object.fromEntries(balances.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))))
    setError(unreachable(results.map((r, i) => (r.status === 'rejected' ? list[i]!.venue : null)), 'bets'))
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
