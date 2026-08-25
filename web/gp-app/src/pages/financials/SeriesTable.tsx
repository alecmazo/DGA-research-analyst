import type { DashSeriesPoint } from './types'
import { gfCap, gfMoney, sgnColor } from './format'
import { Sparkline } from './Sparkline'
import styles from '../FinancialsPage.module.css'

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
export function SeriesPanel({ series }: { series: DashSeriesPoint[] }) {
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
                  {r.debt != null ? gfCap(r.debt) : '—'}
                </td>
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
