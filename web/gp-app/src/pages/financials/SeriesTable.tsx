import { useState } from 'react'
import type { DashSeriesPoint } from './types'
import { gfCap, gfMoney, sgnColor } from './format'
import { Sparkline } from './Sparkline'
import { HoverTip } from './HoverTip'
import { api } from '@/lib/api'
import styles from '../FinancialsPage.module.css'

type MaturityRow = { label?: string; amount?: number | null }
type MaturitySched = {
  ok?: boolean
  as_of?: string | null
  fy?: number | null
  rows?: MaturityRow[]
  total?: number | null
  note?: string | null
  error?: string | null
}

const matCache = new Map<string, MaturitySched>()

function DebtCell({ ticker, amount }: { ticker?: string; amount: number | null }) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const [sched, setSched] = useState<MaturitySched | null>(
    ticker ? matCache.get(ticker.toUpperCase()) || null : null,
  )
  const [busy, setBusy] = useState(false)
  const text = amount != null ? gfCap(amount) : '—'
  if (amount == null || !ticker) {
    return <td className="tabular">{text}</td>
  }
  const show = async (x: number, y: number) => {
    setTip({ x, y })
    const key = ticker.toUpperCase()
    const cached = matCache.get(key)
    if (cached) {
      setSched(cached)
      return
    }
    if (busy) return
    setBusy(true)
    try {
      const d = await api<MaturitySched>(
        `/api/financials/${encodeURIComponent(key)}/debt-maturities`,
      )
      matCache.set(key, d)
      setSched(d)
    } catch (e) {
      const fail: MaturitySched = {
        ok: false,
        error: e instanceof Error ? e.message : 'Schedule unavailable',
      }
      setSched(fail)
    } finally {
      setBusy(false)
    }
  }
  return (
    <td
      className={`tabular ${styles.debtCell}`}
      onMouseEnter={(e) => void show(e.clientX, e.clientY)}
      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setTip(null)}
    >
      {text}
      {tip && (
        <HoverTip x={tip.x} y={tip.y} className={styles.debtTip} wrap>
          <div className={styles.debtTipTitle}>Debt maturities</div>
          <div className={styles.debtTipSub}>
            {sched?.as_of
              ? `10-K contractual · as of ${sched.as_of}${sched.fy ? ` · FY${sched.fy}` : ''}`
              : busy
                ? 'Reading the 10-K…'
                : 'Latest 10-K contractual schedule'}
          </div>
          {sched?.rows && sched.rows.length > 0 ? (
            <table className={styles.debtTipTable}>
              <tbody>
                {sched.rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="tabular">{r.amount != null ? gfCap(r.amount) : '—'}</td>
                  </tr>
                ))}
                {sched.total != null && (
                  <tr>
                    <td>Schedule total</td>
                    <td className="tabular">{gfCap(sched.total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <div className={styles.debtTipEmpty}>
              {busy ? '…' : sched?.note || sched?.error || 'Not tagged in this 10-K.'}
            </div>
          )}
        </HoverTip>
      )}
    </td>
  )
}

function col(
  series: DashSeriesPoint[],
  k: keyof DashSeriesPoint,
): Array<number | null> {
  return series.map((x) => {
    const v = x[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  })
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(Math.abs(v) < 3 ? 1 : 0)}%`
}

/** Compact multi-metric table + sparklines from dashboard series (chart stand-in). */
export function SeriesPanel({
  series,
  ticker,
}: {
  series: DashSeriesPoint[]
  ticker?: string
}) {
  if (!series.length) return null
  const labels = series.map((s) => s.label || '—')
  const rev = col(series, 'revenue')
  const ni = col(series, 'net_income')
  const fcf = col(series, 'fcf')
  const gm = col(series, 'gross_margin_pct')
  const om = col(series, 'operating_margin_pct')
  const nm = col(series, 'net_margin_pct')
  const roic = col(series, 'roic_pct')
  const cash = col(series, 'cash')
  const debt = col(series, 'debt')

  const cards = [
    { label: 'Revenue', vals: rev, fmt: (v: number | null) => (v != null ? `$${gfMoney(v)}` : '—') },
    { label: 'Net Income', vals: ni, fmt: (v: number | null) => (v != null ? `$${gfMoney(v)}` : '—') },
    { label: 'FCF', vals: fcf, fmt: (v: number | null) => (v != null ? `$${gfMoney(v)}` : '—') },
    { label: 'Net Margin %', vals: nm, fmt: fmtPct },
    { label: 'ROIC %', vals: roic, fmt: fmtPct },
  ]

  // Show last ≤8 periods in table for scanability
  const show = series.slice(-8)

  return (
    <div className={styles.seriesPanel}>
      <div className={styles.sparkRow}>
        {cards.map((c) => {
          const nums = c.vals.filter((v): v is number => v != null)
          if (nums.length < 2) return null
          let last: number | null = null
          for (let i = c.vals.length - 1; i >= 0; i--) {
            if (c.vals[i] != null) {
              last = c.vals[i]
              break
            }
          }
          return (
            <div key={c.label} className={styles.sparkCard}>
              <div className={styles.sparkLbl}>{c.label}</div>
              <div className={`${styles.sparkVal} tabular`}>{c.fmt(last)}</div>
              <Sparkline vals={c.vals} />
            </div>
          )
        })}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Period</th>
              <th className="tabular">Revenue</th>
              <th className="tabular">Net Inc</th>
              <th className="tabular">FCF</th>
              <th className="tabular">GM%</th>
              <th className="tabular">OpM%</th>
              <th className="tabular">NM%</th>
              <th className="tabular">ROIC%</th>
              <th className="tabular">Cash</th>
              <th className="tabular">Borrow</th>
              <th className="tabular">Leases</th>
              <th className="tabular">Debt</th>
            </tr>
          </thead>
          <tbody>
            {[...show].reverse().map((r, i) => (
              <tr key={`${r.label}-${i}`}>
                <td className={styles.tkSm}>{r.label || '—'}</td>
                <td className="tabular">{r.revenue != null ? `$${gfMoney(r.revenue)}` : '—'}</td>
                <td
                  className="tabular"
                  style={{ color: sgnColor(r.net_income ?? null) }}
                >
                  {r.net_income != null ? `$${gfMoney(r.net_income)}` : '—'}
                </td>
                <td className="tabular">
                  {r.fcf != null ? `$${gfMoney(r.fcf)}` : '—'}
                </td>
                <td className="tabular">{fmtPct(r.gross_margin_pct)}</td>
                <td className="tabular">{fmtPct(r.operating_margin_pct)}</td>
                <td className="tabular">{fmtPct(r.net_margin_pct)}</td>
                <td className="tabular">{fmtPct(r.roic_pct)}</td>
                <td className="tabular">
                  {r.cash != null ? gfCap(r.cash) : '—'}
                </td>
                <td className="tabular">
                  {r.borrowings != null ? gfCap(r.borrowings) : '—'}
                </td>
                <td className="tabular">
                  {r.leases != null ? gfCap(r.leases) : '—'}
                </td>
                <DebtCell ticker={ticker} amount={r.debt ?? null} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {labels.length > 8 && (
        <div className={styles.mutedSm}>
          Showing latest 8 of {labels.length} periods · full history in Company history
        </div>
      )}
    </div>
  )
}
