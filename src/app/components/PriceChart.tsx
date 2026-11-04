'use client'

import { useEffect, useRef, useState } from 'react'
import type { Asset, VenueId } from '@/lib/venues/types'

export interface StrikeLine {
  venue: VenueId
  price: number
  label: string // "Polymarket · 98%"
  main: boolean // the bet the sentence is about; the others are other prices on offer
}

const HOURS = 48
const H = 232
const PAD = { top: 26, bottom: 28, left: 12, right: 168 }

// The last two days of the asset's price, from Hyperliquid's hourly candles (public, CORS open).
function useCandles(asset: Asset) {
  const [points, setPoints] = useState<{ t: number; p: number }[] | null>(null)
  useEffect(() => {
    let live = true
    setPoints(null)
    const end = Date.now()
    fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'candleSnapshot', req: { coin: asset, interval: '1h', startTime: end - HOURS * 3600_000, endTime: end } }),
    })
      .then((r) => r.json())
      .then((c: { t: number; c: string }[]) => live && setPoints(c.map((x) => ({ t: x.t, p: Number(x.c) }))))
      .catch(() => live && setPoints([]))
    return () => {
      live = false
    }
  }, [asset])
  return points
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1000 ? 2 : 0 })

// Where the price has been, where it is now, and the line each bet needs it above when it's decided. The space
// right of "now" runs to the decision time, so the chart also shows how long is left.
export function PriceChart({ asset, spot, settles, lines, highlight }: {
  asset: Asset
  spot: number | null
  settles: string
  lines: StrikeLine[]
  highlight: VenueId | null
}) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const points = useCandles(asset)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ready = points && points.length > 1 && w > 0
  const now = Date.now()
  const end = Math.max(new Date(settles).getTime(), now + 3600_000)
  const series = ready ? [...points, ...(spot ? [{ t: now, p: spot }] : [])] : []
  const t0 = series[0]?.t ?? now - HOURS * 3600_000
  const prices = [...series.map((s) => s.p), ...lines.map((l) => l.price)]
  const span = Math.max(...prices) - Math.min(...prices) || 1
  const lo = Math.min(...prices) - span * 0.12
  const hi = Math.max(...prices) + span * 0.12

  const right = w < 480 ? 112 : PAD.right
  const x = (t: number) => PAD.left + ((t - t0) / (end - t0)) * (w - PAD.left - right)
  const y = (p: number) => PAD.top + (1 - (p - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom)
  const path = series.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.p).toFixed(1)}`).join('')
  const main = lines.find((l) => l.main)

  // Labels sit at the right edge; ones that would overlap are pushed apart, keeping their order.
  const labels = [...lines].sort((a, b) => b.price - a.price).map((l) => ({ ...l, ly: y(l.price) }))
  for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + 30)
  const overflow = (labels.at(-1)?.ly ?? 0) - (H - PAD.bottom + 4)
  if (overflow > 0) labels.forEach((l) => (l.ly -= overflow))

  const decided = new Date(end).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <figure ref={box} className="relative m-0 border-b border-chip" aria-label={`${asset} price over the last ${HOURS} hours against each bet’s price`}>
      {!ready ? (
        <div className={`h-[232px] ${points ? '' : 'shimmer'} grid place-items-center text-sm text-faint`}>{points ? 'Price history isn’t available right now' : ''}</div>
      ) : (
        <svg width={w} height={H} role="img" aria-hidden className="block">
          {main && (
            <rect x={PAD.left} y={PAD.top} width={w - PAD.left - right} height={Math.max(0, y(main.price) - PAD.top)} className="fill-win/[0.06]" />
          )}
          {main && (
            <text x={PAD.left + 8} y={PAD.top + 14} className="fill-win/70 text-[11px]">You win up here</text>
          )}

          {/* Time: the decision line on the right, "now" where the price stops. */}
          <line x1={x(now)} x2={x(now)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-line" strokeDasharray="2 4" />
          <line x1={x(end)} x2={x(end)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-strong-line" />
          <text x={PAD.left} y={H - 8} className="fill-faint text-[11px]">{HOURS}h ago</text>
          <text x={x(now)} y={H - 8} textAnchor="middle" className="fill-faint text-[11px]">Now</text>
          {/* Up top, so it never collides with "Now" when the decision is only hours away. */}
          <text x={x(end) - 6} y={PAD.top - 5} textAnchor="end" className="fill-muted text-[11px]">Decided {decided}</text>

          {lines.map((l) => {
            const on = l.main || highlight === l.venue
            return (
              <line
                key={l.venue}
                x1={PAD.left}
                x2={x(end)}
                y1={y(l.price)}
                y2={y(l.price)}
                strokeWidth={on ? 2 : 1.25}
                strokeDasharray={l.main ? undefined : '5 5'}
                className={l.main ? 'stroke-win' : on ? 'stroke-ink' : 'stroke-muted/70'}
              />
            )
          })}

          <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-live" />
          {spot && <circle cx={x(now)} cy={y(spot)} r={4.5} className="fill-live stroke-bg" strokeWidth={2} />}
          {spot && (
            <text x={x(now) + 10} y={y(spot) + 4} className="fill-live-ink text-[12px] font-medium">{asset} {money(spot)}</text>
          )}

          {labels.map((l) => {
            const on = l.main || highlight === l.venue
            return (
              <g key={l.venue}>
                <line x1={x(end)} x2={x(end) + 8} y1={y(l.price)} y2={l.ly} className="stroke-line" />
                <text x={x(end) + 12} y={l.ly - 2} className={`text-[13px] font-semibold ${l.main ? 'fill-win' : on ? 'fill-ink' : 'fill-ink-2'}`}>{money(l.price)}</text>
                <text x={x(end) + 12} y={l.ly + 12} className="fill-faint text-[11px]">{l.label}</text>
              </g>
            )
          })}
        </svg>
      )}
    </figure>
  )
}
