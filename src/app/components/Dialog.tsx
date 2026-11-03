'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'

// A modal on top of the page: centred on desktop, a sheet from the bottom on a phone. The native <dialog> gives
// focus trapping and Escape for free; a click on the backdrop closes it too.
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-soft-line bg-surface p-0 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-[2px] sm:m-auto sm:max-w-[480px] sm:rounded-3xl"
    >
      <div className="flex flex-col gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button onClick={() => ref.current?.close()} aria-label="Close" className="-mr-2 grid h-11 w-11 place-items-center rounded-xl text-muted hover:bg-raised hover:text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
