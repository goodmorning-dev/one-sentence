'use client'

import { useEffect, useRef, useState } from 'react'
import type { Asset, Direction } from './venues/types'

export interface Sentence { asset: Asset; direction: Direction; level: number; date: string; stake: number }

const KEY = 'sentence'
const LEVELS_KEY = 'levels' // the last price used for each coin: ETH and BTC trade far apart

type Levels = Partial<Record<Asset, number>>

// A round starting price near where the coin trades now: two leading digits ($2,225 → $2,200, $101,234 → $100,000).
export function roundLevel(spot: number) {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(spot)) - 1)
  return Math.round(spot / step) * step
}

async function spotOf(asset: Asset): Promise<number | null> {
  try {
    const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"allMids"}' })
    const p = Number((await r.json())[asset])
    return p > 0 ? p : null
  } catch {
    return null
  }
}

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

// The next Friday after today: most venues list Friday expiries.
export function nextFriday(from = new Date()) {
  const d = new Date(from)
  d.setUTCDate(d.getUTCDate() + (((5 - d.getUTCDay() + 7) % 7) || 7))
  return isoDate(d)
}

const defaults = (): Sentence => ({ asset: 'ETH', direction: 'above', level: 2400, date: nextFriday(), stake: 100 })

function parse(src: Partial<Record<keyof Sentence, unknown>>): Partial<Sentence> {
  const out: Partial<Sentence> = {}
  if (src.asset === 'ETH' || src.asset === 'BTC') out.asset = src.asset
  if (src.direction === 'above' || src.direction === 'below') out.direction = src.direction
  if (Number(src.level) > 0) out.level = Number(src.level)
  if (Number(src.stake) > 0) out.stake = Number(src.stake)
  // A remembered date in the past is useless: fall back to the default instead.
  if (typeof src.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.date) && src.date >= isoDate(new Date())) out.date = src.date
  return out
}

// The sentence survives reloads: the URL wins (so a link reproduces the exact bet), then the last one used
// in this browser, then defaults. `ready` is false until the browser values are read, to avoid a flash.
export function useBelief() {
  const [s, setS] = useState<Sentence>(defaults)
  const [ready, setReady] = useState(false)
  const levels = useRef<Levels>({})

  useEffect(() => {
    let saved: Partial<Sentence> = {}
    try {
      saved = parse(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
      const l = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? '{}')
      for (const a of ['ETH', 'BTC'] as const) if (Number(l?.[a]) > 0) levels.current[a] = Number(l[a])
    } catch {}
    const url = parse(Object.fromEntries(new URLSearchParams(location.search)))
    setS({ ...defaults(), ...saved, ...url })
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    if (s.level > 0) levels.current[s.asset] = s.level
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
      localStorage.setItem(LEVELS_KEY, JSON.stringify(levels.current))
    } catch {}
    const q = new URLSearchParams(location.search)
    for (const [k, v] of Object.entries(s)) q.set(k, String(v))
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`)
  }, [s, ready])

  // Switching coin brings back the price last used for it. A coin never used before starts near its live price
  // (the level is empty for the moment it takes to read it), so ETH's $2,300 never turns into a BTC bet.
  const set = (patch: Partial<Sentence>) => {
    const to = patch.asset
    if (!to || to === s.asset || patch.level !== undefined) return setS((cur) => ({ ...cur, ...patch }))
    const known = levels.current[to]
    setS((cur) => ({ ...cur, ...patch, level: known ?? 0 }))
    if (known) return
    spotOf(to).then((p) => p && setS((cur) => (cur.asset === to && !(cur.level > 0) ? { ...cur, level: roundLevel(p) } : cur)))
  }

  return { ...s, ready, set }
}
