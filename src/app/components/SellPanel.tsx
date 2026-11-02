'use client'

import { useCallback, useEffect, useState } from 'react'
import { executors } from '@/lib/exec'
import { sessionFor } from '@/lib/exec/sessions'
import type { Position, SellQuote, TradeResult } from '@/lib/exec/types'
import { signedUsd, usd } from '@/lib/format'
import { useWallet } from '@/lib/wallet'
import { VENUE_NAMES } from './Quotes'
import { Spinner } from './TradePanel'

export const canSell = (p: Position) => p.status === 'live' && !!executors[p.venue]?.sellQuote

function message(e: unknown) {
  const m = e instanceof Error ? e.message : String(e)
  if (/user (rejected|denied)|rejected the request|denied transaction/i.test(m)) return 'Your wallet turned it down. Nothing was sold.'
  if (/failed to fetch|network|ERR_CERT/i.test(m)) return 'We couldn’t reach the venue. It may be blocked on this network. Nothing was sold.'
  return m
}

// Sell a live bet before it's decided: price it against the live bids, show exactly what comes back, confirm.
export function SellPanel({ p, onClose, onSold }: { p: Position; onClose: () => void; onSold: () => void }) {
  const wallet = useWallet()
  const executor = executors[p.venue]!
  const venue = VENUE_NAMES[p.venue]
  const [quote, setQuote] = useState<SellQuote | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TradeResult | null>(null)

  const price = useCallback(async () => {
    setError(null)
    setQuote(null)
    try {
      setQuote(await executor.sellQuote!(p))
    } catch (e) {
      setError(message(e))
    }
  }, [executor, p])

  useEffect(() => {
    price()
  }, [price])

  const confirm = async () => {
    if (!quote || !wallet.address) return
    setBusy(`Confirm in your wallet. ${executor.sellNote ?? ''}`.trim())
    setError(null)
    try {
      const session = await sessionFor(executor, wallet.address, () => wallet.clientOn(executor.chainId))
      const r = await session.sell!(p, quote)
      setResult(r)
      if (r.ok) setTimeout(onSold, 2500) // give the venue a moment before My bets re-reads it
      else price()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  const box = 'mt-3 flex flex-col gap-3 rounded-2xl border border-soft-line bg-bg/50 p-4 text-left text-sm sm:p-5'

  if (result?.ok) {
    return (
      <div className={box} role="status">
        <span className="text-[15px] font-medium text-win">{result.message}</span>
        <span className="text-muted">The money is in your {venue} account. My bets updates in a moment.</span>
      </div>
    )
  }

  const pnl = quote ? quote.proceeds - p.cost * (quote.shares / p.shares) : 0

  return (
    <div className={box}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[15px] font-semibold text-ink">Sell now on {venue}</h4>
        <button onClick={onClose} className="text-muted hover:text-ink">Cancel</button>
      </div>

      {!quote && !error && <p className="flex items-center gap-2 text-muted"><Spinner />Checking what buyers pay right now…</p>}

      {quote && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <div>
              <p className="text-[13px] text-muted">You get back</p>
              <p className="text-[28px] font-semibold tracking-[-0.02em] text-ink">{usd(quote.proceeds)}</p>
            </div>
            <p className={`text-[15px] font-medium ${pnl >= 0 ? 'text-win' : 'text-lose'}`}>{signedUsd(pnl)} vs what you paid</p>
          </div>
          <p className="text-[13px] text-faint">
            {quote.shares.toLocaleString('en-US', { maximumFractionDigits: 2 })} shares at about {quote.avgPrice.toFixed(4)} · fees {usd(quote.fees)} · selling
            gives up the {usd(p.payoutIfRight)} you’d get if right
          </p>
          {quote.note && <p className="text-[13px] text-lose-ink">{quote.note}</p>}
        </>
      )}

      {busy && (
        <div className="flex flex-col gap-1 rounded-xl bg-raised px-3.5 py-3">
          <span className="flex items-center gap-2 text-ink"><Spinner />Check your wallet</span>
          <span className="text-[13px] leading-normal text-muted">{busy}</span>
        </div>
      )}
      {error && <p role="alert" className="rounded-xl border border-lose/40 bg-lose/[0.06] px-3.5 py-3 text-ink-2">{error}</p>}
      {result && !result.ok && <p role="alert" className="text-lose-ink">{result.message}</p>}

      <div className="flex flex-wrap gap-2">
        {!wallet.address ? (
          <button onClick={() => wallet.connect().catch((e) => setError(message(e)))} className="min-h-12 flex-1 rounded-[14px] bg-ink px-5 text-[15px] font-semibold text-bg">
            Connect wallet to sell
          </button>
        ) : (
          <button
            onClick={confirm}
            disabled={!quote || !!busy}
            className="min-h-12 flex-1 rounded-[14px] bg-ink px-5 text-[15px] font-semibold text-bg transition hover:bg-white disabled:bg-track disabled:text-muted"
          >
            {busy ? 'Waiting for your wallet…' : quote ? `Confirm sale · ${usd(quote.proceeds)}` : 'Sell'}
          </button>
        )}
        {error && !busy && <button onClick={price} className="min-h-12 rounded-[14px] border border-line px-4 text-ink-2 hover:text-ink">Check again</button>}
      </div>
      {executor.sellNote && !busy && <p className="text-xs leading-normal text-faint">{executor.sellNote}</p>}
    </div>
  )
}
