/** Latest desk diagnostic. The Support button attaches this to the ticket. */
const KEY = 'dga.support.watchlist_log'

export function saveSupportLog(text: string) {
  try {
    sessionStorage.setItem(KEY, text.slice(0, 6000))
  } catch {
    /* private mode */
  }
}

export function readSupportLog(): string {
  try {
    return sessionStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}
