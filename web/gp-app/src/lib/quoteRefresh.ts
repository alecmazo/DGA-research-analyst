/**
 * Shared quote-refresh clock (SUP_20260817_fc0ccc2a).
 * Desk watchlist + market ribbon tick on the same interval so prints
 * stay in lockstep. One timer for the whole GP shell.
 */
export const QUOTE_REFRESH_MS = 45_000

type Listener = () => void

const listeners = new Set<Listener>()
let timer: number | null = null

function tick() {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore one bad subscriber */
    }
  })
}

export function subscribeQuoteRefresh(fn: Listener): () => void {
  listeners.add(fn)
  if (timer == null && typeof window !== 'undefined') {
    timer = window.setInterval(tick, QUOTE_REFRESH_MS)
  }
  return () => {
    listeners.delete(fn)
    if (!listeners.size && timer != null) {
      window.clearInterval(timer)
      timer = null
    }
  }
}
