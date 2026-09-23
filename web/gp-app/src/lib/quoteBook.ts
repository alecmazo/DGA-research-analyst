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

const BOOK_KEY = 'dga.quote.book.v2'
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

function cleanBookPx(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null
  const digits = Math.abs(n) >= 1 ? 2 : 4
  return Number(n.toFixed(digits))
}

function cleanBookPct(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || Math.abs(n) > 80) return null
  return Number(n.toFixed(2))
}

export function publishQuotes(map: Record<string, Raw> | null | undefined) {
  if (!map) return
  let changed = false
  for (const [rawKey, v] of Object.entries(map)) {
    const tk = rawKey.toUpperCase()
    const price = v ? cleanBookPx(v.price) : null
    if (price == null) {
      if (book[tk]) {
        delete book[tk]
        changed = true
      }
      continue
    }
    const pctN = cleanBookPct(v?.pct ?? v?.pct_change)
    const prev = book[tk]
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
