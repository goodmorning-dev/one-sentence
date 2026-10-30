import type { VenueId } from '../venues/types'
import { polymarketExecutor } from './polymarket'
import type { Executor } from './types'

// Venues we can trade on from our UI. The rest still link out until their adapter lands.
export const executors: Partial<Record<VenueId, Executor>> = {
  polymarket: polymarketExecutor,
}
