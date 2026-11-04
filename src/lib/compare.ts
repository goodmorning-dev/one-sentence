import type { Quote, VenueId, VenueResult } from './venues/types'

export const multiple = (q: Quote) => q.payoutIfRight / q.cost

// Only quotes on the strike nearest the belief are the same bet: a higher strike always pays more and wins less often.
// That strike is the lowest one at or above the sentence's price; a nearby lower one (offered as an alternative)
// leads only when nothing is at or above. Only a quote that can actually be filled can pay most; estimates are
// compared but never crowned.
export function compare(results: VenueResult[], level: number): { best: VenueId | null; comparable: VenueId[] } {
  const quotes = results.filter((r): r is Quote => r.available)
  if (!quotes.length) return { best: null, comparable: [] }
  const above = quotes.filter((q) => q.actualLevel >= level - 0.5).map((q) => q.actualLevel)
  const nearest = above.length ? Math.min(...above) : Math.max(...quotes.map((q) => q.actualLevel))
  const same = quotes.filter((q) => Math.abs(q.actualLevel - nearest) < 1)
  const firm = same.filter((q) => !q.estimate)
  const best = firm.length ? firm.reduce((a, c) => (multiple(c) > multiple(a) ? c : a)) : null
  return { best: best?.venue ?? null, comparable: same.map((q) => q.venue) }
}

// Getting back no more than you put in when right is not a bet: the venue prices the belief as already true.
// Runs on the server and again in the browser after quotes are re-priced against live order books.
export function finalize(results: VenueResult[], level: number) {
  const checked = results.map((r): VenueResult =>
    r.available && r.payoutIfRight <= r.cost
      ? { venue: r.venue, available: false, reason: `Pays ${r.payoutIfRight.toFixed(2)} for ${r.cost.toFixed(2)}: the market treats this as already true`, link: r.link }
      : r,
  )
  return { results: checked, ...compare(checked, level) }
}
