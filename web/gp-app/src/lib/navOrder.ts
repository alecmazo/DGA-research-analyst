/** Order of the top menu. The first page is what opens with the portal. */

export const NAV_ORDER_KEY = 'dga.nav.order'

export const NAV_IDS = [
  'desk',
  'financials',
  'ideas',
  'builder',
  'gurus',
  'podcasts',
  'transcripts',
  'book',
  'options',
  'credit',
  'merger',
  'munger',
  'local',
] as const

export type NavId = (typeof NAV_IDS)[number]

const PAGES: Record<NavId, string | null> = {
  desk: '/desk',
  financials: '/financials',
  ideas: '/ideas',
  builder: '/builder',
  gurus: '/gurus',
  podcasts: '/podcasts',
  transcripts: '/transcripts',
  book: null,
  options: '/options',
  credit: '/credit',
  merger: '/merger-arb',
  munger: '/munger',
  local: '/local',
}

const ID_SET = new Set<string>(NAV_IDS)

export function normalizeNavOrder(raw: unknown): NavId[] {
  const seen = new Set<NavId>()
  const out: NavId[] = []
  const list = Array.isArray(raw) ? raw : []
  for (const item of list) {
    const id = String(item)
    if (!ID_SET.has(id) || seen.has(id as NavId)) continue
    seen.add(id as NavId)
    out.push(id as NavId)
  }
  for (const id of NAV_IDS) {
    if (!seen.has(id)) out.push(id)
  }
  return out
}

export function readNavOrder(): NavId[] {
  try {
    return normalizeNavOrder(JSON.parse(localStorage.getItem(NAV_ORDER_KEY) || '[]'))
  } catch {
    return [...NAV_IDS]
  }
}

export function writeNavOrder(order: readonly NavId[]): NavId[] {
  const next = normalizeNavOrder([...order])
  localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next))
  return next
}

/** Move one item one place among the items the bar is showing. */
export function shiftNav(
  order: readonly NavId[],
  id: NavId,
  dir: -1 | 1,
  visible?: readonly NavId[],
): NavId[] {
  const base = normalizeNavOrder([...order])
  const view = (visible || base).filter((item) => base.includes(item))
  const i = view.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= view.length) return base
  const next = base.filter((item) => item !== id)
  const at = next.indexOf(view[j])
  next.splice(dir < 0 ? at : at + 1, 0, id)
  return normalizeNavOrder(next)
}

/** Drop `id` immediately in front of `before`. */
export function placeNavBefore(order: readonly NavId[], id: NavId, before: NavId): NavId[] {
  const base = normalizeNavOrder([...order])
  if (id === before || !base.includes(id) || !base.includes(before)) return base
  const next = base.filter((item) => item !== id)
  next.splice(next.indexOf(before), 0, id)
  return normalizeNavOrder(next)
}

/** First real page in the menu. Book is a menu, and On this Mac only counts on that Mac. */
export function portalHomePath(onMac: boolean, order: readonly NavId[] = readNavOrder()): string {
  for (const id of normalizeNavOrder([...order])) {
    if (id === 'local' && !onMac) continue
    const path = PAGES[id]
    if (path) return path
  }
  return '/desk'
}

export function isDeskPath(pathname: string): boolean {
  return pathname === '/' || pathname === '' || pathname === '/desk'
}
