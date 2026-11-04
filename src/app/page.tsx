'use client'

import { useEffect, useRef, useState } from 'react'
import { finalize } from '@/lib/compare'
import { executors } from '@/lib/exec'
import { refineAll } from '@/lib/exec/types'
import type { Quote, VenueId } from '@/lib/venues/types'
import { useBelief } from '@/lib/useBelief'
import { usePositions } from '@/lib/usePositions'
import { useSpot } from '@/lib/useSpot'
import { Logo, TAGLINE } from './components/Logo'
import { BetScreen } from './components/BetScreen'
import { MyBets } from './components/MyBets'
import { WalletPage } from './components/WalletPage'
import { order, Quotes, type QuotesData } from './components/Quotes'
import { Sentence } from './components/Sentence'
import { WalletButton } from './components/WalletButton'

type Tab = 'bet' | 'bets' | 'wallet'

// The tab lives in the URL hash so links like "See it in My bets" and the back button work.
function useTab(): Tab {
  const [tab, setTab] = useState<Tab>('bet')
  useEffect(() => {
    const read = () => setTab(location.hash === '#bets' ? 'bets' : location.hash === '#wallet' ? 'wallet' : 'bet')
    read()
    addEventListener('hashchange', read)
    return () => removeEventListener('hashchange', read)
  }, [])
  return tab
}

export default function Home() {
  const tab = useTab()
  const belief = useBelief()
  const bets = usePositions()
  const [data, setData] = useState<QuotesData | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<VenueId | null>(null)
  const { asset, level, date, stake, ready } = belief
  const spot = useSpot(asset)

  const incomplete = ready && (!(level > 0) || !(stake > 0) || !date)

  // Prices re-read every 30s while the list is on screen and the tab is visible. Not during a bet: the bet screen
  // keeps the quote it opened with (its order carries a price limit, so it never fills worse than shown), and
  // swapping it mid-flow could pull the screen away while the wallet is asking.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (picked || tab !== 'bet') return
    const t = setInterval(() => !document.hidden && setTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [picked, tab])

  // Which sentence the quotes on screen belong to, so a refresh of the same sentence happens quietly.
  const shown = useRef('')

  useEffect(() => {
    if (!ready || incomplete) return setLoading(false)
    const key = `${asset}|${level}|${date}|${stake}|${attempt}`
    const background = shown.current === key
    // A new sentence marks the quotes stale at once, so nobody can bet on the previous numbers.
    if (!background) setLoading(true)
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/quotes?${new URLSearchParams({ asset, level: String(level), date, stake: String(stake) })}`, { signal: ctrl.signal })
        if (!r.ok) throw new Error(String(r.status))
        const body: QuotesData = await r.json()
        const results = await refineAll(body.results, executors)
        if (ctrl.signal.aborted) return
        setData(finalize(results, level, stake))
        shown.current = key
        setFailed(false)
        setUpdatedAt(Date.now())
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        // Never leave numbers on screen we couldn't confirm: they'd be for an old sentence, or out of date.
        setData(null)
        shown.current = ''
        setFailed(true)
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, background ? 0 : 400)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [asset, level, date, stake, ready, incomplete, attempt, tick])

  // The venue being bet on, while its quote still stands. Changing tabs drops it.
  const pickedQuote = data?.results.find((r): r is Quote => r.available && r.venue === picked) ?? null
  const better = pickedQuote && data ? order(data).find((q) => q.venue !== picked && data.comparable.includes(q.venue) && q.payoutIfRight > pickedQuote.payoutIfRight + 0.005 && !!q.ticket) ?? null : null
  // Back from a bet, the list re-reads prices straight away.
  const pick = (v: VenueId | null) => { setPicked(v); if (!v) setTick((x) => x + 1); scrollTo({ top: 0 }) }
  useEffect(() => setPicked(null), [tab])

  const open = bets.positions?.filter((p) => p.status === 'live' || p.status === 'claimable').length ?? 0

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-chip bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 pt-3 sm:min-h-[68px] sm:flex-nowrap sm:px-8 sm:pt-0">
          <div className="flex items-center gap-3.5">
            <Logo blink={updatedAt ?? 0} />
            <span aria-hidden className="hidden h-[18px] w-px bg-line lg:block" />
            <span className="hidden text-sm text-muted lg:inline">{TAGLINE}</span>
          </div>
          <nav aria-label="Sections" className="order-3 -mx-4 grid w-[calc(100%+2rem)] grid-cols-3 sm:order-none sm:mx-0 sm:flex sm:w-auto sm:rounded-full sm:border sm:border-soft-line sm:bg-surface sm:p-1">
            <TabLink href="#" active={tab === 'bet'}>New bet</TabLink>
            <TabLink href="#bets" active={tab === 'bets'}>
              My bets
              {open > 0 && <span className={`rounded-full px-[7px] py-px text-xs text-ink-2 ${tab === 'bets' ? 'bg-chip sm:bg-bg' : 'bg-chip'}`}>{open}</span>}
            </TabLink>
            <TabLink href="#wallet" active={tab === 'wallet'}>Wallet</TabLink>
          </nav>
          <WalletButton />
        </div>
      </header>

      <main className="mx-auto max-w-[1120px] px-4 pb-12 pt-8 sm:px-8 sm:pb-20 sm:pt-16">
        {tab === 'bet' && pickedQuote ? (
          <BetScreen quote={pickedQuote} asset={asset} better={better} onBack={() => pick(null)} onSwitch={pick} onTraded={bets.refresh} />
        ) : tab === 'bet' ? (
          <div className="flex flex-col gap-8 sm:gap-12">
            {ready ? <Sentence value={belief} spot={spot} onChange={belief.set} /> : <div className="shimmer h-48 rounded-[20px] bg-surface" />}
            <Quotes
              data={data}
              incomplete={incomplete}
              loading={loading}
              failed={failed}
              updatedAt={updatedAt}
              stake={stake}
              onRetry={() => setAttempt((n) => n + 1)}
              onTry={(patch) => belief.set(patch)}
              level={level}
              spot={spot}
              asset={asset}
              onPick={pick}
            />
          </div>
        ) : tab === 'bets' ? (
          <MyBets {...bets} />
        ) : (
          <WalletPage {...bets} />
        )}
      </main>
    </div>
  )
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 text-[15px] font-medium transition sm:min-h-10 sm:rounded-full sm:border-b-0 sm:px-5 ${
        active ? 'border-win text-ink sm:bg-track' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {children}
    </a>
  )
}
