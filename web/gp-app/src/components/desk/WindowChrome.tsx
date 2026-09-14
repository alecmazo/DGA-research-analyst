import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { fmtCap, fmtPct, fmtPx, pctClass } from '@/lib/format'
import type { StockInfo } from '@/components/layout/StockPeek'
import styles from '@/pages/ValuationBridgePage.module.css'

export type WindowExportKind = 'pdf' | 'excel' | 'email'

export function WindowExportMenu({
  busy,
  onPick,
}: {
  busy?: boolean
  onPick: (kind: WindowExportKind) => void
}) {
  return (
    <select
      className={styles.pull}
      value=""
      disabled={busy}
      aria-label="Download"
      title="Print PDF, Excel, or email this window"
      onChange={(e) => {
        const v = e.target.value as WindowExportKind
        e.currentTarget.value = ''
        if (v) onPick(v)
      }}
    >
      <option value="" disabled>
        {busy ? 'Working…' : 'Download'}
      </option>
      <option value="pdf">Print PDF</option>
      <option value="excel">Excel</option>
      <option value="email">Email</option>
    </select>
  )
}

function bit(label: string, value: string, tone?: string) {
  return (
    <span className={styles.statBit}>
      <span className={styles.statLbl}>{label}</span>{' '}
      <span className={`tabular ${tone || ''}`}>{value}</span>
    </span>
  )
}

/** Last, day %, market cap, P/E, EV/EBITDA, FCF yield, 52w — under the ticker. */
export function TickerStatsLine({
  ticker,
  evEbitda,
  pt,
  rating,
}: {
  ticker: string
  evEbitda?: number | null
  pt?: number | null
  rating?: string | null
}) {
  const [info, setInfo] = useState<StockInfo | null>(null)

  useEffect(() => {
    const tk = ticker.trim().toUpperCase()
    if (!tk) return
    let alive = true
    void api<StockInfo>(`/api/stock-info/${encodeURIComponent(tk)}`)
      .then((d) => {
        if (alive) setInfo(d)
      })
      .catch(() => {
        if (alive) setInfo(null)
      })
    return () => {
      alive = false
    }
  }, [ticker])

  const q = info?.quote
  const d = info?.derived
  const r = info?.range52w
  const px = q?.price ?? null
  const pct = q?.pct_change ?? null
  const mcap = d?.market_cap ?? null
  const pe = d?.pe ?? null
  const fcf = d?.fcf_yield_pct ?? null
  const name = info?.meta?.name || info?.financials?.entity_name

  return (
    <div className={styles.stats}>
      {name ? <span className={styles.statName}>{name}</span> : null}
      {bit('Last', fmtPx(px), pctClass(pct))}
      {pct != null ? (
        <span className={`tabular ${pctClass(pct)} ${styles.statBit}`}>{fmtPct(pct)}</span>
      ) : null}
      {bit('Mkt cap', fmtCap(mcap))}
      {bit('P/E', pe != null && Number.isFinite(pe) ? `${Number(pe).toFixed(1)}x` : '—')}
      {bit(
        'EV/EBITDA',
        evEbitda != null && Number.isFinite(evEbitda)
          ? `${Number(evEbitda).toFixed(1)}x`
          : '—',
      )}
      {bit(
        'FCF yld',
        fcf != null && Number.isFinite(fcf) ? `${Number(fcf).toFixed(1)}%` : '—',
      )}
      {r?.low != null && r?.high != null
        ? bit('52w', `${fmtPx(r.low)}–${fmtPx(r.high)}`)
        : null}
      {pt != null ? bit('12m PT', fmtPx(pt)) : null}
      {rating ? bit('Rating', rating) : null}
    </div>
  )
}
