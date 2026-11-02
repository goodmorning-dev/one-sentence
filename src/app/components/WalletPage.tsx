'use client'

import { useCallback, useState } from 'react'
import { executors } from '@/lib/exec'
import { sessionFor } from '@/lib/exec/sessions'
import type { Funding, Position, Transfer } from '@/lib/exec/types'
import { errorChain, usd } from '@/lib/format'
import type { Cash } from '@/lib/usePositions'
import type { VenueId } from '@/lib/venues/types'
import { useWallet } from '@/lib/wallet'
import { VENUE_NAMES, VenueMark } from './Quotes'
import { FundingForm, Spinner } from './TradePanel'
import { WalletButton } from './WalletButton'
import { WithdrawPanel } from './WithdrawPanel'

const card = 'rounded-2xl border border-soft-line bg-surface'
const actionBtn = 'min-h-11 rounded-xl border border-strong-line px-4 text-sm font-medium text-ink transition hover:bg-raised'

const when = (ms: number) =>
  ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

// Your money, venue by venue: what's in each account, adding to it, taking it back, and every move so far.
export function WalletPage({ positions, cash, history, historyError, loading, refresh }: {
  positions: Position[] | null
  cash: Cash
  history: Transfer[] | null
  historyError: string | null
  loading: boolean
  refresh: () => void
}) {
  const { address } = useWallet()
  const [panel, setPanel] = useState<{ venue: VenueId; kind: 'add' | 'withdraw' } | null>(null)

  if (!address) {
    return (
      <section aria-label="Wallet not connected" className={`${card} mx-auto flex max-w-md flex-col items-center gap-3 rounded-[20px] px-5 py-7 text-center`}>
        <h2 className="text-[17px] font-semibold">Connect to see your money</h2>
        <p className="max-w-[280px] text-sm leading-normal text-muted">Balances and history come straight from each venue, read with your wallet address.</p>
        <WalletButton big />
      </section>
    )
  }

  const venues = Object.keys(executors) as VenueId[]
  const atVenues = venues.reduce((s, v) => s + (cash[v] ?? 0), 0)
  const inBets = (positions ?? []).filter((p) => p.status === 'live' || p.status === 'claimable').reduce((s, p) => s + p.value, 0)

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <section aria-label="Summary" className="flex flex-wrap items-stretch gap-3 md:gap-4">
        <div className={`${card} flex flex-[2_1_280px] flex-col gap-2 rounded-3xl border-win/35 p-6`}>
          <span className="text-sm text-muted">Ready to bet or withdraw</span>
          <span className="text-[44px] font-semibold leading-none tracking-[-0.03em] text-win">{usd(atVenues)}</span>
          <span className="text-[13px] text-faint">Cash in your venue accounts</span>
        </div>
        <div className={`${card} flex flex-[1_1_200px] flex-col gap-2 rounded-3xl p-6`}>
          <span className="text-sm text-muted">In open bets</span>
          <span className="text-[32px] font-semibold leading-none tracking-[-0.025em]">{usd(inBets)}</span>
          <span className="text-[13px] text-faint">What they’re worth now</span>
        </div>
      </section>

      <section aria-labelledby="venues-h" className="flex flex-col gap-3">
        <h2 id="venues-h" className="text-[17px] font-semibold md:text-[22px] md:tracking-[-0.02em]">Your venue accounts</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {venues.map((venue) => {
            const amount = cash[venue] ?? 0
            const open = panel?.venue === venue ? panel.kind : null
            return (
              <li key={venue} className={`${card} p-4 sm:p-5`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5">
                    <VenueMark venue={venue} />
                    <span className="flex flex-col">
                      <span className="text-[15px] font-medium text-ink">{VENUE_NAMES[venue]}</span>
                      <span className="text-[22px] font-semibold tracking-[-0.02em]">{usd(amount)}</span>
                    </span>
                  </span>
                  {!open && (
                    <span className="flex gap-2">
                      <button onClick={() => setPanel({ venue, kind: 'add' })} className={actionBtn}>Add money</button>
                      {amount >= 0.01 && <button onClick={() => setPanel({ venue, kind: 'withdraw' })} className={actionBtn}>Withdraw</button>}
                    </span>
                  )}
                </div>
                {open === 'withdraw' && <WithdrawPanel venue={venue} available={amount} onClose={() => setPanel(null)} onDone={refresh} />}
                {open === 'add' && <DepositPanel venue={venue} onClose={() => setPanel(null)} onDone={refresh} />}
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="history-h" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="history-h" className="text-[17px] font-semibold md:text-[22px] md:tracking-[-0.02em]">History</h2>
          {loading && <Spinner />}
        </div>
        {historyError && <p className="text-sm text-lose-ink">{historyError}</p>}
        {!history ? (
          <div className="shimmer h-24 rounded-2xl bg-surface" aria-busy />
        ) : history.length === 0 ? (
          <p className={`${card} p-6 text-center text-sm text-muted`}>No deposits or withdrawals yet.</p>
        ) : (
          <ul className={`${card} divide-y divide-chip overflow-hidden`}>
            {history.map((t) => <HistoryRow key={`${t.venue}-${t.id}`} t={t} />)}
          </ul>
        )}
        <p className="text-xs leading-normal text-faint">
          Polymarket withdrawals show here when made from this browser; ones made on polymarket.com appear there.
        </p>
      </section>
    </div>
  )
}

const STATUS = {
  done: { label: 'Completed', className: 'text-ink-2' },
  processing: { label: 'In progress', className: 'text-live-ink' },
  waiting: { label: 'In progress', className: 'text-live-ink' },
  failed: { label: 'Failed', className: 'text-lose' },
} as const

function HistoryRow({ t }: { t: Transfer }) {
  const deposit = t.kind === 'deposit'
  const s = STATUS[t.status]
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${deposit ? 'bg-win/[0.1] text-win' : 'bg-chip text-ink-2'}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {deposit ? <path d="M12 5v14M5 12l7 7 7-7" /> : <path d="M12 19V5M5 12l7-7 7 7" />}
          </svg>
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] text-ink">
            {deposit ? `Added from ${t.chain}` : `Withdrawn to ${t.chain}`}
          </span>
          <span className="text-xs text-faint">{VENUE_NAMES[t.venue]} · {when(t.time)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className={`text-[15px] font-medium ${deposit ? 'text-win' : 'text-ink'}`}>{deposit ? '+' : '−'}{usd(t.amount)}</span>
        <span className={`text-xs ${s.className}`}>{s.label}{t.fee ? ` · fee ${usd(t.fee)}` : ''}</span>
      </span>
    </li>
  )
}

// Adding money outside a bet: open the venue session, then the same deposit form the bet flow uses.
function DepositPanel({ venue, onClose, onDone }: { venue: VenueId; onClose: () => void; onDone: () => void }) {
  const wallet = useWallet()
  const executor = executors[venue]!
  const name = VENUE_NAMES[venue]
  const [funding, setFunding] = useState<Funding | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      const chain = errorChain(e)
      setError(/user (rejected|denied)|rejected the request/i.test(chain.join(' ')) ? 'Your wallet turned it down. Nothing moved.' : chain[chain.length - 1] ?? 'Something went wrong')
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  const open = () =>
    run(`Opening your ${name} account. If your wallet asks for a signature, it doesn’t move money.`, async () => {
      const session = await sessionFor(executor, wallet.address!, () => wallet.clientOn(executor.chainId))
      if (!session.funding) throw new Error(`Adding money to ${name} from here isn’t supported yet`)
      setFunding(session.funding)
    })

  return (
    <div className="mt-3 flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold text-ink">Add money to {name}</span>
        <button onClick={onClose} className="text-muted hover:text-ink">Cancel</button>
      </div>
      {funding ? (
        <FundingForm venueName={name} funding={funding} suggested={20} busy={!!busy} run={run} onArrived={async () => onDone()} />
      ) : (
        <button onClick={open} disabled={!!busy} className="min-h-12 rounded-[14px] bg-ink px-5 text-[15px] font-semibold text-bg disabled:bg-track disabled:text-muted">
          Continue
        </button>
      )}
      {busy && (
        <div className="flex flex-col gap-1 rounded-xl bg-raised px-3.5 py-3">
          <span className="flex items-center gap-2 text-ink"><Spinner />Check your wallet</span>
          <span className="text-[13px] leading-normal text-muted">{busy}</span>
        </div>
      )}
      {error && <p role="alert" className="rounded-xl border border-lose/40 bg-lose/[0.06] px-3.5 py-3 text-ink-2">{error}</p>}
    </div>
  )
}
