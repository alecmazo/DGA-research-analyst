/** Tiny window openers. Keep these off the page modules so Desk does not
 *  download Report / Valuation / Comps / Local-portfolio on first paint. */

function popup(url: string, name: string, features: string) {
  const win = window.open(url, name, features)
  if (!win) window.location.href = url
}

/** Open saved report in a real browser window (legacy behavior). */
export function openReportWindow(ticker: string, provider = 'grok') {
  const tk = ticker.trim().toUpperCase()
  if (!tk) return
  const pv = (provider || 'grok').toLowerCase()
  const local = pv === 'local'
  const url = local
    ? `/gp/local-report?ticker=${encodeURIComponent(tk)}`
    : `/gp/report?ticker=${encodeURIComponent(tk)}&provider=${encodeURIComponent(pv)}`
  const name = local ? `dga-local-report-${tk}` : `dga-report-${tk}-${pv}`
  // Do not use noopener alone in a way that breaks same-origin localStorage —
  // omit noreferrer so the session token still works; popup is same-origin SPA.
  popup(
    url,
    name,
    'width=1040,height=900,menubar=no,toolbar=no,location=no,status=no',
  )
}

export function openValuationWindow(ticker: string, focus?: string) {
  const tk = ticker.trim().toUpperCase()
  if (!tk) return
  const q = new URLSearchParams({ ticker: tk })
  if (focus) q.set('focus', focus)
  const url = `/gp/valuation?${q.toString()}`
  popup(
    url,
    `dga-val-${tk}-${focus || 'style'}`,
    'width=1100,height=920,menubar=no,toolbar=no,location=no,status=no',
  )
}

export function openCompsWindow(ticker: string) {
  const tk = ticker.trim().toUpperCase()
  if (!tk) return
  popup(
    `/gp/comps?ticker=${encodeURIComponent(tk)}`,
    `dga-comps-${tk}`,
    'width=1200,height=820,menubar=no,toolbar=no,location=no,status=no',
  )
}

/** Open a saved portfolio recommendation in its own window. */
export function openPortfolioReport(id: string) {
  const reportId = id.trim()
  if (!reportId) return
  popup(
    `/gp/local-portfolio?id=${encodeURIComponent(reportId)}`,
    `dga-portfolio-${reportId}`,
    'width=1180,height=900,menubar=no,toolbar=no,location=no,status=no',
  )
}
