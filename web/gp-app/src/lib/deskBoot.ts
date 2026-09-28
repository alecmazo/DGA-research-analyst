/** First open of the Pacific day: the watchlist owns the server, then SEC.

The desk shares one worker and one database pool. Starting the SEC notice
while the watchlist is still reading quotes makes that request hit the
client limit, so the screen keeps last week's cached list and then the
SEC card appears.
*/

const DAY_KEY = 'dga.desk.booted.day'
const EVENT = 'dga-watchlist-settled'
const FALLBACK_MS = 25_000

let settled = false

export function pacificDay(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function isFirstDeskLoadToday(): boolean {
  try {
    return localStorage.getItem(DAY_KEY) !== pacificDay()
  } catch {
    return true
  }
}

/** Remember a successful watchlist so later opens today use the old stagger. */
export function markDeskBooted(): void {
  try {
    localStorage.setItem(DAY_KEY, pacificDay())
  } catch {
    /* ignore */
  }
}

/** Release cards that waited on the first watchlist. Also runs after a timeout. */
export function notifyWatchlistSettled(): void {
  if (settled) return
  settled = true
  window.dispatchEvent(new Event(EVENT))
}

/** Run fn now, or after the first watchlist of the day has finished. */
export function afterWatchlist(fn: () => void): () => void {
  if (!isFirstDeskLoadToday() || settled) {
    fn()
    return () => {}
  }
  let done = false
  const go = () => {
    if (done) return
    done = true
    window.clearTimeout(fallback)
    fn()
  }
  const fallback = window.setTimeout(go, FALLBACK_MS)
  window.addEventListener(EVENT, go, { once: true })
  return () => {
    done = true
    window.clearTimeout(fallback)
    window.removeEventListener(EVENT, go)
  }
}

/** Same stagger as before, but on the first open it starts only after the list. */
export function delayAfterWatchlist(ms: number, fn: () => void): () => void {
  let timer = 0
  const stopWait = afterWatchlist(() => {
    timer = window.setTimeout(fn, ms)
  })
  return () => {
    stopWait()
    if (timer) window.clearTimeout(timer)
  }
}
