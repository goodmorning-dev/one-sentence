'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { executors } from '@/lib/exec'
import { sessionFor } from '@/lib/exec/sessions'
import type { Funding, FundingSource, FundingState, SetupStep, TradeResult, VenueAccount, VenueSession } from '@/lib/exec/types'
import { errorChain, usd } from '@/lib/format'
import type { Quote } from '@/lib/venues/types'
import { useWallet } from '@/lib/wallet'
import { AmountInput } from './AmountInput'

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
const quietBtn = 'min-h-[52px] rounded-[14px] border border-line px-4 text-[15px] text-ink-2 transition hover:text-ink'

const STEP_LABEL: Record<string, { todo: string; done: string }> = {
  wallet: { todo: 'Create account', done: 'Account created' },
  approvals: { todo: 'Allow trading', done: 'Trading allowed' },
  agent: { todo: 'Allow betting from here', done: 'Betting allowed' },
  builder: { todo: 'Approve our fee', done: 'Fee approved' },
  funds: { todo: 'Add money', done: 'Money added' },
}

// The bet flow on its own screen: connect, open the venue account, one-time setup, add money, confirm.
// Each wallet request gets a plain explanation of what it does and whether it moves money.
export function TradePanel({ quote, venueName, onClose, onTraded }: {
  quote: Quote
  venueName: string
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

  // The venue sizes some steps to the bet (e.g. how much to move), so it always sees the latest quote.
  const latest = useRef(quote)
  latest.current = quote
  const refreshAccount = useCallback(async () => setAccount(await session.current!.account(latest.current)), [])

  const openSession = useCallback(
    () =>
      run(`It’s asking you to open your ${venueName} account. Signing this doesn’t move any money.`, async () => {
        session.current = await sessionFor(executor!, wallet.address!, () => wallet.clientOn(executor!.chainId))
        await refreshAccount()
      }),
    [run, executor, wallet, venueName, refreshAccount],
  )

  // Opening the screen is the click on "Bet": open the account straight away. A different wallet means a
  // different venue account, so start over when it changes.
  useEffect(() => {
    session.current = null
    setAccount(null)
    setResult(null)
    if (wallet.address && executor) openSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address])

  if (!executor) return null
  const stake = usd(quote.cost, quote.cost % 1 ? 2 : 0)
  const frame = 'flex flex-col gap-6 rounded-3xl border border-win/40 bg-surface p-5 sm:p-7'

  if (!wallet.address) {
    return (
      <article aria-label="Connect" className={frame}>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold">Connect your wallet</h1>
          <p className="text-sm leading-normal text-muted">Your wallet holds the money and approves each step. We never see your keys.</p>
        </div>
        {error && <p role="alert" className="text-sm text-lose-ink">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <button onClick={onClose} className={quietBtn}>Cancel</button>
          <button onClick={() => run('', wallet.connect)} disabled={!wallet.available} className={primaryBtn}>
            {wallet.available ? 'Connect wallet' : 'No wallet found'}
          </button>
        </div>
      </article>
    )
  }

  // Placed: the end of the flow.
  if (result?.ok) {
    return (
      <article aria-label="Bet placed" role="status" className={frame}>
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-win text-bg" aria-hidden><Check size={16} /></span>
          <h1 className="text-xl font-semibold">You&rsquo;re in</h1>
        </div>
        <p className="text-[15px] leading-normal text-ink-2">
          {result.message}. If you&rsquo;re right you get <span className="font-semibold text-win">{usd(result.filled?.payout ?? quote.payoutIfRight)}</span> when it&rsquo;s decided.
        </p>
        {result.filled && result.filled.spent < quote.cost - 0.01 && (
          <p className="text-sm leading-normal text-muted">
            Only {usd(result.filled.spent)} of your {usd(quote.cost)} could be placed at this price. The rest stays in your {venueName} account.
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <button onClick={onClose} className={quietBtn}>Done</button>
          <a href="#bets" className={`${primaryBtn} flex items-center justify-center no-underline`}>See it in My bets</a>
        </div>
      </article>
    )
  }

  const steps = account?.steps ?? [{ id: 'wallet', label: '', done: false, runnable: false }]
  const current = steps.find((s) => !s.done)
  // Derive's order book buys the lower call before selling the upper one, so the account needs its full price briefly.
  const upfront = quote.ticket?.venue === 'derive' ? quote.ticket.upfront || 0 : 0
  const need = Math.max(quote.cost, upfront)
  const enough = account?.balance != null && account.balance >= need
  const ready = !!account && !current && enough
  const fundingNeeded = !!account && (current?.id === 'funds' || (!current && !enough))
  const at = current ? steps.indexOf(current) : steps.length

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
      onTraded()
      await refreshAccount().catch(() => {})
    })

  const hint = !current ? null : current.id === 'funds' ? `Move ${stake} to your ${venueName} account below.` : current.detail

  return (
    <article aria-label="Setup" className={frame}>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold">{ready ? 'Ready to place your bet' : `Set up your ${venueName} account`}</h1>
        <p className="text-sm leading-normal text-muted">
          {ready
            ? `${stake} goes from your ${venueName} account. If you’re right you get ${usd(quote.payoutIfRight)}.`
            : `One time only. Your wallet approves each step. Your ${stake} goes to ${venueName}, not to us.`}
        </p>
      </div>

      {!ready && (
        <ol aria-label={`Step ${Math.min(at + 1, steps.length)} of ${steps.length}`} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => {
            const label = STEP_LABEL[s.id] ?? { todo: s.label, done: s.label }
            const now = s === current
            return (
              <li key={s.id} aria-current={now ? 'step' : undefined} className="flex min-w-0 flex-col gap-2.5">
                <span className={`h-1 rounded-full ${s.done || now ? 'bg-win' : 'bg-track'}`} />
                <span className={`items-center gap-2 text-[13px] sm:flex sm:text-sm ${now ? 'flex font-medium text-ink' : 'hidden text-muted'}`}>
                  {now && busy ? <Spinner /> : s.done ? <span className="text-win"><Check size={13} /></span> : null}
                  <span className="truncate sm:whitespace-normal">{s.done ? label.done : `${i + 1} · ${label.todo}`}</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}

      {busy ? (
        <div aria-busy className="flex items-start gap-3.5 rounded-2xl bg-raised px-5 py-[18px]">
          <WalletIcon />
          <div className="flex flex-col gap-1">
            <span className="text-[15px] font-medium">Check your wallet</span>
            <span className="text-sm leading-normal text-muted">{busy}</span>
          </div>
        </div>
      ) : hint && !fundingNeeded ? (
        <p className="-mt-2 text-sm leading-normal text-muted">{hint}</p>
      ) : null}

      {fundingNeeded && upfront > quote.cost && !current && (
        <p className="-mt-2 text-sm leading-normal text-muted">
          This bet needs {usd(upfront)} in your {venueName} account for a moment: it buys the lower call first, then sells the upper one and the
          difference comes straight back. You have {usd(account?.balance ?? 0)}.
        </p>
      )}

      {fundingNeeded && session.current?.funding && (
        <FundingForm
          venueName={venueName}
          funding={session.current.funding}
          suggested={Math.max(need - (account?.balance ?? 0), 0)}
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

      <div className="flex items-center justify-between gap-3">
        <button onClick={onClose} className={quietBtn}>Cancel</button>
        {busy ? (
          <button disabled className={primaryBtn}>Waiting for your wallet…</button>
        ) : !account ? (
          <button onClick={openSession} className={primaryBtn}>{error ? 'Try again' : 'Open account'}</button>
        ) : current?.runnable ? (
          <button onClick={() => runStep(current)} className={primaryBtn}>{STEP_LABEL[current.id]?.todo ?? current.label}</button>
        ) : ready ? (
          <button onClick={trade} className={primaryBtn}>Confirm bet · {stake}</button>
        ) : null}
      </div>
    </article>
  )
}

function WalletIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-px flex-none text-win">
      <rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 9h15a3 3 0 0 0-3-3" />
    </svg>
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
export function FundingForm({ venueName, funding, suggested, busy, run, onArrived, bare = false }: {
  bare?: boolean // inside a dialog that already frames and titles it
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
  const [amount, setAmount] = useState(Number.isFinite(suggested) ? Math.max(Math.ceil(suggested), 1) : 1)
  const [tracking, setTracking] = useState<{ id: string; from: string; amount: number } | null>(null)
  const [state, setState] = useState<FundingState | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

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
      if (s === 'done' || s === 'failed') clearInterval(t)
      if (s === 'done') await onArrived().catch(() => {})
    }, 15000)
    return () => clearInterval(t)
  }, [tracking, funding, onArrived])

  const funded = sources?.filter((s) => s.balance > 0) ?? []
  const source = funded[pick]
  const box = bare ? 'flex flex-col gap-4' : 'flex flex-col gap-4 rounded-2xl border border-soft-line bg-bg/40 p-4 sm:p-5'

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
        {!bare && <h4 className="text-lg font-semibold">Add money to {venueName}</h4>}
        <p className="text-sm leading-normal text-muted">
          This wallet has no USDC on {[...new Set(sources.map((s) => s.chainName))].join(', ').replace(/, ([^,]*)$/, ' or $1')}.
          Add some there, then come back.
        </p>
      </div>
    )
  }

  const deposit = () =>
    run(
      source.via
        ? `${source.via}, then into your own ${venueName} account. Your wallet asks three times; keep this page open.`
        : `Approve sending ${usd(amount)} from ${source.chainName}. It goes to your own ${venueName} account.`,
      async () => {
        try {
          const client = await wallet.clientOn(source.chainId)
          const id = await funding.deposit(source, amount, client, setProgress)
          setTracking({ id, from: source.chainName, amount })
          setState('waiting')
        } finally {
          setProgress(null)
        }
      },
    )

  const tooLow = amount < source.min
  const tooHigh = amount > source.balance

  return (
    <div className={box}>
      {!bare && <h4 className="text-lg font-semibold">Add money to {venueName}</h4>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="deposit-amount" className="text-[13px] text-muted">Amount</label>
        <AmountInput id="deposit-amount" value={amount} onChange={setAmount} after={<span className="text-[13px] text-faint">You have {usd(source.balance)}</span>} />
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
              {s.via && <span className="text-xs text-faint">{s.via}</span>}
            </button>
          ))}
        </div>
      </div>

      <p className="flex gap-2 text-[13px] leading-normal text-muted">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="mt-0.5 flex-none"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
        The money goes straight from your wallet to your {venueName} account. We never hold it.
      </p>

      {source.via && !progress && (
        <p className="text-[13px] leading-normal text-muted">
          {source.note ?? `${venueName} only takes USDC from Arbitrum, so we move it there first through Relay (a few cents, seconds), then add it. You confirm three times in your wallet.`}
        </p>
      )}

      <button onClick={deposit} disabled={busy || tooLow || tooHigh} className={primaryBtn}>
        Add {usd(amount)} from {source.chainName}
      </button>
      {progress && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-raised px-3.5 py-3 text-sm text-ink"><Spinner />{progress}</p>
      )}
    </div>
  )
}
