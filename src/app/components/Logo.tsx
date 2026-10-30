// "One sentence" with a lime typing caret: type what you think. The caret blinks 4 times whenever `blink`
// changes (page load, a new quote), then rests solid, so it never competes with the payouts.
export function Logo({ blink }: { blink: string | number }) {
  return (
    <a href="#" className="flex min-h-11 items-center text-[17px] font-semibold tracking-[-0.02em] text-ink no-underline sm:text-lg">
      One sentence
      <span key={blink} aria-hidden className="caret ml-[3px] inline-block h-5 w-[3px] rounded-[2px] bg-win sm:h-[22px]" />
    </a>
  )
}

export const TAGLINE = 'Bet on crypto prices. Get the best payout.'
