/** Open a ticker's Financials page in a new tab so the originating desk stays put. */

export function financialsPath(ticker: string): string | null {
  const sym = (ticker || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '')
  if (!sym) return null
  return `/gp/financials?ticker=${encodeURIComponent(sym)}`
}

export function openFinancialsPage(ticker: string): void {
  const path = financialsPath(ticker)
  if (!path) return
  window.open(path, '_blank', 'noopener,noreferrer')
}
