'use client'

import { useEffect, useState } from 'react'
import { executors } from '@/lib/exec'
import { chanceWords, day, usd, when } from '@/lib/format'
import type { Quote, Unavailable, VenueId, VenueResult } from '@/lib/venues/types'
import { quickDates } from './Sentence'
import { TradePanel } from './TradePanel'

export const VENUE_NAMES: Record<VenueId, string> = { derive: 'Derive', polymarket: 'Polymarket', hyperliquid: 'Hyperliquid' }

export interface QuotesData { results: VenueResult[]; best: VenueId | null; comparable: VenueId[]; error?: string }

const card = 'rounded-[20px] border bg-surface sm:rounded-3xl'
const secondaryBtn = 'min-h-12 rounded-[14px] border border-strong-line px-5 text-[15px] font-medium text-ink transition hover:bg-raised'

export function VenueMark({ venue, muted = false }: { venue: VenueId; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[13px] font-semibold sm:h-8 sm:w-8 sm:rounded-[9px] ${
        muted ? 'border border-dashed border-line bg-[#1a1b1e] text-faint' : 'bg-chip text-ink'
      }`}
    >
      {VENUE_NAMES[venue][0]}
    </span>
  )
}

// Best payout first; other quotes at the same level next, then other levels.
function order(d: QuotesData) {
  const rank = (q: Quote) => (q.venue === d.best ? 0 : d.comparable.includes(q.venue) ? 1 : 2)
  return d.results.filter((r): r is Quote => r.available).sort((a, b) => rank(a) - rank(b) || b.payoutIfRight - a.payoutIfRight)
}

export function Quotes(props: {
  data: QuotesData | null
  incomplete: boolean
  loading: boolean
  failed: boolean
  updatedAt: number | null
  stake: number
  onRetry: () => void
  onTry: (patch: { level?: number; date?: string }) => void
  onTraded: () => void
}) {
  const { data, incomplete, loading, failed, updatedAt, onRetry, onTry, onTraded } = props

  if (incomplete) {
    return (
      <section className={`${card} border-soft-line p-5 text-[15px] text-muted`}>
        Finish the sentence with a price and an amount to see what it pays.
      </section>
    )
  }

  if (failed && !data) {
    return (
      <section role="alert" className={`${card} flex flex-col gap-3 border-lose/40 p-5`}>
        <h2 className="text-[17px] font-semibold text-lose-ink">Couldn&rsquo;t get prices</h2>
        <p className="text-sm leading-normal text-ink-2">Something went wrong on our side. Nothing was placed.</p>
        <button onClick={onRetry} className="min-h-11 self-start rounded-xl bg-ink px-[18px] text-[15px] font-semibold text-bg">Try again</button>
      </section>
    )
  }

  if (!data) {
    return (
      <section aria-busy className="flex flex-col gap-2.5">
        <span className="text-sm text-muted">Asking Polymarket, Derive and Hyperliquid…</span>
        <div className={`${card} shimmer flex flex-col gap-3.5 border-soft-line p-5`}>
          <div className="h-3.5 w-30 rounded-md bg-soft-line" />
          <div className="grid grid-cols-2 gap-3"><div className="h-[76px] rounded-xl bg-raised" /><div className="h-[76px] rounded-xl bg-raised" /></div>
          <div className="h-12 rounded-[14px] bg-raised" />
        </div>
        <div className="shimmer h-14 rounded-2xl bg-surface" />
      </section>
    )
  }

  const quotes = order(data)
  const none = data.results.filter((r): r is Unavailable => !r.available)

  if (quotes.length === 0) {
    return (
      <section className={`${card} flex flex-col gap-3 border-soft-line p-5`}>
        <h2 className="text-[17px] font-semibold">Nobody offers this bet yet</h2>
        <p className="text-sm leading-normal text-muted">Markets this far out usually open a day or two before. Try a closer date.</p>
        <div className="flex flex-wrap gap-2">
          {quickDates().slice(0, 2).map((q) => (
            <button key={q.label} onClick={() => onTry({ date: q.date })} className="min-h-11 rounded-full border border-strong-line px-4 text-sm text-ink hover:bg-raised">
              Try {q.label.toLowerCase()}
            </button>
          ))}
        </div>
        <ul className="mt-1 flex flex-col text-[13px] text-faint">
          {none.map((r) => (
            <li key={r.venue} className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-chip py-1.5">
              <span className="text-ink-2">{VENUE_NAMES[r.venue]}</span>
              <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right">
                {r.reason}
                {r.suggest && <TryButton suggest={r.suggest} onTry={onTry} />}
              </span>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  const [first, ...rest] = quotes

  return (
    <section aria-labelledby="quotes-h" aria-busy={loading} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="quotes-h" className="text-[17px] font-semibold tracking-[-0.01em]">Where you can place it</h2>
        <LiveStamp at={updatedAt} loading={loading} className="sm:hidden" />
      </div>

      {/* While new prices load these cards describe the previous sentence: dim them and make them inert. */}
      <div inert={loading} className={`flex flex-wrap items-start gap-3 transition-opacity sm:gap-5 ${loading ? 'opacity-50' : ''}`}>
        <div className="min-w-0 flex-[999_1_560px]">
          <QuoteCard q={first} best={data.best === first.venue} comparable={data.comparable.includes(first.venue)} featured onTraded={onTraded} />
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
          {rest.map((q) => (
            <QuoteCard key={q.venue} q={q} best={false} comparable={data.comparable.includes(q.venue)} featured={false} onTraded={onTraded} />
          ))}
          {none.map((r) => (
            <div key={r.venue} className="flex min-h-14 items-center justify-between gap-3 border-t border-raised px-1 sm:border-t-0 sm:px-2">
              <span className="flex items-center gap-2.5">
                <VenueMark venue={r.venue} muted />
                <span className="text-[15px] text-ink-2">{VENUE_NAMES[r.venue]}</span>
              </span>
              <span className="flex flex-col items-end gap-1 text-right text-[13px] text-faint">
                {r.reason}
                {r.suggest && <TryButton suggest={r.suggest} onTry={onTry} />}
              </span>
            </div>
          ))}
          <LiveStamp at={updatedAt} loading={loading} className="hidden px-2 sm:flex" />
        </div>
      </div>
    </section>
  )
}

// A venue's own suggestion of a sentence it can take, one click to apply.
function TryButton({ suggest, onTry }: { suggest: { level: number; date: string }; onTry: (patch: { level: number; date: string }) => void }) {
  return (
    <button
      onClick={() => onTry(suggest)}
      className="inline-flex min-h-9 items-center gap-1 rounded-full border border-win/40 px-3 text-[13px] font-medium text-win transition hover:bg-win/10"
    >
      Try {usd(suggest.level, 0)} on {day(suggest.date).replace(',', '')}
    </button>
  )
}

function LiveStamp({ at, loading, className = '' }: { at: number | null; loading: boolean; className?: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!at) return null
  const s = Math.max(0, Math.round((now - at) / 1000))
  return (
    <span className={`flex items-center gap-1.5 text-xs text-faint ${className}`} aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full bg-win ${loading ? 'shimmer' : ''}`} aria-hidden />
      {loading ? 'Updating…' : `Live prices · ${s < 60 ? `${s}s` : `${Math.round(s / 60)}m`} ago`}
    </span>
  )
}

function QuoteCard({ q, best, comparable, featured, onTraded }: { q: Quote; best: boolean; comparable: boolean; featured: boolean; onTraded: () => void }) {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState(false)
  const name = VENUE_NAMES[q.venue]
  const multiple = q.payoutIfRight / q.cost
  const chance = chanceWords(q.impliedChance)
  const tradable = !!q.ticket && !!executors[q.venue]
  const key = `${q.payoutIfRight}-${q.cost}` // re-runs the rise animation when the figures change

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <VenueMark venue={q.venue} />
        <span className="text-base font-semibold sm:text-lg">{name}</span>
      </div>
      {open ? (
        <span className="text-sm text-muted">Win <span className="font-semibold text-win">{usd(q.payoutIfRight)}</span></span>
      ) : best ? (
        <span className="rounded-full bg-win px-2.5 py-1 text-xs font-semibold tracking-[0.02em] text-bg">Pays most</span>
      ) : q.estimate ? (
        <span title="Not enough is on offer at these prices; the real price comes from the venue when you bet" className="rounded-full bg-chip px-2.5 py-1 text-xs text-ink-2">
          Estimate
        </span>
      ) : !comparable ? (
        <span className="rounded-full bg-chip px-2.5 py-1 text-xs text-ink-2">At {usd(q.actualLevel, 0)}</span>
      ) : null}
    </div>
  )

  const detailsList = (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[13px]">
      <dt className="text-faint">Price it must beat</dt>
      <dd className="text-right font-mono text-ink">{usd(q.actualLevel, 2)}</dd>
      <dt className="text-faint">Price checked by</dt>
      <dd className="text-right text-ink">{q.priceSource}</dd>
      <dt className="text-faint">Decided at</dt>
      <dd className="text-right text-ink">{when(q.settles)}</dd>
      <dd className="col-span-2 mt-1 leading-[1.55] text-muted">
        <strong className="font-medium text-ink-2">Under the hood: </strong>
        <span className="font-mono text-xs">{q.how}</span>
      </dd>
      {q.warnings.map((w) => (
        <dd key={w} className="col-span-2 flex gap-2 leading-[1.55] text-lose-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="mt-0.5 flex-none"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
          {w}
        </dd>
      ))}
    </dl>
  )

  const trade = tradable ? (
    <TradePanel quote={q} venueName={name} primary={featured} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} onTraded={onTraded} />
  ) : (
    <a href={q.link} target="_blank" rel="noreferrer" className={`${featured ? 'min-h-[52px] bg-win text-base font-semibold text-bg hover:bg-win-hover' : `${secondaryBtn} border`} flex flex-1 items-center justify-center gap-1.5 rounded-[14px] no-underline`}>
      Bet on {name}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M8 7h9v9" /></svg>
    </a>
  )

  if (!featured) {
    return (
      <article aria-label={name} className={`${card} flex flex-col gap-4 border-soft-line p-5 sm:p-6`}>
        {header}
        {!open && (
          <div className="flex flex-col gap-1.5 text-[15px] sm:gap-2">
            <Row label="If you’re right"><span key={key} className="rise"><span className="font-semibold text-win">{usd(q.payoutIfRight)}</span><span className="text-faint"> · {multiple.toFixed(2)}×</span></span></Row>
            <Row label="If you’re wrong"><span className="font-semibold text-lose">−{usd(q.cost)}</span></Row>
            <Row label="Crowd’s chance"><span className="text-ink">{chance.odds}</span></Row>
          </div>
        )}
        <div className="flex gap-2">
          {trade}
          {!open && (
            <button onClick={() => setDetails(!details)} aria-expanded={details} className="min-h-12 rounded-[14px] border border-line px-4 text-sm text-muted hover:text-ink">
              Details
            </button>
          )}
        </div>
        {details && !open && <div className="border-t border-soft-line pt-4">{detailsList}</div>}
      </article>
    )
  }

  return (
    <article
      aria-label={`${name}${best ? ', pays most' : ''}`}
      className={`${card} flex flex-col gap-[18px] p-5 sm:gap-6 sm:p-7 ${
        best ? 'border-win/45 shadow-[0_0_0_4px_rgba(200,241,105,0.06),0_16px_40px_rgba(0,0,0,0.35)]' : 'border-soft-line'
      }`}
    >
      {header}

      <div className={`grid-cols-2 gap-3 sm:grid-cols-3 ${open ? 'hidden sm:grid' : 'grid'}`}>
        <Tile tone="win" label="If you’re right" sub={`${multiple.toFixed(2)}× your ${usd(q.cost, q.cost % 1 ? 2 : 0)}`}>
          <span key={key} className="rise">{usd(q.payoutIfRight)}</span>
        </Tile>
        <Tile tone="lose" label="If you’re wrong" sub="That’s the most">
          −{usd(q.cost, q.cost % 1 ? 2 : 0)}
        </Tile>
        <div className="col-span-2 flex flex-col gap-2 sm:col-span-1 sm:rounded-[14px] sm:bg-raised sm:p-4">
          <div className="flex justify-between gap-3 text-sm sm:flex-col sm:gap-1">
            <span className="text-ink-2 sm:text-[13px] sm:text-muted">
              <span className="sm:hidden">The crowd thinks this is {chance.mood}</span>
              <span className="hidden sm:inline">Crowd&rsquo;s chance</span>
            </span>
            <span className="whitespace-nowrap font-medium text-ink sm:text-[32px] sm:font-semibold sm:tracking-[-0.02em]">
              <span className="sm:hidden">{chance.odds}</span>
              <span className="hidden sm:inline">{chance.odds.replace('about ', '')}</span>
            </span>
          </div>
          <div role="img" aria-label={`Market-implied chance: ${chance.odds}`} className="h-1.5 overflow-hidden rounded-full bg-track">
            <div className="h-1.5 min-w-1.5 rounded-full bg-win" style={{ width: `${q.impliedChance * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">{trade}</div>

      {!open && (
        <details open={details} onToggle={(e) => setDetails(e.currentTarget.open)} className="border-t border-soft-line pt-1">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between text-sm text-muted hover:text-ink">
            Details
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className={`transition ${details ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
          </summary>
          <div className="pb-1 pt-2">{detailsList}</div>
        </details>
      )}
    </article>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  )
}

function Tile({ tone, label, sub, children }: { tone: 'win' | 'lose'; label: string; sub: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 rounded-xl p-3.5 sm:rounded-[14px] sm:p-4 ${tone === 'win' ? 'bg-win/[0.07]' : 'bg-lose/[0.07]'}`}>
      <span className="text-[13px] text-muted">{label}</span>
      <span className={`text-[26px] font-semibold tracking-[-0.02em] sm:text-[32px] ${tone === 'win' ? 'text-win' : 'text-lose'}`}>{children}</span>
      <span className="text-[13px] text-muted">{sub}</span>
    </div>
  )
}

