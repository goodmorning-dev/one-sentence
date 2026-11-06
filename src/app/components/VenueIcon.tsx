import type { CSSProperties } from 'react'
import type { VenueId } from '@/lib/venues/types'

// Each venue's colour as a CSS value. Set it as `--venue` on a card and its children tint themselves from it.
export const VENUE_COLOR: Record<VenueId, string> = {
  derive: 'var(--derive)',
  polymarket: 'var(--polymarket)',
  hyperliquid: 'var(--hyperliquid)',
}

export const venueStyle = (venue: VenueId) => ({ '--venue': VENUE_COLOR[venue] }) as CSSProperties

// Simple marks in each venue's colours, drawn here rather than copied: an orange leaf for Derive, a cube on blue
// for Polymarket, a mint bow on deep green for Hyperliquid. Muted turns them grey for a venue with no offer.
export function VenueIcon({ venue, size = 32, muted = false }: { venue: VenueId; size?: number; muted?: boolean }) {
  const r = size * 0.28
  const tile = { width: size, height: size, borderRadius: r, filter: muted ? 'grayscale(1) opacity(0.55)' : undefined }
  if (venue === 'derive') {
    return (
      <span aria-hidden className="grid shrink-0 place-items-center bg-[#1c120d] ring-1 ring-derive/25 ring-inset" style={tile}>
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
          <defs>
            <linearGradient id="derive-leaf" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffb26b" />
              <stop offset="0.55" stopColor="#ff6b2c" />
              <stop offset="1" stopColor="#e2321b" />
            </linearGradient>
          </defs>
          <path d="M19.5 4.5c.6 7.4-3.3 13.6-11.2 15.1-1.6.3-3.2-.9-3.6-2.5C3 10 9.6 4.2 19.5 4.5Z" fill="url(#derive-leaf)" />
          <path d="M6.5 17.5 15 9" stroke="#1c120d" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  if (venue === 'polymarket') {
    return (
      <span aria-hidden className="grid shrink-0 place-items-center bg-[#1652f0]" style={tile}>
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round">
          <path d="M12 3.5 19.5 7.8v8.4L12 20.5l-7.5-4.3V7.8Z" />
          <path d="M4.5 7.8 12 12l7.5-4.2M12 12v8.5" />
        </svg>
      </span>
    )
  }
  return (
    <span aria-hidden className="grid shrink-0 place-items-center bg-[#03211c] ring-1 ring-hyperliquid/20 ring-inset" style={tile}>
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24">
        <path
          d="M2.5 12c0-3.2 1.4-5.4 3.4-5.4 2.8 0 3.4 3.8 6.1 3.6 2.8-.2 3.5-4.4 6.2-4.4 2.2 0 3.3 3 3.3 6.2s-1.1 6.2-3.3 6.2c-2.7 0-3.4-4.2-6.2-4.4-2.7-.2-3.3 3.6-6.1 3.6-2 0-3.4-2.2-3.4-5.4Z"
          fill="#97fce3"
        />
      </svg>
    </span>
  )
}
