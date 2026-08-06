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
  if (opts.body && !headers.has('Content-Type')) {
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

export type Quote = {
  price?: number | null
  pct?: number | null
  pct_change?: number | null
  as_of?: string | null
  prev?: number | null
}

export type WatchlistResponse = {
  tickers: string[]
  quotes: Record<string, Quote>
  earnings?: Record<string, unknown>
  reports?: Record<string, boolean>
  timing_ms?: number
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
