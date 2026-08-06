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
}

export type IndexRow = {
  symbol?: string
  name?: string
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
  }
  error?: string
  detail?: string
  model?: string
  provider?: string
}

export type IdeaMover = {
  ticker: string
  pct_change?: number | null
  price?: number | null
  reason_class?: string
  reason_text?: string
  sources?: string[]
  sector?: string
  sector_etf?: string
  sector_pct_change?: number | null
  news?: Array<{
    title?: string
    url?: string
    publisher?: string
    pub_ts?: number
  }>
}

export type IdeaFeed = {
  movers?: IdeaMover[]
  as_of?: string
  session_date?: string
  threshold?: number
  note?: string
  error?: string
}

export type PrioritizePick = {
  ticker?: string
  priority?: string
  score?: number | null
  reason?: string
  bucket?: string
}

export type PrioritizeResult = {
  ok?: boolean
  error?: string
  note?: string
  picks?: PrioritizePick[]
  considered?: number
  skipped?: Array<{ ticker?: string; reason?: string }>
  bucket_counts?: { active?: number; stale?: number; fresh?: number }
  model?: string
  provider?: string
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
}
