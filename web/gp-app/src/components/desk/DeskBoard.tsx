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

export type CardId =
  | 'watchlist'
  | 'pulse'
  | 'reports'
  | 'analyst'
  | 'strategist'
  | 'markets'
  | 'wire'
  | 'mpulse'
  | 'ideas'
  | 'analyze'
  | 'health'

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
  markets: { x: 772, y: 0, w: 400, h: 280 },
  wire: { x: 772, y: 296, w: 400, h: 380 },
  ideas: { x: 772, y: 692, w: 400, h: 280 },
  analyze: { x: 772, y: 988, w: 400, h: 220 },
  health: { x: 0, y: 1108, w: 340, h: 180 },
}

const ALL_IDS = Object.keys(DEFAULT_LAYOUT) as CardId[]

const MIN_W = 260
const MIN_H = 120
const COLLAPSED_H = 44

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

function maxBottom(map: Partial<DeskLayoutMap>): number {
  let max = 0
  for (const id of ALL_IDS) {
    const L = map[id]
    if (!isLayout(L)) continue
    const h = L.collapsed ? COLLAPSED_H : L.h
    max = Math.max(max, L.y + h)
  }
  return max
}

/**
 * Merge saved user positions onto defaults.
 * - Existing cards keep the user's x/y/w/h/collapsed forever.
 * - New cards (not in saved map) get defaults, or stack below the board if
 *   the default would sit on top of an empty area after a sparse layout.
 */
function mergeLayout(saved: Partial<DeskLayoutMap> | null): DeskLayoutMap {
  if (!saved) return { ...DEFAULT_LAYOUT }

  const out: DeskLayoutMap = { ...DEFAULT_LAYOUT }
  const kept: CardId[] = []
  const missing: CardId[] = []

  for (const id of ALL_IDS) {
    if (isLayout(saved[id])) {
      // User placement always wins — never re-apply DEFAULT positions for known cards.
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

  // Place brand-new cards in a free strip below whatever the user already has,
  // so an update that adds "analyst" never shoves it on top of their layout.
  if (kept.length && missing.length) {
    let y = maxBottom(out) + 16
    for (const id of missing) {
      const def = DEFAULT_LAYOUT[id]
      out[id] = { ...def, x: def.x, y, w: def.w, h: def.h }
      y += def.h + 16
    }
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
}

export function DeskBoard({ cards }: Props) {
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
        <span>
          Drag ⠿ to move · corner to resize · chevron or title to collapse/expand ·
          layout saved automatically
        </span>
        <div className={styles.hintActions}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => setAllCollapsed(true)}
            title="Collapse every desk card"
          >
            Collapse all
          </button>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => setAllCollapsed(false)}
            title="Expand every desk card"
          >
            Expand all
          </button>
          <button type="button" className={styles.resetBtn} onClick={reset}>
            Reset layout
          </button>
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
