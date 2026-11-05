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
    // Bets the venues can take near this one, nearest date first: one click puts them in the sentence.
    const seen = new Set<string>()
    const offers = none
      .filter((r) => r.suggest)
      .map((r) => ({ venue: r.venue, suggest: r.suggest! }))
      .filter((o) => !seen.has(`${o.suggest.level}|${o.suggest.date}`) && !!seen.add(`${o.suggest.level}|${o.suggest.date}`))
    return (
      <section className={`${card} flex flex-col gap-4 border-soft-line p-5 sm:p-6`}>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[17px] font-semibold">Nobody offers this exact bet</h2>
          <p className="text-sm leading-normal text-muted">
            {offers.length ? 'These are the closest bets you can place right now:' : 'Markets this far out usually open a day or two before. Try a closer date.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {offers.length
            ? offers.map((o) => (
                <button
                  key={`${o.suggest.level}|${o.suggest.date}`}
                  onClick={() => onTry(o.suggest)}
                  className="flex min-h-12 flex-col items-start justify-center rounded-2xl border border-win/40 px-4 py-2 text-left transition hover:bg-win/10"
                >
                  <span className="text-[15px] font-medium text-win">{asset} above {usd(o.suggest.level, 0)} on {day(o.suggest.date).replace(',', '')}</span>
                  <span className="text-xs text-faint">on {VENUE_NAMES[o.venue]}</span>
                </button>
              ))
            : quickDates().slice(0, 2).map((q) => (
                <button key={q.label} onClick={() => onTry({ date: q.date })} className="min-h-11 rounded-full border border-strong-line px-4 text-sm text-ink hover:bg-raised">
                  Try {q.label.toLowerCase()}
                </button>
              ))}
        </div>
        <p className="text-[13px] leading-normal text-faint">
          Checked {none.map((r) => VENUE_NAMES[r.venue]).join(', ')}: {none.every((r) => friendly(r.reason) === NO_MARKET) ? NO_MARKET.toLowerCase() : none.map((r) => `${VENUE_NAMES[r.venue]}: ${friendly(r.reason)}`).join(' · ')}.
        </p>
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

      {/* While new prices load the offer describes the previous sentence: dim it and make it inert. */}
      <div inert={loading} className={`${card} overflow-hidden border-soft-line transition-opacity ${loading ? 'opacity-50' : ''}`}>
        <PriceChart
          asset={asset}
          spot={spot}
          settles={lead.settles}
          highlight={hover}
          lines={[...same, ...others].map((q) => ({ venue: q.venue, price: q.actualLevel, main: same.includes(q), label: `${VENUE_NAMES[q.venue]} · ${pct(q.impliedChance)}` }))}
        />
        <Offer q={lead} asset={asset} stake={stake} checked={data.results.length} best={data.best === lead.venue && same.length > 1} onPick={onPick} />
      </div>

      <Compare
        rows={[...same, ...others].filter((q) => q !== lead)}
        lead={lead}
        asset={asset}
        none={none}
        best={data.best}
        same={same}
        stake={stake}
        onPick={onPick}
        onHover={setHover}
        onTry={onTry}
      />

      <ChanceHint />

      <HowItWorks quotes={quotes} />
    </section>
  )
}


// Venues word "nothing to bet on here" in their own terms; people only need to know there's no market.
const NO_MARKET = 'No market for that day'
function friendly(reason: string) {
  return /no open|no .*market|no tradable|no strike|not taking orders/i.test(reason) ? NO_MARKET : reason
}

const money = (n: number) => usd(n, n % 1 ? 2 : 0)

// The best offer as one plain sentence, with the one button that places it. Everything else is a click away.
function Offer({ q, asset, stake, checked, best, onPick }: {
  q: Quote
  asset: Asset
  stake: number
  checked: number // venues asked, for "best of N"
  best: boolean
  onPick: (v: VenueId) => void
}) {
  const name = VENUE_NAMES[q.venue]
  const tradable = !!q.ticket && !!executors[q.venue]
  const profit = q.payoutIfRight - q.cost
  const { mood } = chanceWords(q.impliedChance)
  const times = q.payoutIfRight / q.cost
  const button = 'group flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-win px-7 text-[17px] font-semibold text-bg no-underline shadow-[0_8px_30px_-12px_var(--win)] transition hover:bg-win-hover sm:w-auto sm:min-w-64'
  const arrow = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition group-hover:translate-x-0.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  const row = 'flex items-baseline justify-between gap-4 py-3.5 first:pt-0 last:pb-0'
  return (
    <article aria-label={`Best offer, on ${name}`} className="border-t border-chip">
      <div className="grid md:grid-cols-[1.45fr_1fr]">
        {/* The payout: what someone actually wants to know first, big, with the condition right under it. */}
        <div className="relative flex flex-col gap-4 overflow-hidden px-5 py-6 sm:px-7 sm:py-8">
          <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-win/[0.07] blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-muted">If you&rsquo;re right you get</span>
            <span className="rounded-full bg-win/15 px-2.5 py-0.5 text-xs font-semibold text-win">{times >= 10 ? Math.round(times) : times.toFixed(1)}× your money</span>
          </div>
          <div className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span key={q.payoutIfRight} className="rise text-[44px] font-semibold leading-none tracking-[-0.035em] text-win tabular-nums sm:text-[56px]">{usd(q.payoutIfRight)}</span>
            <span className="text-[17px] font-medium text-ink-2 tabular-nums">+{usd(profit)} profit</span>
          </div>
          <p className="relative flex items-start gap-2.5 rounded-xl border border-soft-line bg-bg/40 px-3.5 py-3 text-[15px] leading-snug text-ink-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-px flex-none text-win"><path d="M4 21V4M4 4h12l-2 4 2 4H4" /></svg>
            <span>
              If {asset} is above <strong className="font-semibold text-ink">{money(q.actualLevel)}</strong> on <strong className="font-semibold text-ink">{when(q.settles)}</strong>
            </span>
          </p>
        </div>

        {/* The other side of the bet: what goes in, what's lost, how likely. */}
        <dl className="flex flex-col divide-y divide-chip border-t border-chip bg-raised/30 px-5 py-6 text-[15px] sm:px-7 md:border-l md:border-t-0 md:py-8">
          <div className={row}>
            <dt className="text-muted">You put in</dt>
            <dd className="text-right">
              <span className="text-lg font-semibold text-ink tabular-nums">{money(q.cost)}</span>
              {Math.abs(q.cost - stake) >= 0.01 && <span className="block text-xs text-faint">nearest to {money(stake)}: fixed sizes</span>}
            </dd>
          </div>
          <div className={row}>
            <dt className="text-muted">If you&rsquo;re wrong</dt>
            <dd className="text-right">
              <span className="text-lg font-semibold text-lose tabular-nums">−{money(q.cost)}</span>
              {q.partialFrom != null && <span className="block text-xs text-faint">below {money(q.partialFrom)}; part back between</span>}
            </dd>
          </div>
          <div className="flex flex-col gap-2.5 pt-3.5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">Chance</dt>
              <dd className="text-right"><span className="text-lg font-semibold text-ink tabular-nums">{pct(q.impliedChance)}</span> <span className="text-sm text-faint">{mood}</span></dd>
            </div>
            <div role="img" aria-label={`Chance: ${pct(q.impliedChance)}, ${mood}`} className="h-2 rounded-full bg-track">
              <div className="h-2 min-w-2 rounded-full bg-win" style={{ width: `${q.impliedChance * 100}%` }} />
            </div>
            <span className="text-xs text-faint">What people betting on {name} think</span>
          </div>
        </dl>
      </div>

      <div className="flex flex-col items-stretch gap-3 border-t border-chip px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        {tradable ? (
          <button onClick={() => onPick(q.venue)} className={button}>Bet {money(q.cost)}{arrow}</button>
        ) : (
          <a href={q.link} target="_blank" rel="noreferrer" className={button}>
            Bet on {name}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
        )}
        <span className="flex items-center justify-center gap-2 text-[13px] text-faint sm:justify-end">
          <VenueMark venue={q.venue} small />
          Through {name}
          {best && <span className="rounded-full bg-win px-2 py-0.5 text-[11px] font-semibold text-bg">Best of {checked}</span>}
        </span>
      </div>
      {q.estimate && <p className="border-t border-chip px-5 py-3 text-[13px] text-lose-ink sm:px-7">Estimated prices: not enough is on offer at them, so the real price comes when you bet.</p>}
    </article>
  )
}

// Everything that isn't the offer: other venues' prices and why the rest had nothing. Closed by default.
function Compare({ rows, lead, asset, none, best, same, stake, onPick, onHover, onTry }: {
  rows: Quote[]
  lead: Quote
  asset: Asset
  none: Unavailable[]
  best: VenueId | null
  same: Quote[]
  stake: number
  onPick: (v: VenueId) => void
  onHover: (v: VenueId | null) => void
  onTry: (patch: { level?: number; date?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  if (!rows.length && !none.length) return null
  const summary = rows.length
    ? `${rows.length} other ${rows.length === 1 ? 'offer' : 'offers'}${none.length ? `; ${none.map((r) => VENUE_NAMES[r.venue]).join(' and ')} had nothing` : ''}`
    : `Also checked ${none.map((r) => VENUE_NAMES[r.venue]).join(' and ')}: ${none.every((r) => friendly(r.reason) === NO_MARKET) ? NO_MARKET.toLowerCase() : 'nothing to offer'}`
  return (
    <div className="flex flex-col gap-3">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="-mx-1 flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-left text-sm text-muted hover:text-ink">
        <span>{summary}</span>
        <span className="flex flex-none items-center gap-1.5">
          {open ? 'Hide' : 'Compare'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className={`transition ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          {rows.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {rows.map((q) => (
                <OtherOffer key={q.venue} q={q} lead={lead} asset={asset} best={best === q.venue} other={!same.includes(q)} stake={stake} onPick={onPick} onHover={onHover} />
              ))}
            </div>
          )}
          {none.length > 0 && (
            <ul className="flex flex-col rounded-2xl border border-dashed border-soft-line px-5 py-1">
              {none.map((r) => (
                <li key={r.venue} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-chip py-2.5 first:border-t-0">
                  <span className="flex items-center gap-3">
                    <VenueMark venue={r.venue} muted />
                    <span className="flex flex-col">
                      <span className="text-[15px] text-ink-2">{VENUE_NAMES[r.venue]}</span>
                      <span className="text-[13px] text-faint">{friendly(r.reason)}</span>
                    </span>
                  </span>
                  {r.suggest && <TryButton suggest={r.suggest} onTry={onTry} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// "Likely · 72%": the mood first for someone new to this, the number for everyone else.
const pct = (p: number) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`
export function chanceLabel(p: number) {
  const { mood } = chanceWords(p)
  return `${mood[0].toUpperCase()}${mood.slice(1)} · ${pct(p)}`
}

// Another venue's offer as a small card in the same language as the main one: what you get, for what, how likely.
// A different price is a different bet, so the card says how it differs from the main offer.
function OtherOffer({ q, lead, asset, best, other, stake, onPick, onHover }: {
  q: Quote
  lead: Quote
  asset: Asset
  best: boolean
  other: boolean // a different price from the main offer's
  stake: number
  onPick: (v: VenueId) => void
  onHover: (v: VenueId | null) => void
}) {
  const name = VENUE_NAMES[q.venue]
  const tradable = !!q.ticket && !!executors[q.venue]
  const { mood } = chanceWords(q.impliedChance)
  const times = q.payoutIfRight / q.cost
  const higher = q.actualLevel > lead.actualLevel
  const button = 'group flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-strong-line px-5 text-[15px] font-semibold text-ink no-underline transition hover:border-win/60 hover:bg-win/[0.06]'
  return (
    <article
      onMouseEnter={() => onHover(q.venue)}
      onMouseLeave={() => onHover(null)}
      aria-label={`${name}${best ? ', best price' : ''}`}
      className="flex flex-col gap-4 rounded-[20px] border border-soft-line bg-surface p-5 transition hover:border-strong-line"
    >
      <header className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <VenueMark venue={q.venue} />
          <span className="text-[16px] font-semibold">{name}</span>
          {best && <span className="rounded-full bg-win px-2 py-0.5 text-[11px] font-semibold text-bg">Best price</span>}
          {q.estimate && <span title="Not enough is on offer at these prices; the real price comes when you bet" className="rounded-full bg-chip px-2 py-0.5 text-[11px] text-ink-2">Estimate</span>}
        </span>
        <span className="rounded-full bg-chip px-2.5 py-1 text-xs font-semibold text-ink-2">{times >= 10 ? Math.round(times) : times.toFixed(1)}×</span>
      </header>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-[0.06em] text-faint">You get</span>
        <span className="flex flex-wrap items-baseline gap-x-2.5">
          <span key={q.payoutIfRight} className="rise text-[30px] font-semibold leading-tight tracking-[-0.03em] text-win tabular-nums">{usd(q.payoutIfRight)}</span>
          <span className="text-sm text-muted tabular-nums">for {money(q.cost)}</span>
        </span>
      </div>

      <p className="flex flex-col gap-1 rounded-xl bg-bg/50 px-3.5 py-2.5 text-sm leading-snug text-ink-2">
        <span>
          If {asset} is above <strong className="font-semibold text-ink">{money(q.actualLevel)}</strong>
          {q.partialFrom != null && <span className="text-faint"> (part back from {money(q.partialFrom)})</span>}
        </span>
        {other && (
          <span className="text-[13px] text-live-ink">
            A different bet: {higher ? 'higher' : 'lower'} than the {money(lead.actualLevel)} above
          </span>
        )}
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted">Chance</span>
          <span><span className="font-semibold text-ink tabular-nums">{pct(q.impliedChance)}</span> <span className="text-faint">{mood}</span></span>
        </div>
        <div role="img" aria-label={`Chance: ${pct(q.impliedChance)}, ${mood}`} className="h-1.5 rounded-full bg-track">
          <div className="h-1.5 min-w-1.5 rounded-full bg-muted" style={{ width: `${q.impliedChance * 100}%` }} />
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-1.5">
        {tradable ? (
          <button onClick={() => onPick(q.venue)} className={button}>
            Bet {money(q.cost)}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition group-hover:translate-x-0.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        ) : (
          <a href={q.link} target="_blank" rel="noreferrer" className={button}>
            Bet on {name}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
        )}
        {Math.abs(q.cost - stake) >= 0.01 && <span className="text-center text-xs text-faint">Fixed sizes: nearest to {money(stake)}</span>}
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
    <span className={`flex items-center gap-1.5 text-xs text-faint ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s < 60 ? 'bg-win' : 'bg-faint'} ${loading ? 'shimmer' : ''}`} aria-hidden />
      {loading ? 'Updating…' : s < 60 ? `Live prices · ${s}s ago` : `Prices from ${Math.round(s / 60)}m ago`}
    </span>
  )
}
