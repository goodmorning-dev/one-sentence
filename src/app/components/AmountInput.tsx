'use client'

import { useEffect, useState, type ReactNode } from 'react'

// A dollar amount the person types. The text is kept as typed, so "5." survives until the next digit makes it
// "5.5"; the number goes out on every change, at most two decimals.
export function AmountInput({ id, value, onChange, after, className = '' }: {
  id: string
  value: number
  onChange: (n: number) => void
  after?: ReactNode
  className?: string
}) {
  const [text, setText] = useState(value ? String(value) : '')

  // Follow outside changes (an "All" button) but not the echo of our own typing.
  useEffect(() => {
    if (Number(text || 0) !== value) setText(value ? String(value) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className={`flex min-h-[52px] items-center gap-1 rounded-xl border border-strong-line bg-bg px-3.5 focus-within:border-win/60 ${className}`}>
      <span className="text-xl text-faint">$</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const m = e.target.value.replace(/,/g, '.').replace(/[^\d.]/g, '').match(/^(\d*)(\.?)(\d{0,2})/)
          const next = m ? `${m[1]}${m[2]}${m[3]}` : ''
          setText(next)
          onChange(Number(next || 0))
        }}
        className="min-w-0 flex-1 bg-transparent text-xl font-medium text-ink outline-none"
      />
      {after}
    </div>
  )
}
