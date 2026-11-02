import type { WalletClient } from 'viem'
import type { Executor, VenueSession } from './types'

// One open session per venue and wallet for the whole page, so betting and then selling (or two bets)
// never ask the wallet to sign in twice. A failed open is forgotten, so the next attempt starts clean.
const sessions = new Map<string, Promise<VenueSession>>()

export function sessionFor(executor: Executor, address: string, client: () => Promise<WalletClient>): Promise<VenueSession> {
  const key = `${executor.venue}:${address.toLowerCase()}`
  let s = sessions.get(key)
  if (!s) {
    s = client().then((c) => executor.open(c))
    s.catch(() => sessions.delete(key))
    sessions.set(key, s)
  }
  return s
}
