/**
 * One price book for the desk. The watchlist fills it from the store.
 * Other cards read it. They do not each call Yahoo.
 */
export type BookQuote = {
  price: number | null
  pct?: number | null
  pct_change?: number | null
}

type Raw = {
  price?: number | null
  pct?: number | null
  pct_change?: number | null
}

const BOOK_KEY = 'dga.quote.book.v1'
const book: Record<string, BookQuote> = {}
const listeners = new Set<() => void>()

function loadBook() {
  try {
    const raw = sessionStorage.getItem(BOOK_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, BookQuote>
    for (const [k, v] of Object.entries(parsed || {})) {
      if (v && v.price != null) book[k] = v
    }
  } catch {
    /* private mode */
  }
}

function saveBook() {
  try {
    sessionStorage.setItem(BOOK_KEY, JSON.stringify(book))
  } catch {
    /* quota */
  }
}

if (typeof sessionStorage !== 'undefined') loadBook()

export function publishQuotes(map: Record<string, Raw> | null | undefined) {
  if (!map) return
  let changed = false
  for (const [rawKey, v] of Object.entries(map)) {
    if (!v || v.price == null || Number.isNaN(Number(v.price))) continue
    const tk = rawKey.toUpperCase()
    const pct = v.pct ?? v.pct_change ?? null
    const prev = book[tk]
    const price = Number(v.price)
    const pctN = pct == null || Number.isNaN(Number(pct)) ? null : Number(pct)
    if (prev && prev.price === price && (prev.pct ?? null) === pctN) continue
    book[tk] = { price, pct: pctN, pct_change: pctN }
    changed = true
  }
  if (changed) {
    saveBook()
    listeners.forEach((fn) => fn())
  }
}

export function readQuote(ticker: string): BookQuote | undefined {
  return book[(ticker || '').toUpperCase()]
}

export function subscribeQuoteBook(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
