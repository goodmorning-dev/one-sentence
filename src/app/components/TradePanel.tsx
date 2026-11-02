'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { executors } from '@/lib/exec'
import { sessionFor } from '@/lib/exec/sessions'
import type { Funding, FundingSource, FundingState, SetupStep, TradeResult, VenueAccount, VenueSession } from '@/lib/exec/types'
import { errorChain, usd } from '@/lib/format'
import type { Quote } from '@/lib/venues/types'
import { useWallet } from '@/lib/wallet'

type Run = (label: string, fn: () => Promise<void>) => Promise<boolean>

function message(e: unknown) {
  const chain = errorChain(e)
  const m = chain.join(' ')
  if (/user (rejected|denied)|rejected the request|denied transaction/i.test(m)) return 'Your wallet turned it down, so nothing moved.'
  if (/failed to fetch|network|ERR_CERT/i.test(m)) return 'We couldn’t reach the venue. It may be blocked on this network. Nothing was placed.'
  // The innermost error is the real one; the outer ones only say which step failed.
  return chain.length > 1 ? `${chain[chain.length - 1]} (${chain[0]})` : chain[0] ?? 'Something went wrong'
}

const primaryBtn =
  'min-h-[52px] rounded-[14px] bg-win px-6 text-base font-semibold text-bg transition hover:bg-win-hover disabled:cursor-default disabled:bg-track disabled:text-muted'
const secondaryBtn = 'min-h-12 rounded-[14px] border border-strong-line px-5 text-[15px] font-medium text-ink transition hover:bg-raised disabled:opacity-50'
const quietBtn = 'min-h-[52px] rounded-[14px] border border-line px-4 text-[15px] text-ink-2 transition hover:text-ink'

const STEP_LABEL: Record<string, { todo: string; done: string }> = {
  wallet: { todo: 'Create account', done: 'Account created' },
  approvals: { todo: 'Allow trading', done: 'Trading allowed' },
  agent: { todo: 'Allow betting from here', done: 'Betting allowed' },
  builder: { todo: 'Approve our fee', done: 'Fee approved' },
  funds: { todo: 'Add money', done: 'Money added' },
}

// The bet flow inside a quote card: connect, open the venue account, one-time setup, add money, confirm.
// Each wallet request gets a plain explanation of what it does and whether it moves money.
export function TradePanel({ quote, venueName, primary, open, onOpen, onClose, onTraded }: {
  quote: Quote
  venueName: string
  primary: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  onTraded: () => void
}) {
  const wallet = useWallet()
  const executor = executors[quote.venue]
  const session = useRef<VenueSession | null>(null)
  const [account, setAccount] = useState<VenueAccount | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TradeResult | null>(null)

  const run: Run = useCallback(async (label, fn) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError(message(e))
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  // A different wallet means a different venue account.
  useEffect(() => {
    session.current = null
    setAccount(null)
    setResult(null)
  }, [wallet.address])

  // The venue sizes some steps to the bet (e.g. how much to move), so it always sees the latest quote.
  const latest = useRef(quote)
  latest.current = quote
  const refreshAccount = useCallback(async () => setAccount(await session.current!.account(latest.current)), [])

  if (!executor) return null
  const stake = usd(quote.cost, quote.cost % 1 ? 2 : 0)

  const openSession = () =>
    run(`Opening your ${venueName} account. If your wallet asks for a signature, it doesn’t move money.`, async () => {
      session.current = await sessionFor(executor, wallet.address!, () => wallet.clientOn(executor.chainId))
      await refreshAccount()
    })

  const start = async () => {
    onOpen()
    setResult(null)
    if (!session.current) await openSession()
  }

  if (!open) {
    return (
      <>
        {!wallet.address ? (
          <button onClick={() => run('', wallet.connect)} disabled={!wallet.available} className={primary ? `${primaryBtn} w-full` : `${secondaryBtn} flex-1`}>
            {wallet.available ? 'Connect wallet to bet' : 'Install a browser wallet to bet'}
          </button>
        ) : (
          <button onClick={start} className={primary ? `${primaryBtn} w-full` : `${secondaryBtn} flex-1 whitespace-nowrap`}>
            {/* A side card already names the venue in its header, so the short label fits beside Details. */}
            Bet {stake}{primary ? ` on ${venueName}` : ''}
          </button>
        )}
        {primary && (
          <p className="-mt-1.5 text-center text-xs leading-normal text-faint">
            Your money goes to {venueName}, not to us. Your wallet signs everything.
          </p>
        )}
        {error && <p className="text-sm text-lose-ink">{error}</p>}
      </>
    )
  }

  // Placed: the end of the flow.
  if (result?.ok) {
    return (
      <div className="flex flex-col gap-4 border-t border-soft-line pt-5" role="status">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-win text-bg" aria-hidden><Check size={15} /></span>
          <h3 className="text-lg font-semibold">You&rsquo;re in</h3>
        </div>
        <p className="text-sm leading-normal text-ink-2">
          {result.message}. If you&rsquo;re right you get <span className="font-semibold text-win">{usd(quote.payoutIfRight)}</span> when it&rsquo;s decided.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="#bets" className={`${primaryBtn} flex flex-1 items-center justify-center no-underline`}>See it in My bets</a>
          <button onClick={onClose} className={quietBtn}>Done</button>
        </div>
      </div>
    )
  }

  const steps = account?.steps ?? [{ id: 'wallet', label: '', done: false, runnable: false }]
  const current = steps.find((s) => !s.done)
  const enough = account?.balance != null && account.balance >= quote.cost
  const ready = !!account && !current && enough
  const fundingNeeded = !!account && (current?.id === 'funds' || (!current && !enough))

  const runStep = (step: SetupStep) =>
    run(step.prompt ?? `It’s asking you to let ${venueName} place bets for this account. This doesn’t move money.`, async () => {
      await session.current!.runStep(step.id, quote)
      await refreshAccount()
    })

  const trade = () =>
    run(`Confirm the ${stake} bet in your wallet.`, async () => {
      const r = await session.current!.trade(quote)
      if (!r.ok) throw new Error(r.message)
      setResult(r)
      await refreshAccount()
      onTraded()
    })

  return (
    <div className="flex flex-col gap-5 sm:gap-6 sm:border-t sm:border-soft-line sm:pt-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:gap-8">
        <div className="flex flex-col gap-1 sm:flex-[1_1_260px] sm:gap-1.5">
          <h3 className="text-lg font-semibold tracking-[-0.01em]">{ready ? 'Ready to place your bet' : `Set up your ${venueName} account`}</h3>
          <p className="text-sm leading-normal text-muted">
            {ready
              ? `${stake} goes from your ${venueName} account. If you’re right you get ${usd(quote.payoutIfRight)}.`
              : `One time only. Each step asks your wallet to approve. Your ${stake} goes to ${venueName}, not to us.`}
          </p>
        </div>

        <ol aria-label="Setup steps" className="flex flex-col sm:flex-[1_1_320px]">
          {steps.map((s, i) => (
            <Step
              key={s.id}
              step={s}
              n={i + 1}
              last={i === steps.length - 1}
              current={s === current}
              busy={s === current ? busy : null}
              hint={s.id === 'funds' && !s.done ? `Next · move ${stake} to your ${venueName} account` : undefined}
            />
          ))}
        </ol>
      </div>

      {fundingNeeded && session.current?.funding && (
        <FundingForm
          venueName={venueName}
          funding={session.current.funding}
          suggested={Math.max(quote.cost - (account?.balance ?? 0), 0)}
          busy={!!busy}
          run={run}
          onArrived={refreshAccount}
        />
      )}

      {error && (
        <div role="alert" className="flex flex-col gap-1 rounded-xl border border-lose/40 bg-lose/[0.06] p-3.5">
          <span className="text-[15px] font-medium text-lose-ink">That didn&rsquo;t go through</span>
          <span className="text-sm leading-normal text-ink-2">{error}</span>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <div className="order-2 flex flex-1 sm:order-none sm:flex-none">
          <button onClick={onClose} className={`${quietBtn} w-full`}>Cancel</button>
        </div>
        {busy ? (
          <button disabled className={`${primaryBtn} flex-[2_1_auto] sm:flex-none`}>Waiting for your wallet…</button>
        ) : !account ? (
          <button onClick={openSession} className={`${primaryBtn} flex-[2_1_auto] sm:flex-none`}>{error ? 'Try again' : 'Open account'}</button>
        ) : current?.runnable ? (
          <button onClick={() => runStep(current)} className={`${primaryBtn} flex-[2_1_auto] sm:flex-none`}>{STEP_LABEL[current.id]?.todo ?? current.label}</button>
        ) : ready ? (
          <button onClick={trade} className={`${primaryBtn} flex-[2_1_auto] sm:flex-none`}>Confirm bet · {stake}</button>
        ) : null}
      </div>
    </div>
  )
}

function Step({ step, n, last, current, busy, hint }: { step: SetupStep; n: number; last: boolean; current: boolean; busy: string | null; hint?: string }) {
  const label = STEP_LABEL[step.id] ?? { todo: step.label, done: step.label }
  return (
    <li aria-current={current ? 'step' : undefined} className={`flex gap-3.5 ${last ? '' : 'pb-4'}`}>
      <div className="flex flex-col items-center gap-1">
        {step.done ? (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-win text-bg" aria-hidden><Check size={14} /></span>
        ) : current ? (
          <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-win" aria-hidden>
            {busy ? <Spinner /> : <span className="h-2 w-2 rounded-full bg-win" />}
          </span>
        ) : (
          <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-strong-line text-xs text-faint" aria-hidden>{n}</span>
        )}
        {!last && <span className={`min-h-5 w-0.5 flex-1 ${step.done ? 'bg-win' : 'bg-track'}`} />}
      </div>
      <div className="flex flex-1 flex-col gap-2 pt-[3px]" aria-busy={!!busy}>
        <span className={`text-[15px] font-medium ${step.done || current ? 'text-ink' : 'text-ink-2'}`}>{step.done ? label.done : label.todo}</span>
        {busy ? (
          <div className="flex flex-col gap-1 rounded-xl bg-raised px-3.5 py-3">
            <span className="text-sm text-ink">Check your wallet</span>
            <span className="text-[13px] leading-normal text-muted">{busy}</span>
          </div>
        ) : (
          <span className="-mt-1.5 text-[13px] text-faint">{step.done ? 'Done · approved in your wallet' : hint}</span>
        )}
      </div>
    </li>
  )
}

function Check({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
}

export function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-win/25 border-t-win" aria-hidden />
}

const PROGRESS: Record<FundingState, number> = { waiting: 20, processing: 60, done: 100, failed: 100 }

// Deposit from the user's own wallet on any supported chain. The venue converts it and credits their account.
function FundingForm({ venueName, funding, suggested, busy, run, onArrived }: {
  venueName: string
  funding: Funding
  suggested: number
  busy: boolean
  run: Run
  onArrived: () => Promise<void>
}) {
  const wallet = useWallet()
  const [sources, setSources] = useState<FundingSource[] | null>(null)
  const [pick, setPick] = useState(0)
  const [amount, setAmount] = useState(Math.max(Math.ceil(suggested), 1))
  const [tracking, setTracking] = useState<{ id: string; from: string; amount: number } | null>(null)
  const [state, setState] = useState<FundingState | null>(null)

  useEffect(() => {
    funding.sources().then(setSources, () => setSources([]))
  }, [funding])

  // Poll the bridge every 15s until the transfer finishes, then refresh the venue balance.
  useEffect(() => {
    if (!tracking) return
    const t = setInterval(async () => {
      const s = await funding.status(tracking.id).catch(() => null)
      if (!s) return
      setState(s)
      if (s === 'done') await onArrived()
      if (s === 'done' || s === 'failed') clearInterval(t)
    }, 15000)
    return () => clearInterval(t)
  }, [tracking, funding, onArrived])

  const funded = sources?.filter((s) => s.balance > 0) ?? []
  const source = funded[pick]
  const box = 'flex flex-col gap-4 rounded-2xl border border-soft-line bg-bg/40 p-4 sm:p-5'

  if (tracking) {
    const s = state ?? 'waiting'
    if (s === 'failed') {
      return (
        <div role="alert" className={`${box} border-lose/45`}>
          <h4 className="text-lg font-semibold text-lose-ink">The transfer didn&rsquo;t go through</h4>
          <p className="text-sm leading-normal text-ink-2">The bridge reported a problem. Your money is safe; contact the venue&rsquo;s bridge support with your wallet address and it will be returned or credited.</p>
          <button onClick={() => { setTracking(null); setState(null) }} className="min-h-12 rounded-[14px] bg-ink px-5 text-[15px] font-semibold text-bg">Try again</button>
        </div>
      )
    }
    return (
      <div className={box} aria-busy={s !== 'done'}>
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-lg font-semibold">{s === 'done' ? `${usd(tracking.amount)} arrived` : `${usd(tracking.amount)} on its way`}</h4>
          <span className="text-[13px] text-muted">{s === 'done' ? 'Ready' : 'a few minutes'}</span>
        </div>
        <div role="progressbar" aria-valuenow={PROGRESS[s]} aria-valuemin={0} aria-valuemax={100} aria-label="Transfer progress" className="h-1.5 overflow-hidden rounded-full bg-track">
          <div className={`h-1.5 rounded-full transition-[width] duration-700 ${s === 'done' ? 'bg-win' : 'bg-live'}`} style={{ width: `${PROGRESS[s]}%` }} />
        </div>
        <div className="flex justify-between text-[13px] text-muted">
          <span className="text-ink-2">{s === 'waiting' ? `Leaving ${tracking.from}` : `Left ${tracking.from} ✓`}</span>
          <span>{s === 'done' ? `In your ${venueName} account ✓` : `Arriving at ${venueName}`}</span>
        </div>
        {s !== 'done' && <p className="text-[13px] leading-normal text-muted">You can close this page. The money keeps moving and lands in your {venueName} account either way.</p>}
      </div>
    )
  }

  if (!sources) {
    return <div className={`${box} shimmer`}><span className="text-sm text-muted">Checking your wallet balances…</span></div>
  }
  if (!source) {
    return (
      <div className={box}>
        <h4 className="text-lg font-semibold">Add money to {venueName}</h4>
        <p className="text-sm leading-normal text-muted">This wallet has no USDC on Polygon, Arbitrum, Base, Optimism or Ethereum. Add some, then come back.</p>
      </div>
    )
  }

  const deposit = () =>
    run(`Approve sending ${usd(amount)} from ${source.chainName}. It goes to your own ${venueName} account.`, async () => {
      const client = await wallet.clientOn(source.chainId)
      const id = await funding.deposit(source, amount, client)
      setTracking({ id, from: source.chainName, amount })
      setState('waiting')
    })

  const tooLow = amount < source.min
  const tooHigh = amount > source.balance

  return (
    <div className={box}>
      <h4 className="text-lg font-semibold">Add money to {venueName}</h4>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="deposit-amount" className="text-[13px] text-muted">Amount</label>
        <div className="flex min-h-[52px] items-center gap-1 rounded-xl border border-strong-line bg-bg px-3.5 focus-within:border-win/60">
          <span className="text-xl text-faint">$</span>
          <input
            id="deposit-amount"
            inputMode="decimal"
            value={amount || ''}
            onChange={(e) => setAmount(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
            className="min-w-0 flex-1 bg-transparent text-xl font-medium text-ink outline-none"
          />
          <span className="text-[13px] text-faint">You have {usd(source.balance)}</span>
        </div>
        {(tooLow || tooHigh) && (
          <span className="text-[13px] text-lose-ink">{tooLow ? `The minimum from ${source.chainName} is ${usd(source.min)}` : 'That’s more than this wallet has there'}</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="source-label" className="text-[13px] text-muted">Send from</span>
        <div role="radiogroup" aria-labelledby="source-label" className="grid grid-cols-2 gap-2">
          {funded.map((s, i) => (
            <button
              key={`${s.chainId}-${s.token}`}
              role="radio"
              aria-checked={i === pick}
              onClick={() => setPick(i)}
              className={`flex min-h-[52px] flex-col gap-0.5 rounded-xl border px-3 py-2 text-left text-sm ${
                i === pick ? 'border-win bg-win/[0.07]' : 'border-line hover:border-strong-line'
              }`}
            >
              <span className="font-medium text-ink">{s.chainName}{s.symbol !== 'USDC' ? ` · ${s.symbol}` : ''}</span>
              <span className="text-xs text-muted">{usd(s.balance)} · {s.eta ?? '~3 min'}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="flex gap-2 text-[13px] leading-normal text-muted">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="mt-0.5 flex-none"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
        The money goes straight from your wallet to your {venueName} account. We never hold it.
      </p>

      <button onClick={deposit} disabled={busy || tooLow || tooHigh} className={primaryBtn}>
        Add {usd(amount)} from {source.chainName}
      </button>
    </div>
  )
}
