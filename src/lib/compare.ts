import type { Direction, Quote, VenueId, VenueResult } from './venues/types'

export const multiple = (q: Quote) => q.payoutIfRight / q.cost

// Only quotes on the strike nearest the belief are the same bet: a strike further out always pays more and wins less
// often. For "above" that strike is the lowest one at or above the sentence's price, for "below" the highest one at
// or under it; a nearby one on the easier side (offered as an alternative) leads only when nothing is there. Only a quote that can actually be filled can pay most; estimates are
// compared but never crowned. A venue that can only take part of the stake is judged on what you'd end up with
// if right, with the part it couldn't take still in your pocket, so a small partial fill can't win on its ratio.
export function compare(results: VenueResult[], level: number, stake?: number, direction: Direction = 'above'): { best: VenueId | null; comparable: VenueId[] } {
  const quotes = results.filter((r): r is Quote => r.available)
  if (!quotes.length) return { best: null, comparable: [] }
  const levels = quotes.map((q) => q.actualLevel)
  const nearest = direction === 'below'
    ? (levels.some((l) => l <= level + 0.5) ? Math.max(...levels.filter((l) => l <= level + 0.5)) : Math.min(...levels))
    : (levels.some((l) => l >= level - 0.5) ? Math.min(...levels.filter((l) => l >= level - 0.5)) : Math.max(...levels))
  const same = quotes.filter((q) => Math.abs(q.actualLevel - nearest) < 1)
  const firm = same.filter((q) => !q.estimate)
  const score = (q: Quote) => (stake ? q.payoutIfRight + Math.max(0, stake - q.cost) : multiple(q))
  const best = firm.length ? firm.reduce((a, c) => (score(c) > score(a) ? c : a)) : null
  return { best: best?.venue ?? null, comparable: same.map((q) => q.venue) }
}

// Getting back no more than you put in when right is not a bet: the venue prices the belief as already true.
// Runs on the server and again in the browser after quotes are re-priced against live order books.
export function finalize(results: VenueResult[], level: number, stake?: number, direction: Direction = 'above') {
  const checked = results.map((r): VenueResult =>
    r.available && r.payoutIfRight <= r.cost
      ? { venue: r.venue, available: false, reason: `Pays ${r.payoutIfRight.toFixed(2)} for ${r.cost.toFixed(2)}: the market treats this as already true`, link: r.link }
      : r,
  )
  return { results: checked, ...compare(checked, level, stake, direction) }
}
