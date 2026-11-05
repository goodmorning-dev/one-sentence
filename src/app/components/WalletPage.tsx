'use client'

import { useCallback, useEffect, useState } from 'react'
import { executors } from '@/lib/exec'
import { walletUsdc } from '@/lib/exec/balances'
import { sessionFor } from '@/lib/exec/sessions'
import type { Funding, Position, Transfer } from '@/lib/exec/types'
import { errorChain, short, usd } from '@/lib/format'
import type { Cash } from '@/lib/usePositions'
import type { VenueId } from '@/lib/venues/types'
import { useWallet } from '@/lib/wallet'
import { VENUE_NAMES, VenueMark } from './Quotes'
import { Dialog } from './Dialog'
import { FundingForm, Spinner } from './TradePanel'
import { WalletButton } from './WalletButton'
import { WithdrawPanel } from './WithdrawPanel'

const card = 'rounded-2xl border border-soft-line bg-surface'
const actionBtn = 'min-h-11 rounded-xl border border-strong-line px-4 text-sm font-medium text-ink transition hover:bg-raised'

const when = (ms: number) =>
  ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

// Your money in two places: USDC in your own wallet, chain by chain, and cash inside each venue account, with
// adding to and taking back from each venue. Every move so far underneath.
export function WalletPage({ positions, cash, history, historyError, loading, refresh }: {
  positions: Position[] | null
  cash: Cash
  history: Transfer[] | null
  historyError: string | null
  loading: boolean
  refresh: () => void
}) {
  const wallet = useWallet()
  const { address } = wallet
  const [panel, setPanel] = useState<{ venue: VenueId; kind: 'add' | 'withdraw' } | null>(null)
  const [chains, setChains] = useState<Awaited<ReturnType<typeof walletUsdc>> | null>(null)
  const [copied, setCopied] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const readChains = useCallback(() => {
    if (address) walletUsdc(address).then(setChains, () => setChains([]))
  }, [address])
  useEffect(() => {
    setChains(null)
    readChains()
  }, [readChains])
  // Money moving in or out changes both sides.
  const refreshAll = useCallback(() => {
    refresh()
    readChains()
  }, [refresh, readChains])

  if (!address) {
    return (
      <section aria-label={wallet.available ? 'Wallet not connected' : 'No wallet found'} className={`${card} mx-auto flex max-w-md flex-col items-center gap-3 rounded-[20px] px-5 py-7 text-center`}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-win">
          <rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 9h15a3 3 0 0 0-3-3" />
        </svg>
        {wallet.available ? (
          <>
            <h2 className="text-lg font-semibold">Connect to see your money</h2>
            <p className="max-w-[300px] text-sm leading-normal text-muted">Balances and history come straight from each venue, read with your wallet address.</p>
            <WalletButton big />
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">You&rsquo;ll need a crypto wallet</h2>
            <p className="max-w-[300px] text-sm leading-normal text-muted">It&rsquo;s an app that holds your money and approves each bet. We don&rsquo;t see your keys.</p>
            <a href="https://ethereum.org/en/wallets/find-wallet/" target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center self-stretch rounded-[14px] bg-win text-[15px] font-semibold text-bg no-underline hover:bg-win-hover">
              Get a wallet
            </a>
            <button
              onClick={() => wallet.connect().then(() => setConnectError(null), (e: Error) => setConnectError(e.message))}
              className="min-h-12 self-stretch rounded-[14px] border border-strong-line text-[15px] text-ink hover:bg-raised"
            >
              I have one, connect it
            </button>
            {connectError && <span className="text-xs text-lose-ink">{connectError}</span>}
            <span className="text-[13px] text-faint">You can browse prices without one.</span>
          </>
        )}
      </section>
    )
  }

  const venues = Object.keys(executors) as VenueId[]
  const atVenues = venues.reduce((s, v) => s + (cash[v] ?? 0), 0)
  const inWallet = (chains ?? []).reduce((s, c) => s + c.balance, 0)
  const inBets = (positions ?? []).filter((p) => p.status === 'live' || p.status === 'claimable').reduce((s, p) => s + p.value, 0)

  const copy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }, () => {})
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Summary" className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted">Ready to bet</span>
          <span className={`text-[40px] font-semibold leading-none tracking-[-0.035em] sm:text-[56px] ${chains ? '' : 'shimmer'}`}>{usd(inWallet + atVenues)}</span>
          <span className="text-[13px] text-faint">
            {usd(inWallet)} in your wallet · {usd(atVenues)} in venue accounts{inBets > 0 ? ` · ${usd(inBets)} more in open bets` : ''}
          </span>
          <span className="flex items-center gap-2 font-mono text-[13px] text-faint">
            {short(address)}
            <button onClick={copy} aria-label="Copy address" className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:text-ink">
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-win"><path d="m5 12 5 5 9-10" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
              )}
            </button>
          </span>
        </div>
        <button onClick={wallet.disconnect} className="hidden min-h-11 rounded-xl border border-line px-[18px] text-sm text-ink-2 hover:text-ink sm:block">Disconnect</button>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-labelledby="chains-h" className={`${card} flex flex-[1_1_340px] flex-col rounded-3xl p-5 sm:p-6`}>
          <h2 id="chains-h" className="mb-2 text-[17px] font-semibold">In your wallet</h2>
          {!chains ? (
            <div className="shimmer h-40 rounded-xl bg-raised" aria-busy />
          ) : (
            chains.map((c) => (
              <div key={c.chainId} className="flex min-h-14 items-center justify-between border-b border-chip last:border-b-0">
                <span className="flex flex-col gap-0.5">
                  <span className={`text-[15px] ${c.balance > 0 ? 'text-ink' : 'text-muted'}`}>{c.chainName}</span>
                  <span className="text-xs text-faint">USDC</span>
                </span>
                <span className={`text-[17px] ${c.balance > 0 ? 'font-medium text-ink' : 'text-faint'}`}>{usd(c.balance)}</span>
              </div>
            ))
          )}
          <p className="mt-2 text-[13px] leading-normal text-faint">Money you can move into a venue when you bet. It stays in your wallet until then.</p>
        </section>

        <section aria-labelledby="venues-h" className={`${card} flex flex-[1.4_1_440px] flex-col rounded-3xl p-5 sm:p-6`}>
          <h2 id="venues-h" className="mb-2 text-[17px] font-semibold">Your venue accounts</h2>
          {venues.map((venue) => {
            const amount = cash[venue] ?? 0
            return (
              <div key={venue} className="border-b border-chip py-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <VenueMark venue={venue} />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15px]">{VENUE_NAMES[venue]}</span>
                      <span className={`text-xs ${amount > 0 ? 'text-win' : 'text-faint'}`}>{usd(amount)} inside</span>
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button onClick={() => setPanel({ venue, kind: 'add' })} className={actionBtn}>Add money</button>
                    {amount >= 0.01 && <button onClick={() => setPanel({ venue, kind: 'withdraw' })} className={actionBtn}>Move back</button>}
                  </span>
                </div>
              </div>
            )
          })}
          <p className="mt-2 text-[13px] leading-normal text-faint">Each venue keeps its own account in your name. We can see balances, never move them without your wallet.</p>
        </section>
      </div>

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

      <button onClick={wallet.disconnect} className="min-h-12 rounded-[14px] border border-line text-[15px] text-ink-2 sm:hidden">Disconnect wallet</button>

      {panel && (
        <Dialog title={`${panel.kind === 'add' ? 'Add money to' : 'Move back from'} ${VENUE_NAMES[panel.venue]}`} onClose={() => setPanel(null)}>
          {panel.kind === 'add' ? (
            <DepositPanel venue={panel.venue} onDone={refreshAll} />
          ) : (
            <WithdrawPanel venue={panel.venue} available={cash[panel.venue] ?? 0} onDone={refreshAll} />
          )}
        </Dialog>
      )}
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
function DepositPanel({ venue, onDone }: { venue: VenueId; onDone: () => void }) {
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
    <div className="flex flex-col gap-3 text-sm">
      {funding ? (
        <FundingForm bare venueName={name} funding={funding} suggested={20} busy={!!busy} run={run} onArrived={async () => onDone()} />
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
