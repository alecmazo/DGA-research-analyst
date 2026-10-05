/** Live map of site calls onto the boot flowchart.

Green is loaded, yellow is in flight, red is a failed call.
A branch that has not run stays hollow so red means a real failure.
Desk order matches the stagger in deskBoot: the watchlist first, then the cards.
*/

export type Phase = 'idle' | 'loading' | 'loaded' | 'failed'

export type LeafSnap = {
  inflight: number
  everOk: boolean
  last: 'ok' | 'fail' | null
  ms: number | null
  error: string | null
  path: string | null
}

export type FlowNode = {
  id: string
  label: string
  hint: string
  /** Step in the desk stagger. Same number means those calls start together. */
  step?: string
  /** Desk card to scroll into view. */
  widget?: string
  /** In-app route (basename /gp). */
  to?: string
  children?: FlowNode[]
}

export type FlowBox = {
  id: string
  label: string
  hint: string
  step?: string
  widget?: string
  to?: string
  phase: Phase
  refreshing: boolean
  leaf: LeafSnap | null
  failedLabels: string[]
  x: number
  y: number
  w: number
  h: number
  children: FlowBox[]
}

export type LoadSnapshot = {
  rev: number
  leaves: Record<string, LeafSnap>
}

type Rule = { id: string; test: (path: string) => boolean }

const NODE_W = 148
const NODE_H = 26
const GAP_X = 18
const GAP_Y = 22
/** A parent with more children than this wraps them, unless a child is tall. */
const FAN = 4
const PAD = 16

export const FLOW_NODE_W = NODE_W
export const FLOW_NODE_H = NODE_H
export const FLOW_GAP_X = GAP_X

function isExact(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}?`)
}

/** Most specific path first. The first match owns the call. */
const RULES: Rule[] = [
  { id: 'me', test: (p) => isExact(p, '/api/auth/v2/me') },
  { id: 'build', test: (p) => isExact(p, '/api/build') },
  { id: 'watchlist', test: (p) => p.startsWith('/api/watchlist') },
  { id: 'earnings', test: (p) => p.startsWith('/api/earnings') },
  { id: 'indices', test: (p) => p.startsWith('/api/market/indices') },
  { id: 'tickets', test: (p) => p.startsWith('/api/support/open-count') },
  { id: 'brief', test: (p) => p.startsWith('/api/daily-brief') },
  {
    id: 'reportWindow',
    test: (p) =>
      p.startsWith('/api/report/') ||
      isExact(p, '/api/report') ||
      p.startsWith('/api/download/') ||
      p.includes('/valuation') ||
      p.includes('/dcf-user'),
  },
  {
    id: 'localBooks',
    test: (p) =>
      p.startsWith('/api/local/reports') ||
      p.startsWith('/api/local/portfolios') ||
      p.startsWith('/api/local/portfolio'),
  },
  { id: 'reports', test: (p) => p.startsWith('/api/reports') },
  { id: 'movers', test: (p) => p.startsWith('/api/market/movers') },
  {
    id: 'headlines',
    test: (p) =>
      p.startsWith('/api/market/pulse') && p.includes('merge=') && p.includes('tickers='),
  },
  { id: 'pulse', test: (p) => p.startsWith('/api/market/pulse') },
  { id: 'metrics', test: (p) => p.startsWith('/api/financials/metrics') },
  { id: 'sec', test: (p) => p.startsWith('/api/financials/desk-notice') },
  { id: 'wire', test: (p) => p.startsWith('/api/v2/news') },
  { id: 'analyst', test: (p) => p.startsWith('/api/research/analyst') },
  {
    id: 'agentic',
    test: (p) => p.startsWith('/api/research/agentic') || p.startsWith('/api/research/email-pdf'),
  },
  { id: 'stratReviews', test: (p) => p.startsWith('/api/research/strategist') },
  { id: 'funds', test: (p) => p.startsWith('/api/fund/list') },
  { id: 'analyze', test: (p) => p.startsWith('/api/analyze') || p.startsWith('/api/jobs') },
  { id: 'peek', test: (p) => p.startsWith('/api/stock-info') || p.startsWith('/api/quote/') },
  { id: 'coverage', test: (p) => p.startsWith('/api/financials/coverage') },
  {
    id: 'finStore',
    test: (p) =>
      p.startsWith('/api/financials/settings') ||
      p.startsWith('/api/financials/universes') ||
      p.startsWith('/api/financials/sync') ||
      p.startsWith('/api/financials/backup') ||
      p.startsWith('/api/financials/sheet-links'),
  },
  {
    id: 'settings',
    test: (p) =>
      p.startsWith('/api/config') ||
      p.startsWith('/api/automation') ||
      p.startsWith('/api/snaptrade') ||
      p.startsWith('/api/plaid') ||
      p.startsWith('/api/diagnostics') ||
      p.startsWith('/api/continuity') ||
      p.startsWith('/api/auth/v2/') ||
      p.startsWith('/api/v2/admin') ||
      p.startsWith('/api/v2/gp/email') ||
      p.startsWith('/api/support') ||
      p.startsWith('/api/financials/overnight'),
  },
  { id: 'company', test: (p) => p.startsWith('/api/financials/') },
  { id: 'ollama', test: (p) => p.startsWith('ollama://') },
  { id: 'localStatus', test: (p) => p.startsWith('/api/local/status') },
  { id: 'localAsk', test: (p) => p.startsWith('/api/local') },
  { id: 'podcasts', test: (p) => p.startsWith('/api/podcast') || p.startsWith('/api/v2/lab') },
  { id: 'calls', test: (p) => p.startsWith('/api/transcripts') },
  { id: 'munger', test: (p) => p.startsWith('/api/munger') },
  { id: 'mergerArb', test: (p) => p.startsWith('/api/merger-arb') },
  { id: 'gurus', test: (p) => p.startsWith('/api/gurus') },
  { id: 'credit', test: (p) => p.startsWith('/api/credit') },
  { id: 'builder', test: (p) => p.startsWith('/api/v2/builder') },
  { id: 'options', test: (p) => p.startsWith('/api/options') },
  {
    id: 'positions',
    test: (p) => p.startsWith('/api/v2/lp/me/positions') || p.startsWith('/api/fund/positions'),
  },
  { id: 'memos', test: (p) => p.startsWith('/api/memos') || p.startsWith('/api/quarterly-letter') },
  {
    id: 'accountBook',
    test: (p) => p.startsWith('/api/v2/lp') || p.startsWith('/api/v2/gp') || p.startsWith('/api/fund'),
  },
]

export const LEAF_IDS: ReadonlySet<string> = new Set([...RULES.map((rule) => rule.id), 'other'])

/** The site, in the order it actually comes up. */
export const FLOW_ROOT: FlowNode = {
  id: 'gp',
  label: 'GP Terminal',
  hint: 'Main trunk. Branches fill in as each call finishes.',
  children: [
    {
      id: 'session',
      label: 'Session',
      hint: 'Before the shell. Me and the build run together.',
      children: [
        { id: 'me', label: 'Me', hint: 'Who is signed in.', step: '1' },
        { id: 'build', label: 'Build', hint: 'Which build this page is.', step: '1' },
      ],
    },
    {
      id: 'desk',
      label: 'Desk',
      hint: 'Watchlist owns the worker, then the cards stagger.',
      children: [
        {
          id: 'watchlist',
          label: 'Watchlist',
          hint: 'First. The list owns the one worker.',
          step: '1',
          widget: 'watchlist',
          children: [
            {
              id: 'earnings',
              label: 'Earnings',
              hint: 'When you open an earnings chip.',
              widget: 'watchlist',
            },
          ],
        },
        {
          id: 'indices',
          label: 'Indices',
          hint: 'Ribbon, as soon as the list settles.',
          step: '2',
        },
        {
          id: 'tickets',
          label: 'Tickets',
          hint: 'Open-ticket light, with the ribbon.',
          step: '2',
        },
        {
          id: 'brief',
          label: 'Brief',
          hint: 'Daily pulse, 600ms after the list.',
          step: '3',
          widget: 'pulse',
        },
        {
          id: 'reports',
          label: 'Reports',
          hint: 'Saved notes, 800ms after the list.',
          step: '4',
          widget: 'reports',
          children: [
            {
              id: 'reportWindow',
              label: 'Window',
              hint: 'A report, valuation, or download.',
              widget: 'reports',
            },
          ],
        },
        {
          id: 'movers',
          label: 'Movers',
          hint: 'Top movers, 900ms after the list.',
          step: '5',
          widget: 'movers',
          children: [
            {
              id: 'headlines',
              label: 'Headlines',
              hint: 'Opens when you click a mover row.',
              widget: 'movers',
            },
          ],
        },
        {
          id: 'wire',
          label: 'Wire',
          hint: 'Market wire, 1s after the list.',
          step: '6',
          widget: 'wire',
        },
        {
          id: 'analyst',
          label: 'Analyst',
          hint: 'Saved reviews, 1.1s after the list.',
          step: '7',
          widget: 'analyst',
          children: [
            {
              id: 'agentic',
              label: 'Run',
              hint: 'A research job, when you ask.',
              widget: 'analyst',
            },
          ],
        },
        {
          id: 'strategist',
          label: 'Strategist',
          hint: 'Book and reviews, 1.1s after the list.',
          step: '7',
          widget: 'strategist',
          children: [
            {
              id: 'funds',
              label: 'Funds',
              hint: 'Fund list for the strategist.',
              widget: 'strategist',
            },
            {
              id: 'stratReviews',
              label: 'Reviews',
              hint: 'Saved strategist reviews.',
              widget: 'strategist',
            },
          ],
        },
        {
          id: 'pulse',
          label: 'Pulse',
          hint: 'Headlines, 1.2s after the list.',
          step: '8',
          widget: 'mpulse',
          children: [
            {
              id: 'metrics',
              label: 'Metrics',
              hint: 'Pulse figures, 1.4s after the list.',
              widget: 'mpulse',
            },
          ],
        },
        {
          id: 'sec',
          label: 'SEC',
          hint: 'Filing notice after the list.',
          step: '9',
        },
        {
          id: 'analyze',
          label: 'Analyze',
          hint: 'Resumes a job when the list settles.',
          widget: 'analyze',
        },
        {
          id: 'peek',
          label: 'Peek',
          hint: 'Snapshot when you open a ticker.',
          widget: 'watchlist',
        },
      ],
    },
    {
      id: 'financials',
      label: 'Financials',
      hint: 'Opens when you go to Financials.',
      to: '/financials',
      children: [
        { id: 'coverage', label: 'Coverage', hint: 'Coverage list.', to: '/financials' },
        {
          id: 'company',
          label: 'Company',
          hint: 'A company dashboard, sheet, or comps.',
          to: '/financials',
        },
        {
          id: 'finStore',
          label: 'Store',
          hint: 'Settings, universes, and sync.',
          to: '/financials',
        },
      ],
    },
    {
      id: 'local',
      label: 'Local',
      hint: 'Opens when you go to Local.',
      to: '/local',
      children: [
        {
          id: 'ollama',
          label: 'Ollama',
          hint: 'This Mac. Tags, ensure, or a chat.',
          to: '/local',
        },
        {
          id: 'localStatus',
          label: 'Status',
          hint: 'Site status for the local model.',
          to: '/local',
        },
        { id: 'localAsk', label: 'Ask', hint: 'A local question or save.', to: '/local' },
        {
          id: 'localBooks',
          label: 'Books',
          hint: 'Portfolios and local reports.',
          to: '/local',
        },
      ],
    },
    { id: 'builder', label: 'Watchlists', hint: 'Lists and scenarios.', to: '/builder' },
    { id: 'gurus', label: 'Gurus', hint: 'Guru filings.', to: '/gurus' },
    { id: 'podcasts', label: 'Podcasts', hint: 'Scripts, episodes, and votes.', to: '/podcasts' },
    {
      id: 'lab',
      label: 'Lab',
      hint: 'Credit, transcripts, Munger, and merger arb.',
      to: '/credit',
      children: [
        { id: 'credit', label: 'Credit', hint: 'Bond issuers and a typed-in book.', to: '/credit' },
        { id: 'calls', label: 'Transcripts', hint: 'Calls and the library.', to: '/transcripts' },
        { id: 'munger', label: 'Munger', hint: 'Munger desk.', to: '/munger' },
        {
          id: 'mergerArb',
          label: 'Merger Arb',
          hint: 'Deal list and the analysis packet.',
          to: '/merger-arb',
        },
      ],
    },
    {
      id: 'accounts',
      label: 'Accounts',
      hint: 'Funds, NAV, and the book.',
      to: '/fund',
      children: [
        { id: 'positions', label: 'Positions', hint: 'Holdings.', to: '/positions' },
        { id: 'options', label: 'Options', hint: 'Wheel scan, when you run it.', to: '/options' },
        { id: 'accountBook', label: 'Book', hint: 'Overview, NAV, and fund edits.', to: '/fund' },
      ],
    },
    { id: 'memos', label: 'Memos', hint: 'Letters and memos.', to: '/memos' },
    {
      id: 'settings',
      label: 'Settings',
      hint: 'Models, connections, users, support.',
      to: '/settings',
    },
    { id: 'other', label: 'Other', hint: 'A call that does not match a branch.' },
  ],
}

const listeners = new Set<() => void>()
const leaves = new Map<string, LeafSnap>()
let rev = 0
let snapshot: LoadSnapshot = { rev: 0, leaves: {} }

function blank(): LeafSnap {
  return { inflight: 0, everOk: false, last: null, ms: null, error: null, path: null }
}

function emit() {
  rev += 1
  const next: Record<string, LeafSnap> = {}
  for (const [id, leaf] of leaves) next[id] = { ...leaf }
  snapshot = { rev, leaves: next }
  for (const fn of listeners) fn()
}

export function getLoadSnapshot(): LoadSnapshot {
  return snapshot
}

export function subscribeLoadFlow(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function resetLoadFlow(): void {
  leaves.clear()
  emit()
}

export function normalizeLoadPath(path: string): string {
  if (!path) return '/'
  if (path.startsWith('ollama://')) return path
  try {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const url = new URL(path)
      return `${url.pathname}${url.search}`
    }
  } catch {
    /* keep the raw path */
  }
  const hash = path.indexOf('#')
  return hash >= 0 ? path.slice(0, hash) : path
}

export function matchLeaf(path: string): string {
  const normalized = normalizeLoadPath(path)
  for (const rule of RULES) {
    if (rule.test(normalized)) return rule.id
  }
  return 'other'
}

/** Start a call. The returned finish is safe to call twice. */
export function trackLoad(path: string): (result?: 'ok' | 'fail', error?: string | null) => void {
  const id = matchLeaf(path)
  const normalized = normalizeLoadPath(path)
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let leaf = leaves.get(id)
  if (!leaf) {
    leaf = blank()
    leaves.set(id, leaf)
  }
  leaf.inflight += 1
  leaf.path = normalized
  emit()
  let closed = false
  return (result: 'ok' | 'fail' = 'ok', error: string | null = null) => {
    if (closed) return
    closed = true
    const current = leaves.get(id) || leaf
    current.inflight = Math.max(0, current.inflight - 1)
    current.ms = Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started))
    current.path = normalized
    if (result === 'ok') {
      current.everOk = true
      current.last = 'ok'
      current.error = null
    } else {
      current.last = 'fail'
      current.error = (error || 'failed').slice(0, 180)
    }
    emit()
  }
}

export function leafPhase(leaf: LeafSnap | undefined): Phase {
  if (!leaf || (leaf.inflight === 0 && !leaf.everOk && leaf.last == null)) return 'idle'
  if (leaf.inflight > 0 && (!leaf.everOk || leaf.last === 'fail')) return 'loading'
  if (leaf.last === 'fail' && leaf.inflight === 0) return 'failed'
  if (leaf.everOk || leaf.last === 'ok') return 'loaded'
  return 'idle'
}

export function rollupPhase(phases: Phase[]): Phase {
  if (phases.some((phase) => phase === 'loading')) return 'loading'
  if (phases.some((phase) => phase === 'failed')) return 'failed'
  if (phases.some((phase) => phase === 'loaded')) return 'loaded'
  return 'idle'
}

export function countLeafPhases(map: Record<string, LeafSnap>): Record<Phase, number> {
  const counts: Record<Phase, number> = { idle: 0, loading: 0, loaded: 0, failed: 0 }
  for (const id of LEAF_IDS) {
    const phase = leafPhase(map[id])
    if (id === 'other' && phase === 'idle') continue
    counts[phase] += 1
  }
  return counts
}

function shownChildren(node: FlowNode, map: Record<string, LeafSnap>): FlowNode[] {
  return (node.children || []).filter((child) => {
    if (child.id !== 'other') return true
    return leafPhase(map.other) !== 'idle'
  })
}

function rowsOf<T>(items: T[], n: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n))
  return rows
}

/** Many small branches wrap into centered rows. A tall branch stays on the spine. */
function wrapKids(sizes: { w: number; h: number }[]): boolean {
  const shallow = NODE_H + GAP_Y + NODE_H + 1
  return sizes.length > FAN && sizes.every((size) => size.h <= shallow)
}

function subtreeSize(node: FlowNode, map: Record<string, LeafSnap>): { w: number; h: number } {
  const kids = shownChildren(node, map)
  if (!kids.length) return { w: NODE_W, h: NODE_H }
  const sizes = kids.map((kid) => subtreeSize(kid, map))
  if (!wrapKids(sizes) && kids.length > FAN) {
    const colW = Math.max(NODE_W, ...sizes.map((size) => size.w))
    const h =
      NODE_H +
      GAP_Y +
      sizes.reduce((sum, size) => sum + size.h, 0) +
      GAP_Y * (kids.length - 1)
    return { w: colW, h }
  }
  const groups = wrapKids(sizes) ? rowsOf(sizes, FAN) : [sizes]
  let rowW = 0
  let rowsH = 0
  for (const row of groups) {
    rowW = Math.max(rowW, row.reduce((sum, size) => sum + size.w, 0) + GAP_X * (row.length - 1))
    rowsH += Math.max(...row.map((size) => size.h))
  }
  rowsH += GAP_Y * (groups.length - 1)
  return { w: Math.max(NODE_W, rowW), h: NODE_H + GAP_Y + rowsH }
}

function place(node: FlowNode, map: Record<string, LeafSnap>, left: number, top: number): FlowBox {
  const kids = shownChildren(node, map)
  const size = subtreeSize(node, map)
  const children: FlowBox[] = []
  const sizes = kids.map((kid) => subtreeSize(kid, map))
  if (kids.length > FAN && !wrapKids(sizes)) {
    let cursor = top + NODE_H + GAP_Y
    kids.forEach((kid, i) => {
      const kidLeft = left + (size.w - sizes[i].w) / 2
      children.push(place(kid, map, kidLeft, cursor))
      cursor += sizes[i].h + GAP_Y
    })
  } else if (kids.length) {
    const paired = kids.map((kid, i) => ({ kid, size: sizes[i] }))
    const groups = wrapKids(sizes) ? rowsOf(paired, FAN) : [paired]
    let childTop = top + NODE_H + GAP_Y
    for (const row of groups) {
      const rowW = row.reduce((sum, item) => sum + item.size.w, 0) + GAP_X * (row.length - 1)
      let cursor = left + (size.w - rowW) / 2
      const rowH = Math.max(...row.map((item) => item.size.h))
      for (const item of row) {
        children.push(place(item.kid, map, cursor, childTop))
        cursor += item.size.w + GAP_X
      }
      childTop += rowH + GAP_Y
    }
  }
  const tracked = LEAF_IDS.has(node.id)
  const own = tracked ? leafPhase(map[node.id]) : null
  const phase = rollupPhase(own == null ? children.map((child) => child.phase) : [own, ...children.map((child) => child.phase)])
  const leaf = tracked ? map[node.id] || null : null
  const failedLabels = [
    ...(own === 'failed' ? [node.label] : []),
    ...children.flatMap((child) => child.failedLabels),
  ]
  return {
    id: node.id,
    label: node.label,
    hint: node.hint,
    step: node.step,
    widget: node.widget,
    to: node.to,
    phase,
    refreshing: !!leaf && leaf.inflight > 0 && own === 'loaded',
    leaf,
    failedLabels,
    x: left + (size.w - NODE_W) / 2,
    y: top,
    w: NODE_W,
    h: NODE_H,
    children,
  }
}

function bounds(root: FlowBox): { width: number; height: number } {
  let maxX = 0
  let maxY = 0
  const walk = (box: FlowBox) => {
    maxX = Math.max(maxX, box.x + box.w)
    maxY = Math.max(maxY, box.y + box.h)
    box.children.forEach(walk)
  }
  walk(root)
  return { width: maxX + PAD, height: maxY + PAD }
}

export function buildFlow(map: Record<string, LeafSnap> = {}): {
  root: FlowBox
  width: number
  height: number
} {
  const root = place(FLOW_ROOT, map, PAD, PAD)
  return { root, ...bounds(root) }
}

function subtreeBottom(box: FlowBox): number {
  let bottom = box.y + box.h
  for (const child of box.children) bottom = Math.max(bottom, subtreeBottom(child))
  return bottom
}

/** Rows share a y. Everything else is a later row down the page. */
function linkRows(kids: FlowBox[]): FlowBox[][] {
  const rows: FlowBox[][] = []
  const sorted = [...kids].sort((a, b) => a.y - b.y || a.x - b.x)
  for (const kid of sorted) {
    const row = rows.find((group) => Math.abs(group[0].y - kid.y) < 1)
    if (row) row.push(kid)
    else rows.push([kid])
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x)
  return rows
}

export function flowLinks(box: FlowBox): { trunk: string; stubs: { id: string; d: string }[] } | null {
  const kids = box.children
  if (!kids.length) return null
  const px = box.x + box.w / 2
  const rows = linkRows(kids)
  const trunk: string[] = []
  const stubs: { id: string; d: string }[] = []
  let yFrom = box.y + box.h
  for (const row of rows) {
    const yBus = (yFrom + row[0].y) / 2
    if (row.length === 1) {
      const kid = row[0]
      const cx = kid.x + kid.w / 2
      const d =
        Math.abs(cx - px) < 0.5
          ? `M ${px} ${yFrom} V ${kid.y}`
          : `M ${px} ${yFrom} V ${yBus} H ${cx} V ${kid.y}`
      stubs.push({ id: kid.id, d })
    } else {
      const centers = row.map((kid) => kid.x + kid.w / 2)
      const xL = Math.min(...centers, px)
      const xR = Math.max(...centers, px)
      trunk.push(`M ${px} ${yFrom} V ${yBus}`)
      if (xR - xL > 0.5) trunk.push(`M ${xL} ${yBus} H ${xR}`)
      for (const kid of row) {
        const cx = kid.x + kid.w / 2
        stubs.push({ id: kid.id, d: `M ${cx} ${yBus} V ${kid.y}` })
      }
    }
    yFrom = Math.max(...row.map(subtreeBottom))
  }
  return { trunk: trunk.join(' '), stubs }
}

export function walkFlow(root: FlowBox, visit: (box: FlowBox) => void): void {
  visit(root)
  root.children.forEach((child) => walkFlow(child, visit))
}

export function findFlowBox(root: FlowBox, id: string): FlowBox | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findFlowBox(child, id)
    if (found) return found
  }
  return null
}
