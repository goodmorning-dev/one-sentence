'use client'

import { useEffect, useState } from 'react'
import { executors } from '@/lib/exec'
import { chanceWords, day, usd, when } from '@/lib/format'
import type { Asset, Quote, Unavailable, VenueId, VenueResult } from '@/lib/venues/types'
import { PriceChart } from './PriceChart'
import { quickDates } from './Sentence'

export const VENUE_NAMES: Record<VenueId, string> = { derive: 'Derive', polymarket: 'Polymarket', hyperliquid: 'Hyperliquid' }

export interface QuotesData { results: VenueResult[]; best: VenueId | null; comparable: VenueId[]; error?: string }

const card = 'rounded-[20px] border bg-surface sm:rounded-3xl'
const primaryBtn = 'min-h-12 rounded-[14px] bg-win px-5 text-[15px] font-semibold text-bg transition hover:bg-win-hover'
const secondaryBtn = 'min-h-12 rounded-[14px] border border-strong-line px-5 text-[15px] font-medium text-ink transition hover:bg-raised'

export function VenueMark({ venue, muted = false, small = false }: { venue: VenueId; muted?: boolean; small?: boolean }) {
  if (small) {
    return <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-chip text-[10px] font-semibold text-ink">{VENUE_NAMES[venue][0]}</span>
  }
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
export function order(d: QuotesData) {
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
  onPick: (venue: VenueId) => void
  level: number
  spot: number | null
  asset: Asset
}) {
  const { data, incomplete, loading, failed, updatedAt, stake, level, spot, asset, onRetry, onTry, onPick } = props
  const [hover, setHover] = useState<VenueId | null>(null)

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

  // Only quotes on the same strike are the same bet, so only they compete for "Best price". Other strikes follow
  // in the same list, each row saying the price it needs, and the chart shows where every one of them sits.
  const same = quotes.filter((q) => data.comparable.includes(q.venue))
  const others = quotes.filter((q) => !data.comparable.includes(q.venue))
  const strike = same[0].actualLevel
  const exact = Math.abs(strike - level) < 1
  const lead = same.find((q) => q.venue === data.best) ?? same[0]
  const nearCertain = lead.impliedChance >= 0.95
  const fmt = (n: number) => usd(n, n % 1 ? 2 : 0)

  return (
    <section aria-labelledby="quotes-h" aria-busy={loading} className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="quotes-h" className="text-[17px] font-semibold tracking-[-0.01em] sm:text-lg">
          {exact ? 'Your bet' : `Nobody offers ${fmt(level)} exactly. Closest: above ${fmt(strike)}`}
        </h2>
        <LiveStamp at={updatedAt} loading={loading} />
      </div>

      {nearCertain && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-lose/35 bg-lose/[0.05] px-5 py-3.5">
          <span className="text-sm leading-normal text-ink-2">
            <strong className="font-semibold text-ink">Almost certain.</strong> You&rsquo;d risk {fmt(lead.cost)} to win {usd(lead.payoutIfRight - lead.cost)}.
            {' '}For a bigger payout, bet on a price closer to {spot ? `today’s ${fmt(Math.round(spot))}` : 'today’s'}.
          </span>
          {spot && (
            <button onClick={() => onTry({ level: Math.round(spot) })} className="inline-flex min-h-10 items-center rounded-full border border-win/40 px-3.5 text-[13px] font-medium text-win hover:bg-win/10">
              Try {fmt(Math.round(spot))}
            </button>
          )}
        </div>
      )}

      {/* While new prices load the rows describe the previous sentence: dim them and make them inert. */}
      <div inert={loading} className={`${card} overflow-hidden border-soft-line transition-opacity ${loading ? 'opacity-50' : ''}`}>
        <PriceChart
          asset={asset}
          spot={spot}
          settles={lead.settles}
          highlight={hover}
          lines={[...same, ...others].map((q) => ({ venue: q.venue, price: q.actualLevel, main: same.includes(q), label: `${VENUE_NAMES[q.venue]} · ${pct(q.impliedChance)}` }))}
        />
        <div className={`${cols} hidden border-b border-chip px-7 py-3.5 text-xs uppercase tracking-[0.04em] text-faint md:grid`}>
          <span>Where</span><span>If you&rsquo;re right</span><span>If you&rsquo;re wrong</span><span>Chance it happens</span><span />
        </div>
        {[...same, ...others].map((q) => (
          <QuoteRow
            key={q.venue}
            q={q}
            best={data.best === q.venue && same.length > 1}
            primary={q === lead}
            other={!same.includes(q)}
            stake={stake}
            onPick={onPick}
            onHover={setHover}
          />
        ))}
        {none.map((r) => (
          <div key={r.venue} className="flex flex-col gap-2 border-t border-chip px-5 py-4 md:grid md:grid-cols-[2fr_6.6fr] md:items-center md:gap-4 md:px-7">
            <span className="flex items-center gap-3">
              <VenueMark venue={r.venue} muted />
              <span className="text-base text-ink-2">{VENUE_NAMES[r.venue]}</span>
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-faint">
              {r.reason}
              {r.suggest && <TryButton suggest={r.suggest} onTry={onTry} />}
            </span>
          </div>
        ))}
      </div>

      <ChanceHint />

      <HowItWorks quotes={quotes} />
    </section>
  )
}

const cols = 'md:grid-cols-[2fr_1.3fr_1.3fr_1.4fr_1.6fr] md:gap-4'

// "Likely · 72%": the mood first for someone new to this, the number for everyone else.
const pct = (p: number) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`
export function chanceLabel(p: number) {
  const { mood } = chanceWords(p)
  return `${mood[0].toUpperCase()}${mood.slice(1)} · ${pct(p)}`
}

// One venue, one row: what you'd win, what you'd risk, how likely it is, and the way in. On a phone the same
// cells stack into a card.
function QuoteRow({ q, best, primary, other, stake, onPick, onHover }: {
  q: Quote
  best: boolean
  primary: boolean
  other: boolean // a different price from the sentence's: a different bet, labelled as such
  stake: number
  onPick: (v: VenueId) => void
  onHover: (v: VenueId | null) => void
}) {
  const name = VENUE_NAMES[q.venue]
  const tradable = !!q.ticket && !!executors[q.venue]
  const cost = usd(q.cost, q.cost % 1 ? 2 : 0)
  const figure = best ? 'text-[26px]' : 'text-[22px]'
  const key = `${q.payoutIfRight}-${q.cost}` // re-runs the rise animation when the figures change
  const badge = best ? (
    <span className="rounded-full bg-win px-2 py-0.5 text-[11px] font-semibold text-bg">Best price</span>
  ) : q.estimate ? (
    <span title="Not enough is on offer at these prices; the real price comes from the venue when you bet" className="rounded-full bg-chip px-2 py-0.5 text-[11px] text-ink-2">Estimate</span>
  ) : null

  return (
    <article
      onMouseEnter={() => onHover(q.venue)}
      onMouseLeave={() => onHover(null)}
      aria-label={`${name}${best ? ', best price' : ''}`}
      className={`${cols} relative grid grid-cols-2 items-center gap-x-4 gap-y-4 border-t border-chip px-5 py-5 first:border-t-0 md:px-7 md:py-6 ${best ? 'bg-win/[0.045]' : ''}`}
    >
      {best && <span aria-hidden className="absolute bottom-4 left-0 top-4 w-[3px] rounded-r-[3px] bg-win" />}
      <div className="col-span-2 flex items-center gap-3 md:col-span-1">
        <VenueMark venue={q.venue} />
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-col md:items-start">
          <span className="text-[17px] font-semibold">{name}</span>
          {badge}
          <span className={`basis-full text-[13px] md:basis-auto ${other ? 'text-live-ink' : 'text-faint'}`}>
            {other ? 'Other price: ' : 'Wins '}above {usd(q.actualLevel, q.actualLevel % 1 ? 2 : 0)}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-muted md:hidden">If you&rsquo;re right</span>
        <span key={key} className={`rise ${figure} font-semibold tracking-[-0.02em] text-win`}>+{usd(q.payoutIfRight - q.cost)}</span>
        <span className="text-[13px] text-faint">you get {usd(q.payoutIfRight)} back</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-muted md:hidden">If you&rsquo;re wrong</span>
        <span className={`${figure} font-semibold tracking-[-0.02em] text-lose`}>−{cost}</span>
        <span className="text-[13px] text-faint">you lose what you put in</span>
      </div>
      <div className="col-span-2 flex flex-col gap-2 md:col-span-1">
        <span className="flex justify-between gap-3 text-[15px] md:font-medium">
          <span className="text-muted md:hidden">Chance it happens</span>
          {chanceLabel(q.impliedChance)}
        </span>
        <div role="img" aria-label={`Chance it happens: ${chanceLabel(q.impliedChance)}`} className="h-1.5 rounded-full bg-track">
          <div className={`h-1.5 min-w-1.5 rounded-full ${best ? 'bg-win' : 'bg-muted'}`} style={{ width: `${q.impliedChance * 100}%` }} />
        </div>
      </div>
      <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
        {tradable ? (
          <button onClick={() => onPick(q.venue)} className={primary ? primaryBtn : secondaryBtn}>Bet {cost}</button>
        ) : (
          <a href={q.link} target="_blank" rel="noreferrer" className={`${primary ? primaryBtn : secondaryBtn} flex items-center justify-center gap-1.5 no-underline`}>
            Bet on {name}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
        )}
        {Math.abs(q.cost - stake) >= 0.01 && <span className="text-center text-xs text-faint">Closest to {usd(stake, stake % 1 ? 2 : 0)} it allows</span>}
      </div>
    </article>
  )
}

// A one-time explainer for the trade-off newcomers miss: likely bets pay little, long shots pay a lot.
function ChanceHint() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    try {
      setShow(!localStorage.getItem('hint:chance'))
    } catch {}
  }, [])
  if (!show) return null
  const dismiss = () => {
    setShow(false)
    try {
      localStorage.setItem('hint:chance', '1')
    } catch {}
  }
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-raised px-5 py-3.5">
      <p className="text-sm leading-normal text-ink-2">
        <strong className="font-medium text-ink">How the payout works:</strong> the chance is what people betting on this venue think. The more likely
        it looks, the less it pays. A 99% bet wins pennies; a 30% bet can triple your money.
      </p>
      <button onClick={dismiss} aria-label="Got it, hide this" className="-mr-2 -mt-1 grid h-10 w-10 flex-none place-items-center rounded-xl text-muted hover:bg-chip hover:text-ink">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  )
}

// The fine print for every venue on the table: which price decides it, when, and anything to watch out for.
function HowItWorks({ quotes }: { quotes: Quote[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2">
        <span className="text-[13px] text-faint">Your money goes to the venue you pick, never to us. Your wallet signs every step.</span>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="-mx-3 flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-muted hover:text-ink">
          How each venue works
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className={`transition ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      {open && (
        <div className="grid gap-3 md:grid-cols-2">
          {quotes.map((q) => (
            <div key={q.venue} className="flex flex-col gap-3 rounded-2xl border border-soft-line bg-surface p-5">
              <span className="flex items-center gap-2.5"><VenueMark venue={q.venue} /><span className="font-semibold">{VENUE_NAMES[q.venue]}</span></span>
              <QuoteDetails q={q} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function QuoteDetails({ q }: { q: Quote }) {
  return (
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
