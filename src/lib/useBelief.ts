'use client'

import { useEffect, useState } from 'react'
import type { Asset } from './venues/types'

export interface Sentence { asset: Asset; level: number; date: string; stake: number }

const KEY = 'sentence'

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

// The next Friday after today: most venues list Friday expiries.
export function nextFriday(from = new Date()) {
  const d = new Date(from)
  d.setUTCDate(d.getUTCDate() + (((5 - d.getUTCDay() + 7) % 7) || 7))
  return isoDate(d)
}

const defaults = (): Sentence => ({ asset: 'ETH', level: 2400, date: nextFriday(), stake: 100 })

function parse(src: Partial<Record<keyof Sentence, unknown>>): Partial<Sentence> {
  const out: Partial<Sentence> = {}
  if (src.asset === 'ETH' || src.asset === 'BTC') out.asset = src.asset
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

  useEffect(() => {
    let saved: Partial<Sentence> = {}
    try {
      saved = parse(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
    } catch {}
    const url = parse(Object.fromEntries(new URLSearchParams(location.search)))
    setS({ ...defaults(), ...saved, ...url })
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {}
    const q = new URLSearchParams(location.search)
    for (const [k, v] of Object.entries(s)) q.set(k, String(v))
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`)
  }, [s, ready])

  return { ...s, ready, set: (patch: Partial<Sentence>) => setS((cur) => ({ ...cur, ...patch })) }
}
