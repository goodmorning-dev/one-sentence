export const usd = (n: number, digits = n !== 0 && Math.abs(n) < 1000 ? 2 : 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })

export const signedUsd = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${usd(Math.abs(n))}`

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// "Fri, 30 Oct" for a YYYY-MM-DD date; dates are calendar days, so read them in UTC.
export const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })

// Market-implied chance in words a non-trader reads at a glance.
export function chanceWords(p: number) {
  const mood =
    p < 0.1 ? 'a long shot' : p < 0.35 ? 'unlikely' : p < 0.45 ? 'slightly unlikely' : p <= 0.55 ? 'a coin flip' : p < 0.8 ? 'likely' : 'very likely'
  return { mood, odds: `about ${Math.min(99, Math.max(1, Math.round(p * 100)))} in 100` }
}

const SYMBOLS: Record<string, string> = { Ethereum: 'ETH', Bitcoin: 'BTC', Solana: 'SOL', XRP: 'XRP' }

// "Will the price of Ethereum be above $2,000 on October 31?" → "ETH above $2,000 on October 31".
export function shortTitle(t: string) {
  const m = t.match(/price of (\w+) be above \$([\d,.]+) on (.+?)\??$/i)
  return m ? `${SYMBOLS[m[1]] ?? m[1]} above $${m[2]} on ${m[3]}` : t
}

// SDKs wrap wallet errors ("Failed to sign the typed data") and keep the real one in `cause`. Collect the chain,
// innermost last, preferring viem's one-line `shortMessage`, so the UI can show what actually went wrong.
export function errorChain(e: unknown): string[] {
  const out: string[] = []
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth++) {
    const err = cur as { shortMessage?: string; message?: string; cause?: unknown }
    const m = err.shortMessage ?? err.message ?? String(cur)
    if (m && !out.includes(m)) out.push(m)
    cur = err.cause
  }
  return out
}
