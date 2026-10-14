/** Research popup helpers. Keep these off ResearchAnswerPage so Desk cards
 *  do not download the answer window on first paint. */

export type ResearchKind = 'analyst' | 'strategist'

export type ResearchSeed = {
  question?: string
  title?: string
  fund_name?: string
  tickers?: string
  answer?: string
  model?: string
  cost_usd?: number
  verification?: unknown
  generated_at?: string
}

const WIN_FEATURES =
  'width=1040,height=900,menubar=no,toolbar=no,location=no,status=no'

function seedKey(kind: ResearchKind, id: string) {
  return `dga.research.${kind}.${id}`
}

export function writeResearchSeed(kind: ResearchKind, id: string, seed: ResearchSeed) {
  try {
    sessionStorage.setItem(seedKey(kind, id), JSON.stringify(seed))
  } catch {
    /* ignore */
  }
}

export function readResearchSeed(kind: ResearchKind, id: string): ResearchSeed | null {
  try {
    const raw = sessionStorage.getItem(seedKey(kind, id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ResearchSeed
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function openResearchWindow(
  kind: ResearchKind,
  id: string,
  seed?: ResearchSeed,
): Window | null {
  const kid = (id || '').trim()
  if (!kid) return null
  if (seed) writeResearchSeed(kind, kid, seed)
  const url = `/gp/research?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(kid)}`
  const name = `dga-research-${kind}-${kid}`
  const win = window.open(url, name, WIN_FEATURES)
  if (!win) return null
  try {
    win.focus()
  } catch {
    /* ignore */
  }
  return win
}

/** Open on the Analyze / Run click (user gesture) so the popup is not blocked. */
export function openPendingResearchWindow(
  kind: ResearchKind,
  hint?: string,
  engine?: string,
): Window | null {
  const q = hint ? `&q=${encodeURIComponent(hint.replace(/\s+/g, ' ').slice(0, 180))}` : ''
  const eng = engine ? `&engine=${encodeURIComponent(engine)}` : ''
  const url = `/gp/research?kind=${encodeURIComponent(kind)}&pending=1${q}${eng}`
  const name = `dga-research-${kind}-live`
  const win = window.open(url, name, WIN_FEATURES)
  if (!win) return null
  try {
    win.focus()
  } catch {
    /* ignore */
  }
  return win
}

export function navigateResearchWindow(
  win: Window | null,
  kind: ResearchKind,
  id: string,
  seed?: ResearchSeed,
): Window | null {
  const kid = (id || '').trim()
  if (!kid) return win
  if (seed) writeResearchSeed(kind, kid, seed)
  const url = `/gp/research?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(kid)}`
  if (win && !win.closed) {
    try {
      win.location.href = url
      win.focus()
      return win
    } catch {
      /* fall through */
    }
  }
  return openResearchWindow(kind, kid, seed)
}
