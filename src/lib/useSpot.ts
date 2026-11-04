'use client'

import { useEffect, useState } from 'react'
import type { Asset } from './venues/types'

// Where the asset trades right now: Hyperliquid's perp mid price, read from the browser every 15s. Only for
// context next to the sentence; quotes never depend on it.
export function useSpot(asset: Asset) {
  const [spot, setSpot] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    setSpot(null)
    const read = () =>
      fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"allMids"}' })
        .then((r) => r.json())
        .then((mids: Record<string, string>) => live && mids[asset] && setSpot(Number(mids[asset])))
        .catch(() => {})
    read()
    const t = setInterval(read, 15000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [asset])
  return spot
}
