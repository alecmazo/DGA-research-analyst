import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as RMouseEvent,
} from 'react'
import styles from './DeskBoard.module.css'
import { TicketStatusDot } from './TicketStatusDot'

export type CardId =
  | 'watchlist'
  | 'pulse'
  | 'reports'
  | 'analyst'
  | 'strategist'
  | 'wire'
  | 'mpulse'
  | 'movers'
  | 'analyze'
  | 'health'
  | 'flow'

export type CardLayout = {
  x: number
  y: number
  w: number
  h: number
  collapsed?: boolean
}

export type DeskLayoutMap = Record<CardId, CardLayout>

/**
 * Stable storage key — never bump this for new cards.
 * Versioned legacy keys are read once and migrated so user layouts survive deploys.
 */
const STORAGE_KEY = 'dga.desk.layout'
const LEGACY_KEYS = [
  'dga.desk.layout.v3',
  'dga.desk.layout.v2',
  'dga.desk.layout.v1',
]

/** Defaults only for first visit or brand-new cards the user never placed. */
const DEFAULT_LAYOUT: DeskLayoutMap = {
  watchlist: { x: 0, y: 0, w: 340, h: 420 },
  pulse: { x: 0, y: 436, w: 340, h: 240 },
  mpulse: { x: 0, y: 692, w: 340, h: 400 },
  reports: { x: 356, y: 0, w: 400, h: 420 },
  analyst: { x: 356, y: 436, w: 400, h: 420 },
  strategist: { x: 356, y: 872, w: 400, h: 380 },
  wire: { x: 772, y: 0, w: 400, h: 380 },
  analyze: { x: 772, y: 396, w: 400, h: 220 },
  movers: { x: 772, y: 632, w: 400, h: 460 },
  health: { x: 0, y: 1108, w: 340, h: 180 },
  // Full width, first free row under Portfolio Strategist (health ends at 1288).
  flow: { x: 0, y: 1304, w: 1172, h: 720 },
}

const ALL_IDS = Object.keys(DEFAULT_LAYOUT) as CardId[]

const MIN_W = 260
const MIN_H = 120
const COLLAPSED_H = 44
const BOARD_W = 1172
/** Set once the load-flow card has been seated under Portfolio Strategist. */
const FLOW_UNDER_KEY = 'dga.desk.flow-under-strategist'

function isLayout(v: unknown): v is CardLayout {
  if (!v || typeof v !== 'object') return false
  const o = v as CardLayout
  return (
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.w === 'number' &&
    typeof o.h === 'number'
  )
}

function readRawLayout(): Partial<DeskLayoutMap> | null {
  try {
    for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as Partial<DeskLayoutMap>
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch {
    /* ignore */
  }
  return null
}

function rectH(L: CardLayout): number {
  return L.collapsed ? COLLAPSED_H : L.h
}

function maxBottom(ids: readonly CardId[], map: Partial<DeskLayoutMap>): number {
  let max = 0
  for (const id of ids) {
    const L = map[id]
    if (!isLayout(L)) continue
    max = Math.max(max, L.y + rectH(L))
  }
  return max
}

function overlapsLayout(a: CardLayout, b: CardLayout): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + rectH(b) && a.y + rectH(a) > b.y
}

/** Full-width strip in the first open row under Portfolio Strategist. Not the bottom of the board. */
function flowUnderStrategist(strat: CardLayout, others: CardLayout[]): CardLayout {
  const gap = 16
  const card: CardLayout = {
    x: 0,
    y: strat.y + rectH(strat) + gap,
    w: BOARD_W,
    h: 720,
    collapsed: false,
  }
  for (let n = 0; n < 40; n++) {
    const hit = others.find((o) => overlapsLayout(card, o))
    if (!hit) break
    card.y = hit.y + rectH(hit) + gap
  }
  return card
}

function flowNeedsAnchor(): boolean {
  try {
    return localStorage.getItem(FLOW_UNDER_KEY) !== '1'
  } catch {
    return false
  }
}

function markFlowAnchored(): void {
  try {
    localStorage.setItem(FLOW_UNDER_KEY, '1')
  } catch {
    /* ignore */
  }
}

/**
 * Merge saved user positions onto defaults.
 * - Existing cards keep the user's x/y/w/h/collapsed forever.
 * - New cards (not in saved map) get defaults, or stack below the board if
 *   the default would sit on top of an empty area after a sparse layout.
 */
function withoutMarkets(saved: Partial<DeskLayoutMap> | null): Partial<DeskLayoutMap> | null {
  if (!saved) return saved
  const mk = (saved as { markets?: CardLayout }).markets
  if (!isLayout(mk)) return saved
  const block = (mk.collapsed ? COLLAPSED_H : mk.h) + 16
  const next: Partial<DeskLayoutMap> = { ...saved }
  delete (next as { markets?: CardLayout }).markets
  for (const id of ALL_IDS) {
    const L = next[id]
    if (!isLayout(L)) continue
    const overlaps = L.x < mk.x + mk.w && L.x + L.w > mk.x
    if (overlaps && L.y >= mk.y + (mk.collapsed ? COLLAPSED_H : mk.h) - 4) {
      next[id] = { ...L, y: Math.max(0, L.y - block) }
    }
  }
  return next
}

function mergeLayout(saved: Partial<DeskLayoutMap> | null): DeskLayoutMap {
  saved = withoutMarkets(saved)
  if (!saved) {
    markFlowAnchored()
    return { ...DEFAULT_LAYOUT }
  }

  const out: DeskLayoutMap = { ...DEFAULT_LAYOUT }
  const kept: CardId[] = []
  const missing: CardId[] = []

  for (const id of ALL_IDS) {
    if (isLayout(saved[id])) {
      // User placement wins. Load flow is the exception, seated once under Strategist below.
      out[id] = {
        x: Math.max(0, Number(saved[id]!.x)),
        y: Math.max(0, Number(saved[id]!.y)),
        w: Math.max(MIN_W, Number(saved[id]!.w)),
        h: Math.max(MIN_H, Number(saved[id]!.h)),
        collapsed: !!saved[id]!.collapsed,
      }
      kept.push(id)
    } else {
      missing.push(id)
    }
  }

  // New cards other than load-flow stack below cards the user already placed.
  // Do not measure the defaults of cards that are still missing — that used to
  // drop Load flow hundreds of pixels under the desk.
  const rest = missing.filter((id) => id !== 'flow')
  if (kept.length && rest.length) {
    let y = maxBottom(kept, out) + 16
    for (const id of rest) {
      const def = DEFAULT_LAYOUT[id]
      out[id] = { ...def, x: def.x, y, w: def.w, h: def.h }
      y += def.h + 16
    }
  }

  // Seat Load flow under Portfolio Strategist the first time, and whenever it
  // has no saved slot. After that, a drag sticks.
  if (missing.includes('flow') || flowNeedsAnchor()) {
    const others = ALL_IDS
      .filter((id) => id !== 'flow' && id !== 'strategist')
      .map((id) => out[id])
      .filter(isLayout)
    out.flow = flowUnderStrategist(out.strategist, others)
    markFlowAnchored()
  }

  return out
}

function loadLayout(): DeskLayoutMap {
  const saved = readRawLayout()
  const merged = mergeLayout(saved)
  // Migrate legacy keys → stable key so later deploys never "lose" the layout.
  if (saved) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      for (const k of LEGACY_KEYS) {
        try {
          localStorage.removeItem(k)
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return merged
}

function saveLayout(m: DeskLayoutMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
  } catch {
    /* ignore */
  }
}

type CardDef = {
  id: CardId
  title: string
  badge?: ReactNode
  action?: ReactNode
  flush?: boolean
  children: ReactNode
}

type Props = {
  cards: CardDef[]
  title?: ReactNode
  meta?: ReactNode
  extraActions?: ReactNode
  onRefresh?: () => void
  refreshBusy?: boolean
}

export function DeskBoard({
  cards,
  title,
  meta,
  extraActions,
  onRefresh,
  refreshBusy,
}: Props) {
  const [layout, setLayout] = useState<DeskLayoutMap>(() => loadLayout())
  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    id: CardId
    mode: 'move' | 'resize'
    startX: number
    startY: number
    orig: CardLayout
  } | null>(null)
  const [zTop, setZTop] = useState<CardId | null>(null)

  const persist = useCallback((next: DeskLayoutMap) => {
    setLayout(next)
    saveLayout(next)
  }, [])

  const patch = useCallback(
    (id: CardId, partial: Partial<CardLayout>) => {
      setLayout((prev) => {
        const next = { ...prev, [id]: { ...prev[id], ...partial } }
        saveLayout(next)
        return next
      })
    },
    [],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (d.mode === 'move') {
        patch(d.id, {
          x: Math.max(0, d.orig.x + dx),
          y: Math.max(0, d.orig.y + dy),
        })
      } else {
        patch(d.id, {
          w: Math.max(MIN_W, d.orig.w + dx),
          h: Math.max(MIN_H, d.orig.h + dy),
          collapsed: false,
        })
      }
    }
    const onUp = () => {
      dragRef.current = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [patch])

  const startMove = (id: CardId, e: RMouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea'))
      return
    e.preventDefault()
    setZTop(id)
    dragRef.current = {
      id,
      mode: 'move',
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...layout[id] },
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
  }

  const startResize = (id: CardId, e: RMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setZTop(id)
    dragRef.current = {
      id,
      mode: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...layout[id] },
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'nwse-resize'
  }

  const boardH = useMemo(() => {
    let max = 640
    for (const id of Object.keys(layout) as CardId[]) {
      const L = layout[id]
      const h = L.collapsed ? COLLAPSED_H : L.h
      max = Math.max(max, L.y + h + 24)
    }
    return max
  }, [layout])

  const reset = () => {
    if (
      !window.confirm(
        'Reset desk layout to defaults? Your current card positions will be replaced.',
      )
    )
      return
    persist({ ...DEFAULT_LAYOUT })
  }

  const setAllCollapsed = (collapsed: boolean) => {
    setLayout((prev) => {
      const next = { ...prev }
      for (const id of ALL_IDS) {
        if (!isLayout(next[id])) continue
        next[id] = { ...next[id], collapsed }
      }
      saveLayout(next)
      return next
    })
  }

  const toggleCollapsed = (id: CardId) => {
    setLayout((prev) => {
      const cur = prev[id] || DEFAULT_LAYOUT[id]
      const next = {
        ...prev,
        [id]: { ...cur, collapsed: !cur.collapsed },
      }
      saveLayout(next)
      return next
    })
    setZTop(id)
  }

  // Re-merge if product ships new card ids while the tab is open (hot reload).
  useEffect(() => {
    setLayout((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of ALL_IDS) {
        if (!isLayout(next[id])) {
          changed = true
          break
        }
      }
      if (!changed) return prev
      const merged = mergeLayout(prev)
      saveLayout(merged)
      return merged
    })
  }, [])

  return (
    <div className={styles.wrap}>
      <div className={styles.hintBar}>
        <div className={styles.hintLeft}>
          {title != null && <strong className={styles.deskTitle}>{title}</strong>}
          {meta != null && <span className={styles.deskMeta}>{meta}</span>}
          <span className={styles.hintText}>
            Drag to move · resize corner · click title to collapse
          </span>
        </div>
        <div className={styles.hintActions}>
          {extraActions}
          {refreshBusy ? (
            <span className={styles.refreshingNow} aria-live="polite" aria-busy="true">
              Refreshing<span className={styles.refreshDots} />
            </span>
          ) : null}
          <select
            className={`${styles.deskPull} ${refreshBusy ? styles.deskPullBusy : ''}`}
            value=""
            disabled={refreshBusy}
            aria-label="Desk actions"
            aria-busy={refreshBusy || undefined}
            title="Refresh, collapse, expand, or reset layout"
            onChange={(e) => {
              const v = e.target.value
              e.currentTarget.value = ''
              if (refreshBusy) return
              if (v === 'refresh') onRefresh?.()
              else if (v === 'collapse') setAllCollapsed(true)
              else if (v === 'expand') setAllCollapsed(false)
              else if (v === 'reset') reset()
            }}
          >
            <option value="" disabled>
              {refreshBusy ? 'Refreshing...' : 'Desk'}
            </option>
            <option value="refresh">Refresh</option>
            <option value="collapse">Collapse all</option>
            <option value="expand">Expand all</option>
            <option value="reset">Reset layout</option>
          </select>
          <TicketStatusDot />
        </div>
      </div>
      <div
        ref={boardRef}
        className={styles.board}
        style={{ minHeight: boardH }}
      >
        {cards.map((card) => {
          const L = layout[card.id] || DEFAULT_LAYOUT[card.id]
          const collapsed = !!L.collapsed
          const h = collapsed ? COLLAPSED_H : L.h
          return (
            <section
              key={card.id}
              data-desk-widget={card.id}
              data-collapsed={collapsed ? '1' : '0'}
              className={`${styles.card} ${collapsed ? styles.collapsed : ''}`}
              style={{
                left: L.x,
                top: L.y,
                width: L.w,
                height: h,
                zIndex: zTop === card.id ? 20 : 5,
              }}
            >
              <header
                className={styles.head}
                onMouseDown={(e) => startMove(card.id, e)}
                onDoubleClick={(e) => {
                  // Double-click header (not controls) toggles collapse
                  if (
                    (e.target as HTMLElement).closest(
                      'button, a, input, select, textarea',
                    )
                  )
                    return
                  e.preventDefault()
                  toggleCollapsed(card.id)
                }}
              >
                <button
                  type="button"
                  className={styles.collapse}
                  title={collapsed ? 'Expand card' : 'Collapse card'}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `Expand ${card.title}` : `Collapse ${card.title}`}
                  onMouseDown={(e) => {
                    // Never start a drag from the chevron
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleCollapsed(card.id)
                  }}
                >
                  <span className={styles.collapseIcon} aria-hidden>
                    {collapsed ? '▸' : '▾'}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.titleWrap}
                  title={
                    collapsed
                      ? 'Click to expand · drag ⠿ to move'
                      : 'Click to collapse · drag ⠿ to move'
                  }
                  onMouseDown={(e) => {
                    // Allow drag from title area (not a form control for startMove skip)
                    // but click still toggles — handled below via click without drag
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleCollapsed(card.id)
                  }}
                >
                  <h2 className={styles.title}>{card.title}</h2>
                  {card.badge != null && (
                    <span className={styles.badge}>{card.badge}</span>
                  )}
                  {collapsed && (
                    <span className={styles.collapsedHint}>collapsed</span>
                  )}
                </button>
                {card.action != null && !collapsed && (
                  <div
                    className={styles.action}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {card.action}
                  </div>
                )}
                <span
                  className={styles.dragHint}
                  title="Drag to move"
                  onMouseDown={(e) => startMove(card.id, e)}
                >
                  ⠿
                </span>
              </header>
              {!collapsed && (
                <div
                  className={
                    card.flush ? styles.bodyFlush : styles.body
                  }
                >
                  {card.children}
                </div>
              )}
              {!collapsed && (
                <div
                  className={styles.resize}
                  onMouseDown={(e) => startResize(card.id, e)}
                  title="Drag to resize"
                />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
