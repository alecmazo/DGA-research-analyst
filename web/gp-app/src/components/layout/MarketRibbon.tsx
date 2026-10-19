import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { api, type IndexRow } from '@/lib/api'
import { delayAfterWatchlist } from '@/lib/deskBoot'
import { subscribeQuoteRefresh } from '@/lib/quoteRefresh'
import { fmtPct } from '@/lib/format'
import styles from './MarketRibbon.module.css'

type Idx = {
  key: string
  label: string
  price?: number | null
  pct?: number | null
}

const FALLBACK: Idx[] = [
  { key: 'sp500', label: 'S&P 500' },
  { key: 'dow30', label: 'Dow 30' },
  { key: 'nasdaq', label: 'Nasdaq' },
  { key: 'russell', label: 'Russell 2000' },
  { key: 'vix', label: 'VIX' },
  { key: 'tnx', label: '10Y Treasury' },
  { key: 'dxy', label: 'Dollar Index' },
  { key: 'gld', label: 'Gold' },
  { key: 'oil', label: 'Crude Oil' },
  { key: 'btc', label: 'Bitcoin' },
  { key: 'eth', label: 'Ethereum' },
]

/** Module classes. Global `pos`/`neg` are dark greens that vanish on this navy bar. */
function chgClass(pct?: number | null): string {
  if (pct == null || Number.isNaN(Number(pct))) return ''
  if (Number(pct) > 0) return styles.up
  if (Number(pct) < 0) return styles.down
  return ''
}

function fmtIdxPx(label: string, price?: number | null): string {
  if (price == null || Number.isNaN(Number(price))) return '—'
  const n = Number(price)
  const body = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return /gold|oil|bitcoin|ethereum|dollar/i.test(label) ? `$${body}` : body
}

const CORE: { test: RegExp; order: number }[] = [
  { test: /s&p|spx|sp500|gspc/i, order: 0 },
  { test: /nasdaq|ixic/i, order: 1 },
  { test: /dow|dji/i, order: 2 },
  { test: /10y|tnx|treasury/i, order: 3 },
  { test: /\bvix\b/i, order: 4 },
  { test: /gold|gld/i, order: 5 },
]

function splitTape(rows: Idx[]): { core: Idx[]; more: Idx[] } {
  const slots: (Idx | undefined)[] = new Array(CORE.length)
  const more: Idx[] = []
  for (const row of rows) {
    const blob = `${row.key} ${row.label}`
    const hit = CORE.find((c) => c.test.test(blob))
    if (hit && !slots[hit.order]) slots[hit.order] = row
    else more.push(row)
  }
  return { core: slots.filter((row): row is Idx => !!row), more }
}

function IndexPrint({ row }: { row: Idx }) {
  return (
    <div className={styles.idx}>
      <span className={styles.name}>{row.label}</span>
      <span className={`${styles.px} tabular`}>{fmtIdxPx(row.label, row.price)}</span>
      <span className={`${styles.chg} tabular ${chgClass(row.pct)}`}>
        {fmtPct(row.pct)}
      </span>
    </div>
  )
}

function normalize(data: unknown): Idx[] {
  if (!data) return FALLBACK
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { indices?: IndexRow[] }).indices)
      ? (data as { indices: IndexRow[] }).indices
      : null
  if (arr) {
    return arr.map((r, i) => ({
      key: String(r.symbol || r.label || r.name || i),
      label: String(r.label || r.name || r.symbol || '—'),
      price: r.price,
      pct: r.pct ?? r.pct_change,
    }))
  }
  if (typeof data === 'object') {
    const out: Idx[] = []
    for (const [k, v] of Object.entries(data as Record<string, IndexRow>)) {
      if (!v || typeof v !== 'object') continue
      out.push({
        key: k,
        label: String(v.label || v.name || k),
        price: v.price,
        pct: v.pct ?? v.pct_change,
      })
    }
    if (out.length) return out
  }
  return FALLBACK
}

export function MarketRibbon() {
  const [rows, setRows] = useState<Idx[]>(FALLBACK)
  const [stale, setStale] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePos, setMorePos] = useState({ top: 0, right: 0 })
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const morePanelRef = useRef<HTMLDivElement>(null)
  const loc = useLocation()
  const onDesk = loc.pathname === '/' || loc.pathname === ''
  const tape = splitTape(rows)

  useEffect(() => {
    let alive = true
    let unsub = () => {}
    const load = async () => {
      try {
        const d = await api<unknown>('/api/market/indices')
        if (!alive) return
        setRows(normalize(d))
        setStale(false)
      } catch {
        if (alive) setStale(true)
      }
    }
    const arm = () => {
      void load()
      // Same clock as Desk watchlist — no marquee, no second cadence.
      unsub = subscribeQuoteRefresh(() => {
        void load()
      })
    }
    // On the desk, the first open of the day keeps this off the worker
    // until the watchlist has answered. Other pages load it now.
    let stop = () => {}
    if (onDesk) stop = delayAfterWatchlist(0, arm)
    else arm()
    return () => {
      alive = false
      stop()
      unsub()
    }
  }, [onDesk])

  const placeMore = () => {
    const r = moreBtnRef.current?.getBoundingClientRect()
    if (!r) return
    setMorePos({
      top: Math.round(r.bottom + 6),
      right: Math.max(8, Math.round(window.innerWidth - r.right)),
    })
  }

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (moreBtnRef.current?.contains(t) || morePanelRef.current?.contains(t)) return
      setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', placeMore)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', placeMore)
    }
  }, [moreOpen])

  return (
    <div
      className={`${styles.wrap} ${onDesk ? '' : styles.compact}`}
      role="region"
      aria-label="Market indices"
    >
      <div className={styles.ribbon}>
        {tape.core.map((r) => (
          <IndexPrint key={r.key} row={r} />
        ))}
        {tape.more.length > 0 && (
          <button
            ref={moreBtnRef}
            type="button"
            className={styles.moreBtn}
            aria-expanded={moreOpen}
            aria-haspopup="true"
            onClick={() => {
              placeMore()
              setMoreOpen((open) => !open)
            }}
          >
            More
          </button>
        )}
        {stale && <span className={styles.stale}>quotes delayed</span>}
      </div>
      {moreOpen &&
        tape.more.length > 0 &&
        createPortal(
          <div
            ref={morePanelRef}
            className={styles.morePanel}
            style={{ top: morePos.top, right: morePos.right }}
          >
            {tape.more.map((r) => (
              <IndexPrint key={r.key} row={r} />
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
