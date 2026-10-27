/** Pickup for a desk local run that a reload interrupted. */

export const RESUME_HOUR_CHOICES = [1, 6, 12, 24, 48, 168] as const
export const DEFAULT_RESUME_HOURS = 24
export const RESUME_HOURS_KEY = 'dga.local.resumeHours'
export const DESK_RUN_MEMORY_MS = 8 * 60 * 60 * 1000
export const DESK_RUN_KEY = 'dga.local.deskRun'

export function resumeWindowMs(hours: number): number {
  const picked = (RESUME_HOUR_CHOICES as readonly number[]).includes(hours) ? hours : DEFAULT_RESUME_HOURS
  return picked * 60 * 60 * 1000
}

export function resumeWindowLabel(hours: number): string {
  const picked = (RESUME_HOUR_CHOICES as readonly number[]).includes(hours) ? hours : DEFAULT_RESUME_HOURS
  if (picked === 1) return '1 hour'
  if (picked === 168) return '7 days'
  return `${picked} hours`
}

export function readResumeHours(storage: Pick<Storage, 'getItem'>): number {
  try {
    const raw = Number(storage.getItem(RESUME_HOURS_KEY))
    if ((RESUME_HOUR_CHOICES as readonly number[]).includes(raw)) return raw
  } catch {
    /* A blocked store keeps the 24 hour cutoff. */
  }
  return DEFAULT_RESUME_HOURS
}

export function writeResumeHours(hours: number, storage: Pick<Storage, 'setItem'>) {
  const picked = (RESUME_HOUR_CHOICES as readonly number[]).includes(hours) ? hours : DEFAULT_RESUME_HOURS
  try {
    storage.setItem(RESUME_HOURS_KEY, String(picked))
  } catch {
    /* Private mode can refuse the write. The menu still applies this run. */
  }
}

export type DeskStep = { tk: string; models: string[] }

type LocalView = { model?: string; generated_at?: string | null }

type LocalRow = {
  ticker?: string
  generated_at?: string | null
  local_views?: LocalView[]
}

type DeskMemory = { startedAt?: number; done?: string[] }

export function recentLocalNote(
  iso: string | null | undefined,
  now: number,
  windowMs: number = resumeWindowMs(DEFAULT_RESUME_HOURS),
): boolean {
  if (!iso) return false
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return false
  const age = now - stamp
  return age >= -5 * 60 * 1000 && age <= windowMs
}

function sameModel(stored: string | undefined, wanted: string): boolean {
  const saved = (stored || '').trim()
  const asked = wanted.trim()
  if (!saved || !asked) return false
  return saved === asked || saved.startsWith(`${asked}:`) || asked.startsWith(`${saved}:`)
}

export function deskTickers(list: { ticker?: string }[] | null | undefined): string[] {
  const seen = new Set<string>()
  const tickers: string[] = []
  for (const row of Array.isArray(list) ? list : []) {
    const tk = String(row?.ticker || '').trim().toUpperCase()
    if (!tk || seen.has(tk)) continue
    seen.add(tk)
    tickers.push(tk)
  }
  return tickers
}

export function pendingQueue(
  tickers: string[],
  models: string[],
  savedRows: LocalRow[] | null | undefined,
  memory: Set<string>,
  now: number,
  windowMs: number = resumeWindowMs(DEFAULT_RESUME_HOURS),
): { queue: DeskStep[]; skipped: number } {
  const viewsByTicker = new Map<string, LocalView[]>()
  const recentBare = new Set<string>()
  for (const row of Array.isArray(savedRows) ? savedRows : []) {
    const tk = String(row?.ticker || '').trim().toUpperCase()
    if (!tk) continue
    const views = Array.isArray(row.local_views) ? row.local_views : []
    if (views.length) {
      const prior = viewsByTicker.get(tk) || []
      viewsByTicker.set(tk, prior.concat(views))
    } else if (recentLocalNote(row.generated_at, now, windowMs)) {
      recentBare.add(tk)
    }
  }
  const queue: DeskStep[] = []
  let skipped = 0
  for (const tk of tickers) {
    const views = viewsByTicker.get(tk) || []
    const pending = models.filter((model) => {
      if (memory.has(`${tk}|${model}`)) return false
      if (!views.length && recentBare.has(tk)) return false
      return !views.some(
        (view) => sameModel(view.model, model) && recentLocalNote(view.generated_at, now, windowMs),
      )
    })
    skipped += models.length - pending.length
    if (pending.length) queue.push({ tk, models: pending })
  }
  return { queue, skipped }
}

export function readDeskMemory(now: number, storage: Pick<Storage, 'getItem'>): Set<string> {
  try {
    const raw = storage.getItem(DESK_RUN_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as DeskMemory
    const started = Number(parsed?.startedAt)
    if (!Number.isFinite(started) || now - started > DESK_RUN_MEMORY_MS) return new Set()
    const done = Array.isArray(parsed.done) ? parsed.done.map(String) : []
    return new Set(done)
  } catch {
    return new Set()
  }
}

export function rememberDeskSave(
  tk: string,
  model: string,
  now: number,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
) {
  const key = `${tk.trim().toUpperCase()}|${model}`
  let startedAt = now
  let done: string[] = []
  try {
    const raw = storage.getItem(DESK_RUN_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DeskMemory
      const started = Number(parsed?.startedAt)
      if (Number.isFinite(started) && now - started <= DESK_RUN_MEMORY_MS) {
        startedAt = started
        done = Array.isArray(parsed.done) ? parsed.done.map(String) : []
      }
    }
  } catch {
    startedAt = now
    done = []
  }
  if (!done.includes(key)) done.push(key)
  try {
    storage.setItem(DESK_RUN_KEY, JSON.stringify({ startedAt, done }))
  } catch {
    /* Private mode can refuse the write. The saved note still counts. */
  }
}

export function clearDeskMemory(storage: Pick<Storage, 'removeItem'>) {
  try {
    storage.removeItem(DESK_RUN_KEY)
  } catch {
    /* Ignore a storage that cannot be cleared. */
  }
}
