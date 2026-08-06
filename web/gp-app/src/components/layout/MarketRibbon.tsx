import { useEffect, useState } from 'react'
import { api, type IndexRow } from '@/lib/api'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import styles from './MarketRibbon.module.css'

type Idx = {
  key: string
  label: string
  price?: number | null
  pct?: number | null
}

const FALLBACK: Idx[] = [
  { key: 'sp500', label: 'S&P 500' },
  { key: 'dow30', label: 'DOW 30' },
  { key: 'nasdaq', label: 'NASDAQ' },
  { key: 'russell', label: 'RUSSELL 2000' },
  { key: 'vix', label: 'VIX' },
  { key: 'tnx', label: '10Y TREASURY' },
  { key: 'dxy', label: 'DOLLAR INDEX' },
  { key: 'gld', label: 'GOLD' },
]

function normalize(data: unknown): Idx[] {
  if (!data) return FALLBACK
  // API shapes vary: array, or map, or {indices:[]}
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { indices?: IndexRow[] }).indices)
      ? (data as { indices: IndexRow[] }).indices
      : null
  if (arr) {
    return arr.map((r, i) => ({
      key: String(r.symbol || r.name || i),
      label: String(r.name || r.symbol || '—').toUpperCase(),
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
        label: String(v.name || k).toUpperCase(),
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

  useEffect(() => {
    let alive = true
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
    void load()
    const id = window.setInterval(load, 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  return (
    <div className={styles.wrap} role="region" aria-label="Market indices">
      <div className={styles.ribbon}>
        {rows.map((r) => (
          <div key={r.key} className={styles.idx}>
            <span className={styles.name}>{r.label}</span>
            <span className={`${styles.px} tabular`}>{fmtPx(r.price)}</span>
            <span className={`${styles.chg} tabular ${pctClass(r.pct)}`}>
              {fmtPct(r.pct)}
            </span>
          </div>
        ))}
        {stale && <span className={styles.stale}>quotes delayed</span>}
      </div>
    </div>
  )
}
