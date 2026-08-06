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
  | 'markets'
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

const STORAGE_KEY = 'dga.desk.layout.v2'

const DEFAULT_LAYOUT: DeskLayoutMap = {
  watchlist: { x: 0, y: 0, w: 340, h: 420 },
  pulse: { x: 0, y: 436, w: 340, h: 280 },
  reports: { x: 356, y: 0, w: 400, h: 560 },
  markets: { x: 772, y: 0, w: 400, h: 420 },
  ideas: { x: 772, y: 436, w: 400, h: 320 },
  analyze: { x: 772, y: 772, w: 400, h: 220 },
  health: { x: 356, y: 576, w: 400, h: 200 },
}

const MIN_W = 260
const MIN_H = 120
const COLLAPSED_H = 44

function loadLayout(): DeskLayoutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_LAYOUT }
    const parsed = JSON.parse(raw) as Partial<DeskLayoutMap>
    const out = { ...DEFAULT_LAYOUT }
    for (const id of Object.keys(DEFAULT_LAYOUT) as CardId[]) {
      if (parsed[id] && typeof parsed[id]!.x === 'number') {
        out[id] = { ...DEFAULT_LAYOUT[id], ...parsed[id] }
      }
    }
    return out
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
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
    persist({ ...DEFAULT_LAYOUT })
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.hintBar}>
        <span>
          Drag card headers to move · bottom-right corner to resize · ▾ to
          collapse
        </span>
        <button type="button" className={styles.resetBtn} onClick={reset}>
          Reset layout
        </button>
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
              >
                <button
                  type="button"
                  className={styles.collapse}
                  title={collapsed ? 'Expand' : 'Collapse'}
                  onClick={(e) => {
                    e.stopPropagation()
                    patch(card.id, { collapsed: !collapsed })
                  }}
                >
                  {collapsed ? '▸' : '▾'}
                </button>
                <div className={styles.titleWrap}>
                  <h2 className={styles.title}>{card.title}</h2>
                  {card.badge != null && (
                    <span className={styles.badge}>{card.badge}</span>
                  )}
                </div>
                {card.action != null && (
                  <div
                    className={styles.action}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {card.action}
                  </div>
                )}
                <span className={styles.dragHint} title="Drag to move">
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
