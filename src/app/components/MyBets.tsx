'use client'

import { Fragment, useState } from 'react'
import type { Position, PositionStatus } from '@/lib/exec/types'
import { day, shortTitle, signedUsd, usd } from '@/lib/format'
import { useWallet } from '@/lib/wallet'
import { VENUE_NAMES } from './Quotes'
import { canSell, SellPanel } from './SellPanel'
import { Spinner } from './TradePanel'
import { WalletButton } from './WalletButton'

const OPEN: PositionStatus[] = ['live', 'claimable']
type Filter = 'open' | 'resolved'

const card = 'rounded-2xl border border-soft-line bg-surface'

export function StatusChip({ status }: { status: PositionStatus }) {
  // inline-flex so it hugs its text inside a table cell instead of stretching across the column.
  const base = 'inline-flex w-fit flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold'
  switch (status) {
    case 'live':
      return <span className={`${base} bg-live/[0.12] text-live-ink`}><span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden />Live</span>
    case 'claimable':
      return <span className={`${base} bg-win text-bg`}>Won · collect</span>
    case 'won':
      return <span className={`${base} bg-win/[0.12] text-win`}>Won</span>
    case 'lost':
      return <span className={`${base} bg-lose/[0.12] text-lose`}>Lost</span>
    case 'sold':
      return <span className={`${base} bg-chip text-ink-2`}>Sold</span>
  }
}

export function MyBets({ positions, error, loading, refresh }: {
  positions: Position[] | null
  error: string | null
  loading: boolean
  refresh: () => void
}) {
  const { address } = useWallet()
  const [filter, setFilter] = useState<Filter>('open')
  // One sale open at a time, keyed by venue and position.
  const [selling, setSelling] = useState<string | null>(null)
  const sell: SellState = { selling, setSelling, onSold: () => { setSelling(null); refresh() } }

  if (!address) {
    return (
      <section aria-label="Wallet not connected" className={`${card} mx-auto flex max-w-md flex-col items-center gap-3 rounded-[20px] px-5 py-7 text-center`}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--win)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 9h15a3 3 0 0 0-3-3" /></svg>
        <h2 className="text-[17px] font-semibold">Connect to see your bets</h2>
        <p className="max-w-[280px] text-sm leading-normal text-muted">We look them up at each venue using your wallet address. Read-only.</p>
        <WalletButton big />
      </section>
    )
  }

  if (!positions) {
    return (
      <section aria-busy aria-label="Loading your bets" className="flex flex-col gap-2">
        <div className="shimmer h-16 w-48 rounded-xl bg-surface" />
        <div className="shimmer grid grid-cols-2 gap-2"><div className="h-[72px] rounded-2xl bg-surface" /><div className="h-[72px] rounded-2xl bg-surface" /></div>
        <div className="shimmer h-24 rounded-2xl bg-surface" />
        <span className="text-[13px] text-faint">Loading your bets…</span>
      </section>
    )
  }

  const open = positions.filter((p) => OPEN.includes(p.status)).sort((a, b) => a.ends.localeCompare(b.ends))
  const resolved = positions.filter((p) => !OPEN.includes(p.status)).sort((a, b) => b.ends.localeCompare(a.ends))
  const live = positions.filter((p) => p.status === 'live')
  // Only finished bets count as won or lost; a live bet's price moves are not a result yet.
  const pnl = resolved.reduce((s, p) => s + p.pnl, 0)
  const pnlTone = pnl > 0 ? 'text-win' : pnl < 0 ? 'text-lose' : ''
  const ifAllWin = live.reduce((s, p) => s + p.payoutIfRight, 0)
  const inPlay = live.reduce((s, p) => s + p.value, 0)
  const claimable = open.filter((p) => p.status === 'claimable')
  const toCollect = claimable.reduce((s, p) => s + p.value, 0)

  if (positions.length === 0) {
    return (
      <section aria-label="No bets yet" className={`${card} mx-auto flex max-w-md flex-col items-center gap-3 rounded-[20px] px-5 py-7 text-center`}>
        <p className="text-[22px] font-medium tracking-[-0.02em] text-ink-2">I think<span className="text-win">…</span></p>
        <h2 className="text-[17px] font-semibold">No bets yet</h2>
        <p className="text-sm leading-normal text-muted">Write your first sentence and see what it pays.</p>
        <a href="#" className="flex min-h-12 items-center rounded-[14px] border border-strong-line px-[22px] text-[15px] font-medium text-ink no-underline hover:bg-raised">Make a bet</a>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-6 md:-mt-2 md:gap-10">
      {/* Mobile: one big figure and two tiles. Desktop: three equal-height cards with a line of context each. */}
      <section aria-label="Summary" className="flex flex-col gap-3 md:hidden">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">If all your live bets win</span>
          <span className="text-[40px] font-semibold tracking-[-0.03em] text-win">{usd(ifAllWin)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className={`${card} flex flex-col gap-1 p-3.5`}>
            <span className="text-[13px] text-muted">In play now</span>
            <span className="text-[22px] font-semibold tracking-[-0.02em]">{usd(inPlay)}</span>
          </div>
          <div className={`${card} flex flex-col gap-1 p-3.5`}>
            <span className="text-[13px] text-muted">Won so far, minus losses</span>
            <span className={`text-[22px] font-semibold tracking-[-0.02em] ${pnlTone}`}>{signedUsd(pnl)}</span>
          </div>
        </div>
      </section>

      <section aria-label="Summary" className="hidden flex-wrap items-stretch gap-4 md:flex">
        <SummaryCard className="flex-[2_1_360px] border-win/35" label="If all your live bets win" sub={`From ${plural(live.length, 'live bet')} · ${usd(live.reduce((s, p) => s + p.cost, 0))} put in`}>
          <span className="text-[56px] tracking-[-0.035em] text-win">{usd(ifAllWin)}</span>
        </SummaryCard>
        <SummaryCard className="flex-[1_1_220px]" label="In play now" sub={live.length ? `Across ${list(venuesOf(live))}` : 'Nothing live right now'}>
          {usd(inPlay)}
        </SummaryCard>
        <SummaryCard className="flex-[1_1_220px]" label="Won so far, minus losses" sub={`From ${plural(resolved.length, 'finished bet')}`}>
          <span className={pnlTone}>{signedUsd(pnl)}</span>
        </SummaryCard>
      </section>

      {claimable.length > 0 && (
        <div role="status" className="hidden flex-wrap items-center justify-between gap-4 rounded-2xl border border-win/30 bg-win/[0.07] px-5 py-3.5 md:flex">
          <span className="text-[15px] text-ink">
            You have <span className="font-semibold text-win">{usd(toCollect)}</span> waiting to collect on {list(venuesOf(claimable))}.
          </span>
          <a href={claimable[0].link} target="_blank" rel="noreferrer" className="flex min-h-11 items-center rounded-xl bg-win px-5 text-[15px] font-semibold text-bg no-underline hover:bg-win-hover">
            Collect {usd(toCollect)}
          </a>
        </div>
      )}

      <section aria-labelledby="bets-h" className="flex min-w-0 flex-col gap-3 md:gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="bets-h" className="flex items-center gap-2 text-[17px] font-semibold md:text-[22px] md:tracking-[-0.02em]">
            Your bets
            <button onClick={refresh} disabled={loading} aria-label="Refresh" title="Refresh" className="grid h-11 w-11 place-items-center rounded-full text-faint hover:text-ink disabled:opacity-60">
              {loading ? <Spinner /> : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
              )}
            </button>
          </h2>
          <div role="tablist" aria-label="Filter bets" className="grid grid-cols-2 rounded-full border border-soft-line bg-surface p-[3px]">
            {(['open', 'resolved'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-[38px] rounded-full px-4 text-sm capitalize md:min-h-10 md:px-5 ${filter === f ? 'bg-track font-medium text-ink' : 'text-muted hover:text-ink'}`}
              >
                {f}<span className="hidden md:inline"> · {(f === 'open' ? open : resolved).length}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div role="status" className={`${card} flex items-center justify-between gap-3 px-4 py-3.5`}>
            <span className="text-sm leading-[1.45] text-ink-2">{error}</span>
            <button onClick={refresh} className="min-h-11 flex-none rounded-xl border border-strong-line px-3.5 text-sm text-ink">Retry</button>
          </div>
        )}

        {filter === 'open' ? (
          open.length ? (
            <>
              <ul className="flex flex-col gap-2 md:hidden">
                {open.map((p) => <OpenBet key={`${p.venue}-${p.id}`} p={p} sell={sell} />)}
              </ul>
              <OpenTable bets={open} sell={sell} />
            </>
          ) : (
            <p className={`${card} p-6 text-center text-sm text-muted`}>Nothing open right now. <a href="#">Make a bet</a></p>
          )
        ) : resolved.length ? (
          <>
            <ul className="flex flex-col md:hidden">{resolved.map((p) => <ResolvedBet key={`${p.venue}-${p.id}`} p={p} />)}</ul>
            <ul className="hidden grid-cols-3 gap-3 md:grid">{resolved.map((p) => <ResolvedCard key={`${p.venue}-${p.id}`} p={p} />)}</ul>
          </>
        ) : (
          <p className={`${card} p-6 text-center text-sm text-muted`}>Nothing decided yet.</p>
        )}
      </section>

      <p className="text-xs leading-normal text-faint md:text-[13px]">
        Your bets live at each venue. We read them from there with your wallet address; we never hold your money.
      </p>
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const venuesOf = (ps: Position[]) => [...new Set(ps.map((p) => VENUE_NAMES[p.venue]))]
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

function SummaryCard({ label, sub, className, children }: { label: string; sub: string; className: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col justify-between gap-4 rounded-3xl border border-soft-line bg-surface p-7 ${className}`}>
      <span className="text-sm text-muted">{label}</span>
      <span className="text-4xl font-semibold leading-none tracking-[-0.025em]">{children}</span>
      <span className="text-[13px] text-faint">{sub}</span>
    </div>
  )
}

interface SellState { selling: string | null; setSelling: (k: string | null) => void; onSold: () => void }
const keyOf = (p: Position) => `${p.venue}-${p.id}`

const sellBtn = 'min-h-11 rounded-xl border border-strong-line px-4 text-sm font-medium text-ink transition hover:bg-raised'

// Desktop: open bets as a table, one row per bet, with the action on the right.
function OpenTable({ bets, sell }: { bets: Position[]; sell: SellState }) {
  const th = 'px-3 py-4 font-medium'
  return (
    <div className="hidden overflow-x-auto rounded-[20px] border border-soft-line bg-surface md:block">
      <table className="w-full min-w-[760px] border-collapse text-[15px]">
        <thead>
          <tr className="text-left text-xs uppercase tracking-[0.04em] text-faint">
            <th scope="col" className={`${th} pl-6`}>Your sentence</th>
            <th scope="col" className={th}>Where</th>
            <th scope="col" className={`${th} text-right`}>Put in</th>
            <th scope="col" className={`${th} text-right`}>If right</th>
            <th scope="col" className={th}>Status</th>
            <th scope="col" className={`${th} pr-6`}><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {bets.map((p) => {
            const claimable = p.status === 'claimable'
            const selling = sell.selling === keyOf(p)
            return (
              <Fragment key={keyOf(p)}>
              <tr className={`border-t border-chip ${claimable ? 'bg-win/[0.04]' : ''}`}>
                <td className="py-[18px] pl-6 pr-3">
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{shortTitle(p.title)}{p.outcome !== 'Yes' ? ` · ${p.outcome}` : ''}</span>
                    <span className="text-[13px] text-faint">{claimable ? 'Ended' : 'Decided'} {day(p.ends).replace(',', '')}</span>
                  </span>
                </td>
                <td className="px-3 py-[18px] text-ink-2">{VENUE_NAMES[p.venue]}</td>
                <td className="px-3 py-[18px] text-right">{usd(p.cost)}</td>
                <td className={`px-3 py-[18px] text-right text-win ${claimable ? 'font-semibold' : 'font-medium'}`}>
                  {claimable ? `${usd(p.value)} won` : usd(p.payoutIfRight)}
                </td>
                <td className="px-3 py-[18px]"><StatusChip status={p.status} /></td>
                <td className="py-[18px] pl-3 pr-6 text-right">
                  {claimable ? (
                    <a href={p.link} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-win px-[18px] text-sm font-semibold text-bg no-underline hover:bg-win-hover">
                      Collect
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-4">
                      <a href={p.link} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-ink">
                        View on {VENUE_NAMES[p.venue]}
                      </a>
                      {canSell(p) && !selling && <button onClick={() => sell.setSelling(keyOf(p))} className={sellBtn}>Sell</button>}
                    </span>
                  )}
                </td>
              </tr>
              {selling && (
                <tr>
                  <td colSpan={6} className="px-6 pb-5">
                    <SellPanel p={p} onClose={() => sell.setSelling(null)} onSold={sell.onSold} />
                  </td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ResolvedCard({ p }: { p: Position }) {
  const tone = p.status === 'won' ? 'text-win' : p.status === 'lost' ? 'text-lose' : 'text-ink-2'
  return (
    <li>
      <a href={p.link} target="_blank" rel="noreferrer" className="flex h-full flex-col gap-2.5 rounded-2xl border border-soft-line bg-surface p-[18px] text-ink no-underline transition hover:border-line">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-faint">{VENUE_NAMES[p.venue]} · {day(p.ends).replace(',', '')}</span>
          <StatusChip status={p.status} />
        </span>
        <span className="text-[15px] font-medium">{shortTitle(p.title)}</span>
        <span className={`text-xl font-semibold ${tone}`}>{signedUsd(p.pnl)}</span>
      </a>
    </li>
  )
}

function OpenBet({ p, sell }: { p: Position; sell: SellState }) {
  const claimable = p.status === 'claimable'
  const selling = sell.selling === keyOf(p)
  return (
    <li className={`flex flex-col gap-3 rounded-2xl border bg-surface p-4 ${claimable ? 'border-win/40' : 'border-soft-line'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <a href={p.link} target="_blank" rel="noreferrer" className="text-[15px] font-medium leading-[1.35] text-ink no-underline hover:text-win">
            {shortTitle(p.title)}{p.outcome !== 'Yes' ? ` · ${p.outcome}` : ''}
          </a>
          <span className="text-[13px] text-faint">{VENUE_NAMES[p.venue]} · {claimable ? 'ended' : 'decided'} {day(p.ends).replace(',', '')}</span>
        </div>
        <StatusChip status={p.status} />
      </div>
      {claimable ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-2">You won <span className="font-semibold text-win">{usd(p.value)}</span></span>
          <a href={p.link} target="_blank" rel="noreferrer" className="flex min-h-11 items-center rounded-xl bg-win px-[18px] text-[15px] font-semibold text-bg no-underline hover:bg-win-hover">
            Collect
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Figure label="You put in">{usd(p.cost)}</Figure>
          <Figure label="Worth now" center>{usd(p.value)}</Figure>
          <Figure label="If right" right><span className="font-medium text-win">{usd(p.payoutIfRight)}</span></Figure>
        </div>
      )}
      {canSell(p) &&
        (selling ? (
          <SellPanel p={p} onClose={() => sell.setSelling(null)} onSold={sell.onSold} />
        ) : (
          <button onClick={() => sell.setSelling(keyOf(p))} className={`${sellBtn} w-full`}>Sell now</button>
        ))}
    </li>
  )
}

function ResolvedBet({ p }: { p: Position }) {
  const tone = p.status === 'won' ? 'text-win' : p.status === 'lost' ? 'text-lose' : 'text-ink-2'
  return (
    <li className="flex min-h-[60px] items-center justify-between gap-3 border-b border-raised px-1 py-2">
      <a href={p.link} target="_blank" rel="noreferrer" className="flex min-w-0 flex-col gap-0.5 no-underline">
        <span className="text-sm text-ink">{shortTitle(p.title)}</span>
        <span className="text-xs text-faint">{VENUE_NAMES[p.venue]} · {usd(p.cost)} in · {day(p.ends).replace(',', '')}</span>
      </a>
      <span className="flex flex-col items-end gap-0.5 text-right">
        <StatusChip status={p.status} />
        <span className={`text-[13px] ${tone}`}>{signedUsd(p.pnl)}</span>
      </span>
    </li>
  )
}

function Figure({ label, center, right, children }: { label: string; center?: boolean; right?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-0.5 ${center ? 'text-center' : right ? 'text-right' : ''}`}>
      <span className="text-xs text-faint">{label}</span>
      <span className="text-ink">{children}</span>
    </div>
  )
}
