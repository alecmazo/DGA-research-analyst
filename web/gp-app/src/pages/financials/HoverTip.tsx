import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Viewport-fixed hover card. Flips left/down so it never clips the window. */
export function HoverTip({
  x,
  y,
  className,
  children,
}: {
  x: number
  y: number
  className: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    el.style.maxWidth = `${Math.max(160, vw - pad * 2)}px`
    el.style.whiteSpace = 'nowrap'
    let tw = el.offsetWidth
    let th = el.offsetHeight
    if (tw > vw - pad * 2) {
      el.style.whiteSpace = 'normal'
      tw = el.offsetWidth
      th = el.offsetHeight
    }
    let left = x + 14
    let top = y - th - 12
    if (left + tw > vw - pad) left = x - tw - 12
    if (left < pad) left = pad
    if (top < pad) top = y + 16
    if (top + th > vh - pad) top = Math.max(pad, vh - th - pad)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [x, y, children])
  return createPortal(
    <div ref={ref} className={className} role="tooltip">
      {children}
    </div>,
    document.body,
  )
}
