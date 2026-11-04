'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Asset, VenueId } from '@/lib/venues/types'

export interface StrikeLine {
  venue: VenueId
  price: number
  label: string // "Polymarket · 98%"
  main: boolean // the bet the sentence is about; the others are other prices on offer
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// How far back the chart looks, and the candle size that keeps each range at roughly 70–180 points.
const RANGES = [
  { id: '6H', ms: 6 * HOUR, interval: '5m', name: '6 hours' },
  { id: '1D', ms: DAY, interval: '15m', name: '1 day' },
  { id: '2D', ms: 2 * DAY, interval: '30m', name: '2 days' },
  { id: '1W', ms: 7 * DAY, interval: '2h', name: '1 week' },
  { id: '1M', ms: 30 * DAY, interval: '8h', name: '1 month' },
] as const
type Range = (typeof RANGES)[number]
const DEFAULT_RANGE = 2
const RANGE_KEY = 'chart:range'

interface Pt { t: number; p: number }

// Candles from Hyperliquid (public, CORS open), kept for a minute so switching ranges back and forth is instant.
const cache = new Map<string, { at: number; points: Pt[] }>()

function useCandles(asset: Asset, range: Range) {
  const key = `${asset}:${range.id}`
  const [state, setState] = useState<{ key: string; points: Pt[] | null }>({ key: '', points: null })
  useEffect(() => {
    let live = true
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < MIN) {
      setState({ key, points: hit.points })
      return
    }
    const end = Date.now()
    fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'candleSnapshot', req: { coin: asset, interval: range.interval, startTime: end - range.ms, endTime: end } }),
    })
      .then((r) => r.json())
      .then((c: { t: number; c: string }[]) => {
        const points = Array.isArray(c) ? c.map((x) => ({ t: x.t, p: Number(x.c) })) : []
        if (points.length) cache.set(key, { at: Date.now(), points })
        if (live) setState({ key, points })
      })
      .catch(() => live && setState({ key, points: [] }))
    return () => {
      live = false
    }
  }, [key, asset, range])
  return state.key === key ? state.points : null
}

const money = (n: number, cents = n < 1000) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })

const dateTime = (t: number) =>
  new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// A round step for about `count` ticks across `span`: 1, 2 or 5 times a power of ten.
function niceStep(span: number, count: number) {
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag
}

const TIME_STEPS = [15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY]

// Ticks on round local times (whole hours, midnights), as many as fit about every 80px.
function timeTicks(t0: number, t1: number, width: number) {
  const fit = Math.max(2, Math.floor(width / 80))
  const step = TIME_STEPS.find((s) => (t1 - t0) / s <= fit) ?? 7 * DAY
  const offset = new Date(t0).getTimezoneOffset() * MIN
  const ticks: number[] = []
  for (let t = Math.ceil((t0 - offset) / step) * step + offset; t <= t1; t += step) ticks.push(t)
  const label = (t: number) => {
    const d = new Date(t)
    const midnight = d.getHours() === 0 && d.getMinutes() === 0
    if (step >= DAY || midnight) return d.toLocaleDateString('en-GB', step >= DAY ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' })
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  return ticks.map((t) => ({ t, label: label(t) }))
}

// The closest point to `t`, by binary search over the time-sorted series.
function nearest(series: Pt[], t: number) {
  let lo = 0
  let hi = series.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (series[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  const a = series[lo]
  const b = series[lo + 1]
  return b && Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a
}

const H = 264
const PAD = { top: 30, bottom: 30 }

// Where the price has been, where it is now, and the line each bet needs it above when it's decided. The space
// right of "now" runs toward the decision time, so the chart also shows how long is left. Ranges zoom the past;
// hovering reads off any moment; the venue chips hide or show the other prices on offer.
export function PriceChart({ asset, spot, settles, lines, highlight }: {
  asset: Asset
  spot: number | null
  settles: string
  lines: StrikeLine[]
  highlight: VenueId | null
}) {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const [w, setW] = useState(0)
  const [rangeIx, setRangeIx] = useState(DEFAULT_RANGE)
  const [hidden, setHidden] = useState<Set<VenueId>>(new Set())
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [hoverLine, setHoverLine] = useState<VenueId | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const range = RANGES[rangeIx]
  const points = useCandles(asset, range)

  useEffect(() => {
    try {
      const saved = RANGES.findIndex((r) => r.id === localStorage.getItem(RANGE_KEY))
      if (saved >= 0) setRangeIx(saved)
    } catch {}
  }, [])
  const pickRange = (i: number) => {
    const ix = Math.max(0, Math.min(RANGES.length - 1, i))
    setRangeIx(ix)
    setHover(null)
    try {
      localStorage.setItem(RANGE_KEY, RANGES[ix].id)
    } catch {}
  }

  // The element itself is state, so the width is watched on whichever node React renders, and it's measured
  // directly as well: an observer that only ever reported 0 would leave the chart blank.
  useEffect(() => {
    if (!box) return
    setW(box.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width || box.getBoundingClientRect().width))
    ro.observe(box)
    return () => ro.disconnect()
  }, [box, points])

  // A tap keeps its readout (a finger lifting counts as leaving); tapping elsewhere or scrolling clears it.
  useEffect(() => {
    if (!hover) return
    const clear = (e: Event) => {
      if (!(e.target instanceof Node) || !svg.current?.contains(e.target)) setHover(null)
    }
    const onScroll = () => setHover(null)
    document.addEventListener('pointerdown', clear)
    addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', clear)
      removeEventListener('scroll', onScroll)
    }
  }, [hover])

  const shown = lines.filter((l) => l.main || !hidden.has(l.venue))
  const now = Date.now()
  const decided = new Date(settles).getTime()
  // The candles end at the last full interval; the live price extends the line to now.
  const series = useMemo(() => {
    if (!points?.length) return []
    return spot ? [...points, { t: Date.now(), p: spot }] : points
  }, [points, spot])
  const current = spot ?? series.at(-1)?.p ?? null
  const ready = series.length > 1 && w > 0

  // Horizontal: the range's past, then some future up to the decision. A decision further out than half the
  // range sits past the right edge and gets an arrow instead, so a short range still zooms into recent moves.
  const t0 = now - range.ms
  const future = Math.min(Math.max(decided - now, range.ms * 0.12), range.ms * 0.5)
  const t1 = now + future
  const decisionInside = decided <= t1

  // Vertical: the visible prices plus every shown bet's price, with some air.
  const visible = series.filter((s) => s.t >= t0)
  const prices = [...visible.map((s) => s.p), ...shown.map((l) => l.price), ...(current ? [current] : [])]
  const pMin = prices.length ? Math.min(...prices) : 0
  const pMax = prices.length ? Math.max(...prices) : 1
  const span = pMax - pMin || pMax * 0.01 || 1
  const lo = pMin - span * 0.12
  const hi = pMax + span * 0.12

  const yStep = niceStep(hi - lo, 4)
  const yTicks: number[] = []
  for (let v = Math.ceil(lo / yStep) * yStep; v <= hi; v += yStep) yTicks.push(v)
  const tickCents = yStep < 1
  const left = Math.max(44, ...yTicks.map((v) => money(v, tickCents).length * 6.4 + 12))
  const narrow = w < 480
  const right = narrow ? 96 : 150
  const plotR = Math.max(left + 40, w - right)

  const x = (t: number) => left + ((t - t0) / (t1 - t0)) * (plotR - left)
  const y = (p: number) => PAD.top + (1 - (p - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom)
  const path = visible.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.p).toFixed(1)}`).join('')
  const area = visible.length > 1 ? `${path}L${x(visible.at(-1)!.t).toFixed(1)},${H - PAD.bottom}L${x(visible[0].t).toFixed(1)},${H - PAD.bottom}Z` : ''
  const main = shown.find((l) => l.main)
  const xNow = x(now)
  const xEnd = decisionInside ? x(decided) : plotR

  const change = visible.length > 1 && current ? (current - visible[0].p) / visible[0].p : null

  // Right-hand labels: every shown price plus the current price tag, pushed apart so none overlap, in order.
  type Label = { key: string; at: number; h: number; line?: StrikeLine }
  const labels: (Label & { ly: number })[] = [
    ...shown.map((l): Label => ({ key: l.venue, at: y(l.price), h: 30, line: l })),
    ...(current ? [{ key: 'spot', at: y(current), h: 22 }] : []),
  ]
    .sort((a, b) => a.at - b.at)
    .map((l) => ({ ...l, ly: l.at }))
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1]
    labels[i].ly = Math.max(labels[i].ly, prev.ly + (prev.h + labels[i].h) / 2 + 2)
  }
  const last = labels.at(-1)
  const over = last ? last.ly + last.h / 2 - (H - 4) : 0
  if (over > 0) labels.forEach((l) => (l.ly -= over))
  const first = labels[0]
  const under = first ? 4 - (first.ly - first.h / 2) : 0
  if (under > 0) labels.forEach((l) => (l.ly += under))

  const xTicks = ready ? timeTicks(t0, t1, plotR - left).filter((tk) => Math.abs(x(tk.t) - xNow) > 34 && x(tk.t) > left + 16) : []

  // Hover: the price at that moment (or, right of now, how long until it's decided) and any bet line under it.
  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const r = svg.current?.getBoundingClientRect()
    if (r) setHover({ x: e.clientX - r.left, y: e.clientY - r.top })
  }
  const hoverT = hover ? t0 + ((hover.x - left) / (plotR - left)) * (t1 - t0) : null
  const hoverPt = hover && hoverT !== null && hoverT <= now && visible.length ? nearest(visible, hoverT) : null
  const lineUnder = hover ? shown.find((l) => Math.abs(y(l.price) - hover.y) < 8) ?? null : null
  const active = hoverLine ?? lineUnder?.venue ?? highlight
  const hx = hoverPt ? x(hoverPt.t) : hover?.x ?? 0
  const flip = hx > left + (plotR - left) * 0.55

  const until = (ms: number) => {
    const d = Math.floor(ms / DAY)
    const h = Math.floor((ms % DAY) / HOUR)
    const m = Math.round((ms % HOUR) / MIN)
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
  }
  const price = (n: number) => money(n, n % 1 !== 0)

  const summary = current && main
    ? `${asset} is ${money(current)} now${change !== null ? `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change * 100).toFixed(1)}% over ${range.name}` : ''}. Your bet needs it above ${price(main.price)} on ${dateTime(decided)}.`
    : `${asset} price over the last ${range.name}.`

  const others = lines.filter((l) => !l.main)
  const zoomBtn = 'grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <figure ref={setBox} className="relative m-0 flex flex-col border-b border-chip">
      <figcaption className="sr-only">{summary}</figcaption>

      {/* Controls: the range (also stepped with − and +), and which other prices to draw. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3.5 sm:px-6">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold text-ink">{asset} {current ? money(current) : '…'}</span>
          {change !== null && (
            <span className={change >= 0 ? 'text-win' : 'text-lose'}>
              {change >= 0 ? '+' : '−'}{Math.abs(change * 100).toFixed(2)}%
              <span className="text-faint"> in {range.name}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => pickRange(rangeIx + 1)} disabled={rangeIx === RANGES.length - 1} aria-label="Zoom out: show a longer time" className={zoomBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
          </button>
          <div role="group" aria-label="Time range" className="flex rounded-lg bg-raised p-0.5">
            {RANGES.map((r, i) => (
              <button
                key={r.id}
                onClick={() => pickRange(i)}
                aria-pressed={i === rangeIx}
                aria-label={`Show ${r.name}`}
                className={`h-7 min-w-9 rounded-md px-2 text-xs font-medium transition ${i === rangeIx ? 'bg-chip text-ink' : 'text-muted hover:text-ink'}`}
              >
                {r.id}
              </button>
            ))}
          </div>
          <button onClick={() => pickRange(rangeIx - 1)} disabled={rangeIx === 0} aria-label="Zoom in: show a shorter time" className={zoomBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M5 12h14M12 5v14" /></svg>
          </button>
        </div>
      </div>
      {others.length > 0 && (
        <div role="group" aria-label="Prices to show" className="flex flex-wrap gap-1.5 px-4 pt-2.5 sm:px-6">
          {lines.map((l) => {
            const on = l.main || !hidden.has(l.venue)
            return (
              <button
                key={l.venue}
                disabled={l.main}
                aria-pressed={on}
                title={l.main ? 'Your bet, always shown' : on ? 'Hide this price' : 'Show this price'}
                onClick={() =>
                  setHidden((h) => {
                    const n = new Set(h)
                    if (n.has(l.venue)) n.delete(l.venue)
                    else n.add(l.venue)
                    return n
                  })
                }
                onMouseEnter={() => setHoverLine(l.venue)}
                onMouseLeave={() => setHoverLine(null)}
                className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition ${on ? 'border-strong-line text-ink-2' : 'border-chip text-faint line-through'} ${l.main ? 'cursor-default' : 'hover:border-muted'}`}
              >
                <span aria-hidden className={`h-0.5 w-3 rounded ${l.main ? 'bg-win' : on ? 'bg-muted' : 'bg-chip'}`} />
                {l.label.split(' · ')[0]} {price(l.price)}
              </button>
            )
          })}
        </div>
      )}

      <div className="relative">
        {!ready ? (
          <div className={`h-[264px] ${points ? '' : 'shimmer'} grid place-items-center text-sm text-faint`}>{points ? 'Price history isn’t available right now' : ''}</div>
        ) : (
          <svg ref={svg} width={w} height={H} aria-hidden className="block touch-pan-y select-none">
            {/* Price grid, labelled on the left. */}
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={left} x2={plotR} y1={y(v)} y2={y(v)} className="stroke-soft-line" />
                <text x={left - 8} y={y(v) + 4} textAnchor="end" className="fill-faint text-[11px]">{money(v, tickCents)}</text>
              </g>
            ))}

            {/* The future, lightly shaded, and the zone where the main bet wins. */}
            <rect x={xNow} y={PAD.top} width={Math.max(0, plotR - xNow)} height={H - PAD.top - PAD.bottom} className="fill-raised/50" />
            {main && <rect x={left} y={PAD.top} width={xEnd - left} height={Math.max(0, y(main.price) - PAD.top)} className="fill-win/[0.06]" />}
            {main && y(main.price) - PAD.top > 18 && (
              <text x={left + 8} y={PAD.top + 14} className="fill-win/70 text-[11px]">You win up here</text>
            )}

            {/* Time: dates and times along the bottom, "now", and the decision. */}
            {xTicks.map((tk) => (
              <g key={tk.t}>
                <line x1={x(tk.t)} x2={x(tk.t)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-soft-line/60" />
                <text x={x(tk.t)} y={H - 10} textAnchor="middle" className="fill-faint text-[11px]">{tk.label}</text>
              </g>
            ))}
            <line x1={xNow} x2={xNow} y1={PAD.top} y2={H - PAD.bottom} className="stroke-line" strokeDasharray="2 4" />
            <text x={xNow} y={H - 10} textAnchor="middle" className="fill-muted text-[11px] font-medium">Now</text>
            {decisionInside ? (
              <>
                <line x1={xEnd} x2={xEnd} y1={PAD.top} y2={H - PAD.bottom} className="stroke-strong-line" />
                <text x={xEnd - 6} y={PAD.top - 9} textAnchor="end" className="fill-muted text-[11px]">Decided {dateTime(decided)}</text>
              </>
            ) : (
              <text x={plotR - 4} y={PAD.top - 9} textAnchor="end" className="fill-muted text-[11px]">Decided {dateTime(decided)} →</text>
            )}

            {/* Each bet's price: the main one solid, the others dashed; hovered ones brighten. */}
            {shown.map((l) => {
              const on = l.main || active === l.venue
              return (
                <line
                  key={l.venue}
                  x1={left}
                  x2={plotR}
                  y1={y(l.price)}
                  y2={y(l.price)}
                  strokeWidth={on ? 2 : 1.25}
                  strokeDasharray={l.main ? undefined : '5 5'}
                  className={l.main ? 'stroke-win' : on ? 'stroke-ink' : 'stroke-muted/70'}
                />
              )
            })}

            {/* The price itself, a soft fill under it, and a dotted line from now to its tag on the right. */}
            {area && <path d={area} className="fill-live/[0.07]" />}
            <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-live" />
            {current && (
              <>
                <line x1={xNow} x2={plotR} y1={y(current)} y2={y(current)} className="stroke-live/50" strokeDasharray="2 3" />
                <circle cx={xNow} cy={y(current)} r={4.5} className="fill-live stroke-bg" strokeWidth={2} />
              </>
            )}

            {/* The right column: each price with its venue, and the live price as a tag, never overlapping. */}
            {labels.map((l) => {
              if (!l.line) {
                const text = narrow ? money(current!) : `${asset} ${money(current!)}`
                return (
                  <g key="spot">
                    <line x1={plotR} x2={plotR + 8} y1={l.at} y2={l.ly} className="stroke-live/50" />
                    <rect x={plotR + 8} y={l.ly - 10} width={Math.min(text.length * 6.8 + 14, right - 12)} height={20} rx={6} className="fill-live" />
                    <text x={plotR + 15} y={l.ly + 4} className="fill-bg text-[11.5px] font-semibold">{text}</text>
                  </g>
                )
              }
              const line = l.line
              const on = line.main || active === line.venue
              return (
                <g key={l.key} onMouseEnter={() => setHoverLine(line.venue)} onMouseLeave={() => setHoverLine(null)}>
                  <line x1={plotR} x2={plotR + 8} y1={l.at} y2={l.ly} className="stroke-line" />
                  <text x={plotR + 12} y={l.ly - 2} className={`text-[13px] font-semibold ${line.main ? 'fill-win' : on ? 'fill-ink' : 'fill-ink-2'}`}>{price(line.price)}</text>
                  <text x={plotR + 12} y={l.ly + 12} className="fill-faint text-[11px]">{narrow ? line.label.split(' · ')[0] : line.label}</text>
                </g>
              )
            })}

            {/* Hover crosshair. */}
            {hover && hoverT !== null && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={PAD.top} y2={H - PAD.bottom} className="stroke-ink/40" />
                {hoverPt && <circle cx={hx} cy={y(hoverPt.p)} r={4} className="fill-bg stroke-live" strokeWidth={2} />}
              </g>
            )}

            {/* Catches the pointer over the plot; a finger still scrolls the page up and down. */}
            <rect
              x={left}
              y={PAD.top}
              width={plotR - left}
              height={H - PAD.top - PAD.bottom}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={(e) => e.pointerType !== 'touch' && setHover(null)}
            />
          </svg>
        )}

        {/* Hover readout, as HTML so it stays readable; flips to the left of the cursor near the right edge. */}
        {ready && hover && hoverT !== null && (
          <div
            className="pointer-events-none absolute top-9 z-10 flex min-w-40 max-w-60 flex-col gap-0.5 rounded-xl border border-strong-line bg-surface/95 px-3 py-2 text-xs shadow-lg"
            style={{ left: flip ? hx - 12 : hx + 12, transform: flip ? 'translateX(-100%)' : undefined }}
          >
            {hoverPt ? (
              <>
                <span className="text-faint">{dateTime(hoverPt.t)}</span>
                <span className="text-sm font-semibold text-ink">{asset} {money(hoverPt.p)}</span>
                {main && (
                  <span className={hoverPt.p > main.price ? 'text-win' : 'text-lose'}>
                    {Math.abs(((hoverPt.p - main.price) / main.price) * 100).toFixed(1)}% {hoverPt.p > main.price ? 'above' : 'below'} your {price(main.price)}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-faint">{dateTime(hoverT)}</span>
                <span className="text-ink-2">{hoverT < decided ? `Still to come. Decided in ${until(decided - now)}` : 'After it’s decided'}</span>
              </>
            )}
            {lineUnder && (
              <span className="mt-1 border-t border-chip pt-1 text-ink-2">
                {lineUnder.main ? 'Your bet' : lineUnder.label.split(' · ')[0]} wins above {price(lineUnder.price)}
              </span>
            )}
          </div>
        )}
      </div>
    </figure>
  )
}
