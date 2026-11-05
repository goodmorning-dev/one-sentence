import type { VenueId } from '../venues/types'
import { deriveExecutor } from './derive'
import { hyperliquidExecutor } from './hyperliquid'
import { polymarketExecutor } from './polymarket'
import type { Executor } from './types'

// Venues we can trade on from our UI.
export const executors: Partial<Record<VenueId, Executor>> = {
  polymarket: polymarketExecutor,
  hyperliquid: hyperliquidExecutor,
  derive: deriveExecutor,
}
