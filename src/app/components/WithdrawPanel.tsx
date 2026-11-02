'use client'

import { useEffect, useState } from 'react'
import { executors } from '@/lib/exec'
import { sessionFor } from '@/lib/exec/sessions'
import type { FundingState, Withdrawal, WithdrawTarget } from '@/lib/exec/types'
import { errorChain, usd } from '@/lib/format'
import type { VenueId } from '@/lib/venues/types'
import { useWallet } from '@/lib/wallet'
import { VENUE_NAMES } from './Quotes'
import { Spinner } from './TradePanel'

function message(e: unknown) {
  const chain = errorChain(e)
  const m = chain.join(' ')
  if (/user (rejected|denied)|rejected the request|denied transaction/i.test(m)) return 'Your wallet turned it down. Nothing was moved.'
  if (/failed to fetch|network|ERR_CERT/i.test(m)) return 'We couldn’t reach the venue. It may be blocked on this network. Nothing was moved.'
  return chain.length > 1 ? `${chain[chain.length - 1]} (${chain[0]})` : chain[0] ?? 'Something went wrong'
}

const field = 'rounded-xl border border-strong-line bg-bg px-3.5 text-ink outline-none focus-within:border-win/60'

// Sends cash from a venue account back to the user's own wallet. Opening the venue session may ask for a
// signature (Polymarket's sign-in); the withdrawal itself is one more (two on Hyperliquid's standard accounts).
export function WithdrawPanel({ venue, available, onClose, onDone }: { venue: VenueId; available: number; onClose: () => void; onDone: () => void }) {
  const wallet = useWallet()
  const executor = executors[venue]!
  const name = VENUE_NAMES[venue]
  const [w, setW] = useState<Withdrawal | null>(null)
  const [target, setTarget] = useState<WithdrawTarget | null>(null)
  const [amount, setAmount] = useState(Math.floor(available * 100) / 100)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tracking, setTracking] = useState<{ id: string; amount: number; to: WithdrawTarget } | null>(null)
  const [state, setState] = useState<FundingState>('waiting')

  // Poll every 10s until it lands, then let My bets re-read the balances.
  useEffect(() => {
    if (!tracking || !w) return
    const t = setInterval(async () => {
      const s = await w.status(tracking.id).catch(() => null)
      if (!s) return
      setState(s)
      if (s === 'done' || s === 'failed') {
        clearInterval(t)
        if (s === 'done') onDone()
      }
    }, 10000)
    return () => clearInterval(t)
  }, [tracking, w, onDone])

  const open = async () => {
    if (!wallet.address) return wallet.connect().catch((e) => setError(message(e)))
    setBusy(`Opening your ${name} account. If your wallet asks for a signature, it doesn’t move money.`)
    setError(null)
    try {
      const session = await sessionFor(executor, wallet.address, () => wallet.clientOn(executor.chainId))
      if (!session.withdrawal) throw new Error(`${name} withdrawals aren’t supported here yet`)
      setW(session.withdrawal)
      setTarget(session.withdrawal.targets[0])
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  const send = async () => {
    if (!w || !target) return
    setBusy(`Approve sending ${usd(amount)} from your ${name} account to your wallet on ${target.chainName}.`)
    setError(null)
    try {
      const id = await w.withdraw(amount, target)
      setTracking({ id, amount, to: target })
      setState('waiting')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  const box = 'mt-3 flex flex-col gap-3 rounded-2xl border border-soft-line bg-bg/50 p-4 text-sm sm:p-5'

  if (tracking) {
    const arrives = tracking.amount - (w?.fee ?? 0)
    const pct = { waiting: 20, processing: 60, done: 100, failed: 100 }[state]
    return (
      <div className={box} aria-busy={state !== 'done'} role="status">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-[15px] font-semibold text-ink">
            {state === 'done' ? `${usd(arrives)} arrived in your wallet` : state === 'failed' ? 'The withdrawal didn’t go through' : `${usd(arrives)} on its way`}
          </h4>
          <span className="text-[13px] text-muted">{state === 'done' ? tracking.to.chainName : w?.eta}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-track">
          <div className={`h-1.5 rounded-full transition-[width] duration-700 ${state === 'done' ? 'bg-win' : state === 'failed' ? 'bg-lose' : 'bg-live'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[13px] leading-normal text-muted">
          {state === 'failed'
            ? `Your money is safe; contact ${name} support with your wallet address.`
            : `${tracking.to.symbol} on ${tracking.to.chainName}, to your wallet. You can close this page; it keeps moving.`}
        </p>
      </div>
    )
  }

  const tooLow = !!w && amount < w.min
  const tooHigh = amount > available + 1e-9

  return (
    <div className={box}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[15px] font-semibold text-ink">Withdraw from {name}</h4>
        <button onClick={onClose} className="text-muted hover:text-ink">Cancel</button>
      </div>

      {!w ? (
        <>
          <p className="text-muted">{usd(available)} is in your {name} account. Send it back to your own wallet.</p>
          <button onClick={open} disabled={!!busy} className="min-h-12 rounded-[14px] bg-ink px-5 text-[15px] font-semibold text-bg disabled:bg-track disabled:text-muted">
            {wallet.address ? 'Continue' : 'Connect wallet'}
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`wd-${venue}`} className="text-[13px] text-muted">Amount</label>
            <div className={`${field} flex min-h-[52px] items-center gap-1`}>
              <span className="text-lg text-faint">$</span>
              <input
                id={`wd-${venue}`}
                inputMode="decimal"
                value={amount || ''}
                onChange={(e) => setAmount(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                className="min-w-0 flex-1 bg-transparent text-lg font-medium outline-none"
              />
              <button onClick={() => setAmount(Math.floor(available * 100) / 100)} className="text-[13px] text-win hover:text-win-hover">All</button>
            </div>
            {(tooLow || tooHigh) && (
              <span className="text-[13px] text-lose-ink">{tooHigh ? `Only ${usd(available)} is available` : `The minimum is ${usd(w.min)}`}</span>
            )}
          </div>

          {w.targets.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span id={`wd-to-${venue}`} className="text-[13px] text-muted">Send to your wallet on</span>
              <div role="radiogroup" aria-labelledby={`wd-to-${venue}`} className="flex flex-wrap gap-2">
                {w.targets.map((t) => (
                  <button
                    key={t.chainId}
                    role="radio"
                    aria-checked={t === target}
                    onClick={() => setTarget(t)}
                    className={`min-h-11 rounded-full border px-4 text-sm ${t === target ? 'border-win bg-win/[0.07] text-ink' : 'border-line text-ink-2 hover:border-strong-line'}`}
                  >
                    {t.chainName}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-[13px] text-faint">
            {target?.symbol} on {target?.chainName} · {w.fee ? `${name} keeps ${usd(w.fee)}, you get ${usd(Math.max(0, amount - w.fee))}` : 'no fee'} · {w.eta}
          </p>

          <button
            onClick={send}
            disabled={!!busy || tooLow || tooHigh || !target}
            className="min-h-12 rounded-[14px] bg-ink px-5 text-[15px] font-semibold text-bg transition hover:bg-white disabled:bg-track disabled:text-muted"
          >
            {busy ? 'Waiting for your wallet…' : `Withdraw ${usd(amount)} to ${target?.chainName}`}
          </button>
        </>
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
