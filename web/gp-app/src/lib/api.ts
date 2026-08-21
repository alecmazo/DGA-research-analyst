import { clearSession, getToken } from './auth'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const headers = new Headers(opts.headers || {})
  const token = getToken()
  if (token) headers.set('x-auth-v2-token', token)
  if (opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(path, { ...opts, headers })
  if (res.status === 401 && path.startsWith('/api/')) {
    clearSession()
    window.location.replace('/')
    throw new ApiError(401, 'Unauthorized')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : null) ||
      (data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : null) ||
      `HTTP ${res.status}`
    throw new ApiError(res.status, msg, data)
  }
  return data as T
}

/** Authenticated blob fetch (audio samples, etc.). */
export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers()
  const token = getToken()
  if (token) headers.set('x-auth-v2-token', token)
  const res = await fetch(path, { headers })
  if (res.status === 401) {
    clearSession()
    window.location.replace('/')
    throw new ApiError(401, 'Unauthorized')
  }
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`)
  return res.blob()
}

/** Authenticated blob download (Excel/PDF exports). */
export async function downloadAuth(path: string, fallbackName = 'download') {
  const headers = new Headers()
  const token = getToken()
  if (token) headers.set('x-auth-v2-token', token)
  const res = await fetch(path, { headers })
  if (res.status === 401) {
    clearSession()
    window.location.replace('/')
    throw new ApiError(401, 'Unauthorized')
  }
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`)
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') || ''
  const m = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd)
  const name = m ? decodeURIComponent(m[1].replace(/"/g, '')) : fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export type Quote = {
  price?: number | null
  pct?: number | null
  pct_change?: number | null
  /** Calendar year-to-date % (first close of year → live last). */
  ytd?: number | null
  ytd_pct?: number | null
  /** ``ipo`` when the name listed this calendar year — show IPO, not a dash. */
  ytd_status?: 'ok' | 'ipo' | string | null
  ytd_label?: string | null
  as_of?: string | null
  prev?: number | null
}

/** Per-ticker earnings highlight from GET /api/watchlist */
export type WatchlistEarning = {
  days_until?: number | null
  session?: string | null
  label?: string | null
  date?: string | null
  fiscal_quarter?: string | null
  eps_forecast?: string | number | null
  has_report?: boolean
}

export type WatchlistResponse = {
  tickers: string[]
  quotes: Record<string, Quote>
  earnings?: Record<string, WatchlistEarning>
  reports?: Record<string, boolean>
  timing_ms?: number
}

export type EarningsCardPayload = {
  ok?: boolean
  error?: string
  status?: string
  source?: string
  has_report?: boolean
  event?: {
    name?: string
    date?: string
    days_until?: number | null
    session?: string
    fiscal_quarter?: string
  }
  result?: {
    beat?: string | null
    eps_actual?: number | null
    eps_estimate?: number | null
    surprise_pct?: number | null
    revenue_actual?: number | null
    revenue_estimate?: number | null
    revenue_surprise_pct?: number | null
    revenue_beat?: string | null
  }
  quote?: Quote & { pct_change?: number | null }
  history?: Array<{
    fiscal_quarter?: string
    date_reported?: string
    eps_actual?: number | null
    eps_estimate?: number | null
    surprise_pct?: number | null
    beat?: string | null
  }>
  notes?: {
    tone?: string
    vs_analysts?: string
    bullets?: string[]
  }
  call_highlights?: {
    quarter?: string
    call_date?: string
    stale?: boolean
    note?: string
    highlights?: Array<{
      theme?: string
      themes?: string[]
      quote?: string
      quarter?: string
      call_date?: string
    }>
  }
  /** Company IR site (Yahoo free profile) — open for full earnings release. */
  investor_relations_url?: string | null
  website_url?: string | null
  /** Latest Item 2.02 8-K exhibit when available (SEC EDGAR). */
  press_release_url?: string | null
  filing_url?: string | null
}

export type IndexRow = {
  symbol?: string
  name?: string
  label?: string
  price?: number | null
  pct?: number | null
  pct_change?: number | null
}

export type DailyBrief = {
  ok?: boolean
  markdown?: string
  generated_at?: string
  date_str?: string
  provider?: string
  model?: string
  exists?: boolean
}

export type BuildInfo = { build?: string }

export type MeResponse = {
  lp_id?: string
  email?: string
  name?: string
  role?: string
  must_change_password?: boolean
  demo_mode?: boolean
}

export type LlmProvider = 'grok' | 'claude' | 'deepseek' | 'kimi'

export type ReportDelta = {
  has_change?: boolean
  rating_changed?: boolean
  pt_changed?: boolean
  days_since_prior?: number | null
  prior_generated_at?: string | null
  prior_report_date?: string | null
  version_index?: number
  rating?: { from?: string | null; to?: string | null }
  price_target?: {
    from?: number | null
    to?: number | null
    chg_pct?: number | null
  }
  upside_pct?: {
    from?: number | null
    to?: number | null
    chg_pp?: number | null
  }
}

export type SavedReport = {
  ticker: string
  price_target?: number | null
  upside_pct?: number | null
  current_price?: number | null
  pct_change?: number | null
  generated_at?: string | null
  report_date?: string | null
  claude_generated_at?: string | null
  kimi_generated_at?: string | null
  deepseek_generated_at?: string | null
  last_attempt_at?: string | null
  last_attempt_status?: string | null
  last_attempt_error?: string | null
  has_docx?: boolean
  has_pptx?: boolean
  pptx_stale?: boolean
  providers?: string[]
  grok_price_target?: number | null
  claude_price_target?: number | null
  grok_upside_pct?: number | null
  claude_upside_pct?: number | null
  version_count?: number
  rating?: string | null
  /** Per-provider or flat delta vs prior Analyze (from archive). */
  delta_from_prior?: ReportDelta | null
  claude_rating?: string | null
  kimi_rating?: string | null
  deepseek_rating?: string | null
  kimi_price_target?: number | null
  deepseek_price_target?: number | null
  kimi_upside_pct?: number | null
  deepseek_upside_pct?: number | null
}

export type JobStatus = {
  job_id?: string
  status?: string
  progress?: { pct?: number | null; label?: string | null }
  result?: {
    cost_usd?: number
    model?: string
    provider?: string
    price_target?: number | null
    markdown?: string
    providers?: Record<string, string>
    persisted_to_db?: boolean
    has_report?: boolean
  }
  error?: string
  detail?: string
  warning?: string
  model?: string
  provider?: string
}

export type ReportHistoryVersion = {
  id: number | string
  provider?: string
  generated_at?: string | null
  report_date?: string | null
  rating?: string | null
  price_target?: number | null
  upside_pct?: number | null
  has_md?: boolean
  is_current?: boolean
  version_count?: number
  delta_from_prior?: ReportDelta | null
  delta_to_next?: ReportDelta | null
}

export type ReportHistory = {
  versions?: ReportHistoryVersion[]
  current?: ReportHistoryVersion | null
  version_count?: number
  delta_from_prior?: ReportDelta | null
}

export type ReportDetail = {
  ticker?: string
  /** Primary field from GET /api/report/{ticker} */
  report_md?: string
  markdown?: string
  content?: string
  body_md?: string
  report_date?: string
  generated_at?: string
  price_target?: number | null
  upside_pct?: number | null
  rating?: string | null
  provider?: string
  gamma_url?: string | null
  has_docx?: boolean
  has_pptx?: boolean
  note?: string
  version_count?: number
  delta_from_prior?: ReportDelta | null
}
