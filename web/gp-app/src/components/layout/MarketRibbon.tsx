import { useEffect, useState } from 'react'
import { api, type IndexRow } from '@/lib/api'
import { subscribeQuoteRefresh } from '@/lib/quoteRefresh'
import { fmtPct, pctClass } from '@/lib/format'
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

function fmtIdxPx(label: string, price?: number | null): string {
  if (price == null || Number.isNaN(Number(price))) return '—'
  const n = Number(price)
  const body = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return /gold|oil|bitcoin|ethereum|dollar/i.test(label) ? `$${body}` : body
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
    // Same clock as Desk watchlist — no marquee, no second cadence.
    const unsub = subscribeQuoteRefresh(() => {
      void load()
    })
    return () => {
      alive = false
      unsub()
    }
  }, [])

  return (
    <div className={styles.wrap} role="region" aria-label="Market indices">
      <div className={styles.ribbon}>
        {rows.map((r) => (
          <div key={r.key} className={styles.idx}>
            <span className={styles.name}>{r.label}</span>
            <span className={`${styles.px} tabular`}>{fmtIdxPx(r.label, r.price)}</span>
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
