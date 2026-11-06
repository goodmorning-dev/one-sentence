'use client'

import { day, usd } from '@/lib/format'
import type { Asset, Quote, VenueId } from '@/lib/venues/types'
import { QuoteDetails, VENUE_NAMES } from './Quotes'
import { TradePanel } from './TradePanel'

// Placing a bet gets the whole stage: one centred column, whichever venue was picked. If another venue at the
// same price pays more, a quiet line offers to switch.
export function BetScreen({ quote, asset, better, onBack, onSwitch, onTraded }: {
  quote: Quote
  asset: Asset
  better: Quote | null
  onBack: () => void
  onSwitch: (venue: VenueId) => void
  onTraded: () => void
}) {
  const name = VENUE_NAMES[quote.venue]
  const stake = usd(quote.cost, quote.cost % 1 ? 2 : 0)

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <button onClick={onBack} className="-ml-1 flex min-h-11 items-center gap-1.5 self-start px-1 text-sm text-muted hover:text-ink">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        All venues
      </button>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted">Placing your bet on {name}</span>
        <p className="text-[26px] font-medium leading-[1.3] tracking-[-0.025em] sm:text-[30px]">
          {asset} {quote.direction} <span className="text-win">{usd(quote.actualLevel, quote.actualLevel % 1 ? 2 : 0)}</span> on <span className="text-win">{day(quote.settles)}</span>
        </p>
      </div>

      <dl className="grid grid-cols-3 rounded-[18px] border border-soft-line bg-surface">
        <Cell label="You put in">{stake}</Cell>
        <Cell label="If you’re right" tone="text-win">{usd(quote.payoutIfRight)}</Cell>
        <Cell label="If you’re wrong" tone="text-lose" last>−{stake}</Cell>
      </dl>

      <TradePanel key={quote.venue} quote={quote} venueName={name} onClose={onBack} onTraded={onTraded} />

      {better && (
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-chip px-5 py-2">
          <span className="text-sm text-muted">
            {VENUE_NAMES[better.venue]} pays a bit more: <span className="font-medium text-win">{usd(better.payoutIfRight)}</span> if right
          </span>
          <button onClick={() => onSwitch(better.venue)} className="flex min-h-11 items-center text-sm text-win hover:text-win-hover">Switch</button>
        </div>
      )}

      <details className="rounded-2xl border border-chip px-5">
        <summary className="flex min-h-14 cursor-pointer items-center text-sm text-muted hover:text-ink">How this bet is decided</summary>
        <div className="pb-5"><QuoteDetails q={quote} /></div>
      </details>
    </div>
  )
}

function Cell({ label, tone = '', last = false, children }: { label: string; tone?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 px-3 py-4 sm:px-5 sm:py-[18px] ${last ? '' : 'border-r border-chip'}`}>
      <dt className="text-xs text-muted sm:text-[13px]">{label}</dt>
      <dd className={`break-words text-[15px] font-semibold leading-tight tabular-nums min-[400px]:text-lg sm:text-[22px] ${tone}`}>{children}</dd>
    </div>
  )
}
