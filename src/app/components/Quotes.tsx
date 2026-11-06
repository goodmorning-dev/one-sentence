'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { executors } from '@/lib/exec'
import { chanceWords, day, usd, when } from '@/lib/format'
import type { Asset, Quote, Unavailable, VenueId, VenueResult } from '@/lib/venues/types'
import { Dialog } from './Dialog'
import { PriceChart } from './PriceChart'
import { VenueIcon, venueStyle } from './VenueIcon'
import { quickDates } from './Sentence'

export const VENUE_NAMES: Record<VenueId, string> = { derive: 'Derive', polymarket: 'Polymarket', hyperliquid: 'Hyperliquid' }

export interface QuotesData { results: VenueResult[]; best: VenueId | null; comparable: VenueId[]; error?: string }

const card = 'rounded-[20px] border bg-surface sm:rounded-3xl'

export function VenueMark({ venue, muted = false, small = false }: { venue: VenueId; muted?: boolean; small?: boolean }) {
  return <VenueIcon venue={venue} muted={muted} size={small ? 20 : 30} />
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
      <section className={`${card} relative flex flex-col gap-6 overflow-hidden border-soft-line p-5 sm:p-7`}>
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-live/[0.08] blur-3xl" />

        {/* What happened, in one line, with an icon so it reads as a state rather than an error. */}
        <div className="relative flex items-start gap-4">
          <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-2xl border border-live/30 bg-live/10 text-live">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8.5 11h5" /></svg>
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Nobody offers this exact bet</h2>
            <p className="text-sm leading-normal text-muted">
              {offers.length
                ? `We asked ${none.length} venues. Here ${offers.length === 1 ? 'is the closest bet' : 'are the closest bets'} you can place right now.`
                : 'Markets this far out usually open a day or two before. Try a closer date.'}
            </p>
          </div>
        </div>

        {/* The way forward: each nearby bet as a card in its venue's colours, one click to put it in the sentence. */}
        <div className="relative grid gap-3 sm:grid-cols-2">
          {offers.length
            ? offers.map((o) => (
                <button
                  key={`${o.suggest.level}|${o.suggest.date}`}
                  onClick={() => onTry(o.suggest)}
                  style={venueStyle(o.venue)}
                  className="group relative flex items-center gap-4 overflow-hidden rounded-[18px] border border-(--venue)/35 bg-(--venue)/[0.06] p-4 text-left transition hover:border-(--venue) hover:bg-(--venue)/[0.1]"
                >
                  <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-(--venue)" />
                  <VenueIcon venue={o.venue} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-xs font-medium uppercase tracking-[0.06em] text-faint">Try instead</span>
                    <span className="text-[17px] font-semibold text-ink">
                      {asset} above <span className="text-win">{usd(o.suggest.level, 0)}</span>
                    </span>
                    <span className="text-[13px] text-muted">on {day(o.suggest.date).replace(',', '')} · via {VENUE_NAMES[o.venue]}</span>
                  </span>
                  <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-(--venue) text-bg transition group-hover:translate-x-0.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </span>
                </button>
              ))
            : quickDates().slice(0, 2).map((q) => (
                <button
                  key={q.label}
                  onClick={() => onTry({ date: q.date })}
                  className="group flex items-center justify-between gap-3 rounded-[18px] border border-strong-line bg-raised/40 p-4 text-left transition hover:border-win/50 hover:bg-win/[0.06]"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium uppercase tracking-[0.06em] text-faint">Try</span>
                    <span className="text-[17px] font-semibold text-ink">{q.label}</span>
                    <span className="text-[13px] text-muted">{day(q.date).replace(',', '')}</span>
                  </span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-win transition group-hover:translate-x-0.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              ))}
        </div>

        {/* What each venue said, as a quiet list underneath for anyone curious. */}
        <div className="relative flex flex-col gap-2 border-t border-chip pt-4">
          <span className="text-xs font-medium uppercase tracking-[0.06em] text-faint">What each venue said</span>
          <ul className="grid gap-2 sm:grid-cols-3">
            {none.map((r) => (
              <li key={r.venue} className="flex items-start gap-2.5 rounded-xl bg-bg/40 px-3 py-2.5">
                <VenueIcon venue={r.venue} size={22} muted />
                <span className="flex flex-col">
                  <span className="text-[13px] font-medium text-ink-2">{VENUE_NAMES[r.venue]}</span>
                  <span className="text-xs leading-snug text-faint">{friendly(r.reason)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
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
          Your bet
        </h2>
        <LiveStamp at={updatedAt} loading={loading} />
      </div>

      {/* The price asked for isn't on offer: say which one the offers below are for, and switch to it in one click. */}
      {!exact && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-live/35 bg-live/[0.07] px-5 py-3.5">
          <span className="flex items-start gap-3 text-sm leading-normal text-ink-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="mt-px flex-none text-live"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            <span>
              Nobody offers exactly {fmt(level)}. The closest bet is <strong className="font-semibold text-ink">above {fmt(strike)}</strong>
              <span className="text-faint"> ({strike > level ? '+' : '−'}{fmt(Math.abs(strike - level))})</span>, and the offers below are for that.
            </span>
          </span>
          <button
            onClick={() => onTry({ level: strike })}
            className="group inline-flex min-h-10 items-center gap-1.5 rounded-full bg-live px-4 text-[13px] font-semibold text-bg transition hover:bg-live-ink"
          >
            Use {fmt(strike)}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition group-hover:translate-x-0.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      )}

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
      <div inert={loading} style={venueStyle(lead.venue)} className={`${card} relative overflow-hidden border-(--venue)/30 transition-opacity ${loading ? 'opacity-50' : ''}`}>
        {/* The venue's colour along the top, as on the other offers' cards. */}
        <span aria-hidden className="absolute inset-x-0 top-0 z-[1] h-[3px] bg-(--venue)" />
        <PriceChart
          asset={asset}
          spot={spot}
          settles={lead.settles}
          payout={lead.payoutIfRight}
          highlight={hover}
          lines={[...same, ...others].map((q) => ({ venue: q.venue, price: q.actualLevel, main: q === lead, label: `${VENUE_NAMES[q.venue]} · ${pct(q.impliedChance)}` }))}
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

      <p className="px-2 text-[13px] text-faint">Your money goes to the venue you pick, never to us. Your wallet signs every step.</p>
    </section>
  )
}


// Venues word "nothing to bet on here" in their own terms; people only need to know there's no market.
const NO_MARKET = 'No market for that day'
function friendly(reason: string) {
  if (/already true/i.test(reason)) return 'Too sure a thing: it would pay back less than it costs'
  return /no open|no .*market|no tradable|no strike|not taking orders/i.test(reason) ? NO_MARKET : reason
}

const money = (n: number) => usd(n, n % 1 ? 2 : 0)

const ESTIMATE_WHY =
  'Prices move all the time, and right now there isn’t enough on offer at this exact price for your whole bet. So the final price is set the moment you bet, and it can be a little different from what you see here. You never pay more than you put in: if it would cost more, nothing happens and nothing is spent.'

// A small "i" that explains something on hover, keyboard focus or tap, without crowding the line it sits on.
function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="grid h-[18px] w-[18px] cursor-help place-items-center rounded-full border border-live/60 bg-live/15 text-[11px] font-bold italic leading-none text-live transition hover:border-live hover:bg-live hover:text-bg aria-expanded:border-live aria-expanded:bg-live aria-expanded:text-bg"
      >
        i
      </button>
      {open && (
        <span role="tooltip" className="absolute bottom-full left-1/2 z-20 mb-2 w-72 max-w-[80vw] -translate-x-1/2 rounded-xl border border-strong-line bg-surface px-3.5 py-2.5 text-[13px] font-normal not-italic leading-snug text-ink-2 shadow-lg">
          {children}
        </span>
      )}
    </span>
  )
}

// The chance as a count people picture more easily: "1 in 17" when it's unlikely, "7 in 10" when it's likely.
function odds(p: number) {
  const c = Math.min(0.99, Math.max(0.01, p))
  return c < 0.5 ? `1 in ${Math.round(1 / c)}` : `${Math.min(9, Math.round(c * 10))} in 10`
}

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
        {/* The payout as one sentence: the condition leads straight into the big number it pays. */}
        <div className="relative flex flex-col gap-3 overflow-hidden px-5 py-6 sm:px-7 sm:py-8">
          <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-(--venue)/[0.09] blur-3xl" />
          <p className="relative flex items-start gap-2.5 text-[16px] leading-snug text-ink-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 flex-none text-(--venue)"><path d="M4 21V4M4 4h12l-2 4 2 4H4" /></svg>
            <span>
              If {asset} is above <strong className="font-semibold text-ink">{money(q.actualLevel)}</strong> on <strong className="font-semibold text-ink">{when(q.settles)}</strong>, you get
            </span>
          </p>
          <div className="relative flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <span key={q.payoutIfRight} className="rise text-[44px] font-semibold leading-none tracking-[-0.035em] text-win tabular-nums sm:text-[56px]">{usd(q.payoutIfRight)}</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-medium text-ink-2 tabular-nums">+{usd(profit)} profit</span>
              <span className="rounded-full bg-win/15 px-2.5 py-0.5 text-xs font-semibold text-win">{times >= 10 ? Math.round(times) : times.toFixed(1)}× your money</span>
            </span>
          </div>
        </div>

        {/* The other side of the bet: what goes in, what's lost, how likely. */}
        <dl className="flex flex-col divide-y divide-chip border-t border-chip bg-(--venue)/[0.035] px-5 py-6 text-[15px] sm:px-7 md:border-l md:border-t-0 md:py-8">
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
            </dd>
          </div>
          <div className="flex flex-col gap-2.5 pt-3.5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">Chance</dt>
              <dd className="text-right"><span className="text-lg font-semibold text-ink tabular-nums">{pct(q.impliedChance)}</span> <span className="text-sm text-faint">{mood}</span></dd>
            </div>
            <div role="img" aria-label={`Chance: ${pct(q.impliedChance)}, ${mood}`} className="h-2 rounded-full bg-track">
              <div className="h-2 min-w-2 rounded-full bg-(--venue)" style={{ width: `${q.impliedChance * 100}%` }} />
            </div>
            <span className="text-xs leading-snug text-faint">
              Going by {name}&rsquo;s prices, about <span className="text-ink-2">{odds(q.impliedChance)}</span> bets like this pay out
            </span>
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
        <span className="flex flex-wrap items-center justify-center gap-2 text-[13px] text-faint sm:justify-end">
          <VenueInfo q={q} />
          <span style={venueStyle(q.venue)} className="flex items-center gap-2 rounded-full border border-(--venue)/30 bg-(--venue)/[0.08] py-1 pl-1 pr-3 text-ink-2">
            <VenueMark venue={q.venue} small />
            Through <span className="font-semibold text-(--venue)">{name}</span>
          </span>
          {best && <span className="rounded-full bg-win px-2 py-0.5 text-[11px] font-semibold text-bg">Best of {checked}</span>}
        </span>
      </div>
      {q.estimate && (
        <p className="flex items-center gap-2 border-t border-chip px-5 py-3 text-[13px] text-ink-2 sm:px-7">
          <span aria-hidden className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-live" />
          The price may shift a little when you bet
          <InfoTip label="Why the price may shift">{ESTIMATE_WHY}</InfoTip>
        </p>
      )}
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
  const [open, setOpen] = useState(true) // shown by default; "Hide" folds it away
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
          {/* Every venue as a card in one grid: the offers first, then the ones with nothing for this sentence. */}
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((q) => (
              <OtherOffer key={q.venue} q={q} lead={lead} asset={asset} best={best === q.venue} other={!same.includes(q)} stake={stake} onPick={onPick} onHover={onHover} />
            ))}
            {none.map((r) => (
              <NoOffer key={r.venue} r={r} onTry={onTry} />
            ))}
          </div>
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
  const button = 'group flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-(--venue)/35 px-5 text-[15px] font-semibold text-ink no-underline transition hover:border-(--venue) hover:bg-(--venue)/10'
  return (
    <article
      onMouseEnter={() => onHover(q.venue)}
      onMouseLeave={() => onHover(null)}
      aria-label={`${name}${best ? ', best price' : ''}`}
      style={venueStyle(q.venue)}
      className="relative flex flex-col gap-4 rounded-[20px] border border-(--venue)/25 bg-surface p-5 transition hover:border-(--venue)/60"
    >
      {/* The venue's colour: a strip along the top and a soft glow in the corner, so the card reads as theirs. Clipped
          in their own layer, so the card itself doesn't clip tooltips. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[19px]">
        <span className="absolute inset-x-0 top-0 h-[3px] bg-(--venue)" />
        <span className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-(--venue)/[0.08] blur-3xl" />
      </span>
      <header className="relative z-10 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <VenueMark venue={q.venue} />
          <span className="text-[16px] font-semibold">{name}</span>
          {best && <span className="rounded-full bg-win px-2 py-0.5 text-[11px] font-semibold text-bg">Best price</span>}
          {q.estimate && (
            <span className="flex items-center gap-1 rounded-full bg-chip py-0.5 pl-2 pr-1 text-[11px] text-ink-2">
              Price may shift
              <InfoTip label="Why the price may shift">{ESTIMATE_WHY}</InfoTip>
            </span>
          )}
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
          <div className="h-1.5 min-w-1.5 rounded-full bg-(--venue)" style={{ width: `${q.impliedChance * 100}%` }} />
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
        <VenueInfo q={q} className="self-center" />
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

// What each venue is and what you're actually buying there, in plain words.
const VENUE_ABOUT: Record<VenueId, { what: string; points: string[] }> = {
  derive: {
    what: 'An options exchange. Derive has no yes/no bets, so we build yours from two call options that together pay a fixed amount if the price ends above your level.',
    points: [
      'Money sits in your own Derive account, in USDC.',
      'It settles by itself at the expiry and the payout lands in that account.',
      'You can sell the bet early from My bets.',
    ],
  },
  polymarket: {
    what: 'A prediction market. You buy "Yes" shares on a question like "ETH above $X on that day?". Each share pays $1 if the answer is yes and nothing if not.',
    points: [
      'The share price is what the crowd thinks the chance is.',
      'Paid in USDC on Polygon: each winning share is worth $1 once the market is resolved.',
      'You can sell your shares to other people before it’s decided.',
    ],
  },
  hyperliquid: {
    what: 'An exchange with yes/no outcome markets on prices. You buy "Yes" on the outcome; it pays out if the price is above the level at the set time.',
    points: [
      'Money sits in your Hyperliquid account, in USDC.',
      'Settles by itself at the set time and pays into that account.',
      'You can sell the outcome early while the market is open.',
    ],
  },
}

// "How Derive works": a small link on each offer card that opens the details in a modal.
function VenueInfo({ q, className = '' }: { q: Quote; className?: string }) {
  const [open, setOpen] = useState(false)
  const name = VENUE_NAMES[q.venue]
  const about = VENUE_ABOUT[q.venue]
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted transition hover:bg-(--venue)/10 hover:text-ink ${className}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="text-(--venue)"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
        How {name} works
      </button>
      {open && (
        <Dialog title={`How ${name} works`} onClose={() => setOpen(false)}>
          <div style={venueStyle(q.venue)} className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-2xl border border-(--venue)/25 bg-(--venue)/[0.06] p-4">
              <VenueIcon venue={q.venue} size={36} />
              <p className="text-[14px] leading-relaxed text-ink-2">{about.what}</p>
            </div>
            <ul className="flex flex-col gap-2 text-[14px] leading-snug text-ink-2">
              {about.points.map((p) => (
                <li key={p} className="flex gap-2.5">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-(--venue)" />
                  {p}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-3 border-t border-chip pt-4">
              <span className="text-xs font-medium uppercase tracking-[0.06em] text-faint">This bet</span>
              <QuoteDetails q={q} />
            </div>
            <p className="text-[13px] text-faint">Your money goes to {name}, never to us. Your wallet signs every step.</p>
          </div>
        </Dialog>
      )}
    </>
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
// A venue with nothing for this sentence, as a card like the offers: why, and a nearby bet it does have.
function NoOffer({ r, onTry }: { r: Unavailable; onTry: (patch: { level: number; date: string }) => void }) {
  const name = VENUE_NAMES[r.venue]
  return (
    <article aria-label={`${name}: no offer`} className="flex flex-col gap-4 rounded-[20px] border border-dashed border-soft-line bg-surface/40 p-5">
      <header className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <VenueMark venue={r.venue} muted />
          <span className="text-[16px] font-semibold text-ink-2">{name}</span>
        </span>
        <span className="rounded-full bg-chip px-2.5 py-1 text-xs font-medium text-faint">No offer</span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-bg/40 px-4 py-6 text-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-faint"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>
        <span className="text-[15px] text-ink-2">{friendly(r.reason)}</span>
        <span className="text-[13px] text-faint">{r.suggest ? `${name} has a bet close to yours:` : `Nothing to bet on at ${name} for this sentence.`}</span>
      </div>

      {r.suggest && (
        <button
          onClick={() => onTry(r.suggest!)}
          className="mt-auto flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-win/40 px-5 text-[15px] font-semibold text-win transition hover:bg-win/10"
        >
          Try {usd(r.suggest.level, 0)} on {day(r.suggest.date).replace(',', '')}
        </button>
      )}
    </article>
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
