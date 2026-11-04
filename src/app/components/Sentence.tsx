'use client'

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { day } from '@/lib/format'
import { isoDate, nextFriday, type Sentence as S } from '@/lib/useBelief'
import type { Asset } from '@/lib/venues/types'
import { TAGLINE } from './Logo'

// Editable words: tinted, lime, dashed underline. They read as part of the sentence but clearly tappable.
const chip =
  'rounded-t-lg rounded-b-[2px] border-b-2 border-dashed border-win/55 bg-win/[0.09] px-1.5 text-win outline-none transition hover:bg-win/[0.14] focus-within:bg-win/[0.16] sm:rounded-t-[10px] sm:border-b-[3px] sm:px-2'

const ASSETS: { id: Asset; name: string }[] = [
  { id: 'ETH', name: 'Ethereum' },
  { id: 'BTC', name: 'Bitcoin' },
]

// Width follows the text so the sentence never shows a gap after the number. Digits are 1ch, separators ~0.3ch.
const fit = (s: string) => ({ width: `${Math.max(s.replace(/[,.]/g, '').length, 1) + (s.match(/[,.]/g)?.length ?? 0) * 0.3 + 0.1}ch` })

// Keeps what the person typed (digits and at most one point, up to `decimals` places) and adds thousands
// separators: "2400" → "2,400", "12.5" stays "12.5", a trailing "." survives so decimals can be typed.
// While editing (`editing`), leading zeros stay: delete the 3 in "3,000" and "000" waits for the next digit.
function tidy(raw: string, decimals: number, editing = false) {
  const s = raw.replace(/[^\d.]/g, '')
  const dot = decimals > 0 ? s.indexOf('.') : -1
  const digitsOnly = (dot < 0 ? s : s.slice(0, dot)).replace(/\./g, '')
  const int = editing ? digitsOnly : digitsOnly.replace(/^0+(?=\d)/, '')
  const frac = dot < 0 ? null : s.slice(dot + 1).replace(/\./g, '').slice(0, decimals)
  const text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac === null ? '' : `.${frac}`)
  return { text: frac !== null && !int ? `0${text}` : text, value: Number(`${int || 0}.${frac || 0}`) }
}

// A number typed inside the sentence. Formatting never moves the caret: after each edit it goes back after
// the same count of digits it followed before, wherever the commas landed.
function MoneyField({ label, value, decimals = 0, onChange }: { label: string; value: number; decimals?: number; onChange: (n: number) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const caretDigits = useRef<number | null>(null)
  const [text, setText] = useState(() => tidy(String(value || ''), decimals).text)

  // Follow outside changes (a link, a reset) but not the echo of our own typing.
  useEffect(() => {
    if (tidy(text, decimals).value !== value) setText(value > 0 ? tidy(String(value), decimals).text : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useLayoutEffect(() => {
    const el = input.current
    if (caretDigits.current === null || !el || document.activeElement !== el) return
    let seen = 0
    let i = 0
    while (i < text.length && seen < caretDigits.current) if (/[\d.]/.test(text[i++])) seen++
    el.setSelectionRange(i, i)
    caretDigits.current = null
  }, [text])

  return (
    <label className={`${chip} inline-flex cursor-text whitespace-nowrap`}>
      $
      <input
        ref={input}
        aria-label={label}
        inputMode={decimals ? 'decimal' : 'numeric'}
        value={text}
        onChange={(e) => {
          const raw = e.target.value
          caretDigits.current = raw.slice(0, e.target.selectionStart ?? raw.length).replace(/[^\d.]/g, '').length
          const next = tidy(raw, decimals, true)
          setText(next.text)
          onChange(next.value)
        }}
        onBlur={() => setText(value > 0 ? tidy(String(value), decimals).text : '')}
        style={fit(text)}
        className="bg-transparent outline-none"
      />
    </label>
  )
}

export function quickDates(now = new Date()) {
  const tomorrow = new Date(now)
  tomorrow.setUTCDate(now.getUTCDate() + 1)
  const friday = nextFriday(now)
  return [
    { label: 'Tomorrow', date: isoDate(tomorrow) },
    { label: 'Friday', date: friday },
    { label: 'Next Friday', date: nextFriday(new Date(`${friday}T12:00:00Z`)) },
  ]
}

export function Sentence({ value, spot, onChange }: { value: S; spot: number | null; onChange: (patch: Partial<S>) => void }) {
  const { asset, level, date, stake } = value

  return (
    <section aria-labelledby="sentence-h" className="flex max-w-[900px] flex-col gap-5 sm:gap-6">
      <h1 id="sentence-h" className="text-sm leading-[1.4] text-muted sm:text-[13px] sm:font-medium sm:uppercase sm:tracking-[0.04em] sm:text-faint">
        <span className="sm:hidden">{TAGLINE}</span>
        <span className="hidden sm:inline">Say what you think</span>
      </h1>

      <p className="text-[30px] font-medium leading-[1.32] tracking-[-0.025em] text-ink sm:text-[52px] sm:leading-[1.22] sm:tracking-[-0.035em]">
        I think{' '}
        <AssetPicker value={asset} onChange={(a) => onChange({ asset: a })} />{' '}
        will be above{' '}
        <MoneyField label="Price level in dollars" value={level} onChange={(n) => onChange({ level: n })} />{' '}
        on{' '}
        <DatePicker value={date} onChange={(d) => onChange({ date: d })} />
        , and I&rsquo;ll put in{' '}
        <MoneyField label="Amount in dollars" value={stake} decimals={2} onChange={(n) => onChange({ stake: n })} />
        .
      </p>

      <SpotLine asset={asset} level={level} spot={spot} />

      <div role="group" aria-label="Quick dates" className="flex flex-wrap gap-2">
        {quickDates().map((q) => (
          <button
            key={q.label}
            onClick={() => onChange({ date: q.date })}
            aria-pressed={q.date === date}
            className={`min-h-11 rounded-full border px-4 text-sm transition sm:px-[18px] ${
              q.date === date ? 'border-win/60 bg-win/10 text-win' : 'border-line text-ink-2 hover:border-strong-line hover:text-ink'
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>
    </section>
  )
}

// A floating panel under a chip. Fixed-positioned and clamped to the viewport so it never causes a sideways
// scroll on a phone; closes on Escape, on a click outside, and when focus leaves it.
function usePopover() {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return setPos(null)
    const place = () => {
      const a = anchor.current!.getBoundingClientRect()
      const w = panel.current?.offsetWidth ?? 300
      setPos({ top: a.bottom + 10, left: Math.min(Math.max(16, a.left), innerWidth - w - 16) })
    }
    place()
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false)
    }
    addEventListener('resize', place)
    addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', away)
    return () => {
      removeEventListener('resize', place)
      removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', away)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    anchor.current?.focus()
  }
  return { open, setOpen, close, anchor, panel, pos }
}

function Panel({ p, label, children, onKeyDown }: {
  p: ReturnType<typeof usePopover>
  label: string
  children: ReactNode
  onKeyDown?: (e: KeyboardEvent) => void
}) {
  if (!p.open) return null
  // Rendered into <body>: a panel can't live inside the sentence's <p>.
  return createPortal(
    <div
      ref={p.panel as RefObject<HTMLDivElement>}
      role="dialog"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') p.close()
        else onKeyDown?.(e)
      }}
      style={{ top: p.pos?.top ?? 0, left: p.pos?.left ?? 0, visibility: p.pos ? 'visible' : 'hidden' }}
      className="fixed z-30 rounded-2xl border border-line bg-surface p-2 text-[15px] font-normal leading-normal tracking-normal text-ink shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
    >
      {children}
    </div>,
    document.body,
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden className={`ml-0.5 inline h-[0.42em] w-[0.42em] align-middle opacity-70 transition ${open ? 'rotate-180' : ''}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function AssetPicker({ value, onChange }: { value: Asset; onChange: (a: Asset) => void }) {
  const p = usePopover()
  const options = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (p.open && p.pos) options.current[ASSETS.findIndex((a) => a.id === value)]?.focus()
  }, [p.open, p.pos, value])

  const move = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = options.current.indexOf(document.activeElement as HTMLButtonElement)
    options.current[(i + (e.key === 'ArrowDown' ? 1 : -1) + ASSETS.length) % ASSETS.length]?.focus()
  }

  return (
    <>
      <button
        ref={p.anchor}
        aria-label={`Asset: ${value}. Change`}
        aria-haspopup="listbox"
        aria-expanded={p.open}
        onClick={() => p.setOpen(!p.open)}
        className={`${chip} inline-flex items-center whitespace-nowrap`}
      >
        {value}
        <Chevron open={p.open} />
      </button>
      <Panel p={p} label="Choose a coin" onKeyDown={move}>
        <div role="listbox" aria-label="Coin" className="flex w-56 flex-col">
          {ASSETS.map((a, i) => (
            <button
              key={a.id}
              ref={(el) => { options.current[i] = el }}
              role="option"
              aria-selected={a.id === value}
              onClick={() => { onChange(a.id); p.close() }}
              className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-left outline-none transition hover:bg-raised focus-visible:bg-raised ${a.id === value ? 'text-win' : ''}`}
            >
              <span className="w-10 font-semibold">{a.id}</span>
              <span className="flex-1 text-muted">{a.name}</span>
              {a.id === value && <Check />}
            </button>
          ))}
        </div>
      </Panel>
    </>
  )
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 5 5 9-10" />
    </svg>
  )
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const ymd = (y: number, m: number, d: number) => isoDate(new Date(Date.UTC(y, m, d)))
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return isoDate(d)
}

// A month calendar in the app's own style. Past days are disabled; arrow keys move by day and week.
function DatePicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const p = usePopover()
  const today = isoDate(new Date())
  const [view, setView] = useState(() => ({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 }))
  const [focus, setFocus] = useState(value)
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!p.open) return
    setView({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 })
    setFocus(value)
  }, [p.open, value])

  useEffect(() => {
    if (p.open && p.pos) grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus()
  }, [p.open, p.pos, focus, view])

  const first = new Date(Date.UTC(view.y, view.m, 1))
  const lead = (first.getUTCDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => ymd(view.y, view.m, i + 1))]
  const canGoBack = ymd(view.y, view.m, 1).slice(0, 7) > today.slice(0, 7) // never page into past months
  const monthLabel = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const go = (delta: number) => setView((v) => {
    const d = new Date(Date.UTC(v.y, v.m + delta, 1))
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
  })

  const keys = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = shift(focus, step)
    if (next < today) return
    setFocus(next)
    setView({ y: Number(next.slice(0, 4)), m: Number(next.slice(5, 7)) - 1 })
  }

  const pick = (d: string) => {
    onChange(d)
    p.close()
  }

  return (
    <>
      <button
        ref={p.anchor}
        aria-label={`Date: ${day(value)}. Change`}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        onClick={() => p.setOpen(!p.open)}
        className={`${chip} inline-flex items-center whitespace-nowrap`}
      >
        {day(value).replace(',', '')}
        <Chevron open={p.open} />
      </button>
      <Panel p={p} label="Choose a date">
        <div className="w-[300px] p-1.5">
          <div className="mb-2 flex items-center justify-between">
            <button onClick={() => go(-1)} disabled={!canGoBack} aria-label="Previous month" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised hover:text-ink disabled:opacity-30">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="m15 6-6 6 6 6" /></svg>
            </button>
            <span className="font-semibold" aria-live="polite">{monthLabel}</span>
            <button onClick={() => go(1)} aria-label="Next month" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised hover:text-ink">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-faint">
            {WEEKDAYS.map((w) => <span key={w} className="py-1.5">{w}</span>)}
          </div>
          <div ref={grid} role="grid" aria-label={monthLabel} onKeyDown={keys} className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) =>
              d === null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  key={d}
                  data-date={d}
                  disabled={d < today}
                  tabIndex={d === focus ? 0 : -1}
                  aria-pressed={d === value}
                  aria-label={day(d)}
                  onClick={() => pick(d)}
                  className={`grid h-10 place-items-center rounded-xl text-sm outline-none transition disabled:text-strong-line ${
                    d === value
                      ? 'bg-win font-semibold text-bg'
                      : `hover:bg-raised focus-visible:bg-raised ${d === today ? 'ring-1 ring-inset ring-strong-line' : ''}`
                  }`}
                >
                  {Number(d.slice(8))}
                </button>
              ),
            )}
          </div>
          <div className="mt-2 flex gap-1.5 border-t border-soft-line pt-2.5">
            {quickDates().map((q) => (
              <button key={q.label} onClick={() => pick(q.date)} className="min-h-9 flex-1 rounded-lg text-[13px] text-ink-2 hover:bg-raised hover:text-ink">
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>
    </>
  )
}

// Where the price is now against the one in the sentence, in plain words: how far it has to move for a win.
function SpotLine({ asset, level, spot }: { asset: Asset; level: number; spot: number | null }) {
  if (!spot || !(level > 0)) return <p className="min-h-6" aria-hidden />
  const gap = (level - spot) / spot
  const pct = `${Math.abs(gap * 100).toFixed(1)}%`
  const now = spot.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: spot < 1000 ? 2 : 0 })
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-normal text-muted">
      <span className="inline-flex items-center gap-2 text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-win" aria-hidden />
        {asset} is {now} now.
      </span>
      {Math.abs(gap) < 0.001 ? (
        <span>Your price is right at it: a coin flip.</span>
      ) : gap < 0 ? (
        <span>Your price is {pct} below, so you win unless it falls more than that.</span>
      ) : (
        <span>Your price is {pct} above, so it has to rise at least that much.</span>
      )}
    </p>
  )
}
