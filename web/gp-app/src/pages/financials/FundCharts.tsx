import { useMemo, useState, type ReactNode } from 'react'
import type { DashSeriesPoint } from './types'
import { gfCount, gfMoney } from './format'
import styles from '../FinancialsPage.module.css'

const COLORS = {
  blue: '#3b82f6',
  green: '#16a34a',
  orange: '#f59e0b',
  red: '#dc2626',
  purple: '#8b5cf6',
  pink: '#ec4899',
  slate: '#64748b',
}

type SeriesCfg = {
  name: string
  nameNeg?: string
  color: string
  colorNeg?: string
  values: Array<number | null>
  axis?: 'L' | 'R'
  type?: 'bar' | 'line'
}

type ChartCfg = {
  title?: string
  labels: string[]
  series: SeriesCfg[]
  fmtL?: (v: number) => string
  fmtR?: (v: number) => string
  clampL?: { lo: number; hi: number }
  clampR?: { lo: number; hi: number }
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

function pctF(v: number) {
  return `${v.toFixed(Math.abs(v) < 3 ? 1 : 0)}%`
}

function rangeOf(
  series: SeriesCfg[],
  axis: 'L' | 'R',
  clamp?: { lo: number; hi: number },
) {
  let lo = 0
  let hi = 0
  for (const s of series) {
    if ((s.axis || 'L') !== axis) continue
    for (const v of s.values) {
      if (v != null && Number.isFinite(v)) {
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
  }
  if (clamp) {
    lo = Math.max(lo, clamp.lo)
    hi = Math.min(hi, clamp.hi)
  }
  if (hi === lo) hi = lo + 1
  hi *= 1.06
  if (lo < 0) lo *= 1.06
  return { lo, hi }
}

function ChartCard({ cfg }: { cfg: ChartCfg }) {
  const [tip, setTip] = useState<{ html: string; x: number; y: number } | null>(
    null,
  )
  const W = 560
  const H = 268
  const padL = 72
  const hasR = cfg.series.some((s) => s.axis === 'R')
  const padR = hasR ? 64 : 14
  const padT = 12
  const padB = 40
  const n = cfg.labels.length
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const chart = useMemo(() => {
    if (!n) return null
    let L = rangeOf(cfg.series, 'L', cfg.clampL)
    let R = rangeOf(cfg.series, 'R', cfg.clampR)
    if (hasR) {
      const pref = (r: { lo: number; hi: number }) => {
        const neg = Math.max(0, -r.lo)
        const pos = Math.max(0, r.hi)
        return neg + pos ? neg / (neg + pos) : 0
      }
      const z = Math.min(0.38, Math.max(pref(L), pref(R)))
      if (z > 0.001) {
        for (const r of [L, R]) {
          const neg = Math.max(0, -r.lo)
          const pos = Math.max(0, r.hi)
          const T = Math.max(neg / z, pos / (1 - z))
          r.lo = -z * T
          r.hi = (1 - z) * T
        }
      }
    }
    const yOf = (v: number, a: 'L' | 'R') => {
      const r = a === 'R' ? R : L
      const vv = Math.max(r.lo, Math.min(r.hi, v))
      return padT + plotH * (1 - (vv - r.lo) / (r.hi - r.lo))
    }
    const slotW = plotW / n
    const barSeries = cfg.series.filter((s) => (s.type || 'bar') === 'bar')
    const bw = Math.max(
      2,
      Math.min(14, (slotW * 0.72) / Math.max(1, barSeries.length)),
    )
    const fmtL = cfg.fmtL || ((v: number) => `$${gfMoney(v)}`)
    const fmtR = cfg.fmtR || pctF
    const fmtVal = (v: number, a: 'L' | 'R') => (a === 'R' ? fmtR(v) : fmtL(v))

    const grid: ReactNode[] = []
    for (let i = 0; i <= 4; i++) {
      const v = L.lo + ((L.hi - L.lo) * i) / 4
      const y = yOf(v, 'L')
      grid.push(
        <line
          key={`g${i}`}
          x1={padL}
          y1={y}
          x2={W - padR}
          y2={y}
          stroke="var(--border-subtle,#e2e8f0)"
          strokeWidth={1}
        />,
        <text
          key={`tl${i}`}
          x={padL - 6}
          y={y + 4}
          textAnchor="end"
          fontSize={11}
          fill="var(--text-secondary,#64748b)"
        >
          {fmtL(v)}
        </text>,
      )
      if (hasR) {
        const vr = R.lo + ((R.hi - R.lo) * i) / 4
        const yr = yOf(vr, 'R')
        grid.push(
          <text
            key={`tr${i}`}
            x={W - padR + 6}
            y={yr + 4}
            fontSize={11}
            fill="var(--text-secondary,#64748b)"
          >
            {fmtR(vr)}
          </text>,
        )
      }
    }
    if (L.lo < 0) {
      const y0 = yOf(0, 'L')
      grid.push(
        <line
          key="zero"
          x1={padL}
          y1={y0}
          x2={W - padR}
          y2={y0}
          stroke="var(--text-tertiary,#94a3b8)"
          strokeWidth={1}
        />,
      )
    }

    const bars: ReactNode[] = []
    barSeries.forEach((s, si) => {
      const a = s.axis || 'L'
      const y0 = yOf(0, a)
      s.values.forEach((v, i) => {
        if (v == null || !Number.isFinite(v)) return
        const x =
          padL + slotW * i + slotW / 2 - (barSeries.length * bw) / 2 + si * bw
        const y = yOf(v, a)
        const col = v < 0 && s.colorNeg ? s.colorNeg : s.color
        const nm = v < 0 && s.nameNeg ? s.nameNeg : s.name
        const barY = Math.min(y, y0)
        const barH = Math.max(1, Math.abs(y0 - y))
        bars.push(
          <rect
            key={`b${si}-${i}`}
            x={x}
            y={barY}
            width={bw - 1}
            height={barH}
            fill={col}
            rx={1}
            style={{ cursor: 'pointer' }}
            onMouseEnter={(e) => {
              const rect = (e.target as SVGElement)
                .closest('svg')
                ?.getBoundingClientRect()
              if (!rect) return
              setTip({
                html: `${cfg.labels[i]} · ${nm}: ${fmtVal(v, a)}`,
                x: e.clientX - rect.left + 12,
                y: e.clientY - rect.top - 8,
              })
            }}
            onMouseLeave={() => setTip(null)}
          />,
        )
      })
    })

    const lines: ReactNode[] = []
    cfg.series
      .filter((s) => s.type === 'line')
      .forEach((s, si) => {
        const a = s.axis || 'L'
        const pts: string[] = []
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) return
          const x = padL + slotW * i + slotW / 2
          const y = yOf(v, a)
          pts.push(`${pts.length ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
          lines.push(
            <circle
              key={`d${si}-${i}`}
              cx={x}
              cy={y}
              r={3}
              fill={s.color}
              stroke="#fff"
              strokeWidth={1}
            />,
          )
        })
        if (pts.length)
          lines.push(
            <path
              key={`p${si}`}
              d={pts.join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2.5}
            />,
          )
      })

    const step = Math.ceil(n / 6)
    const xLabels: ReactNode[] = []
    cfg.labels.forEach((lb, i) => {
      if (i % step) return
      xLabels.push(
        <text
          key={`x${i}`}
          x={padL + slotW * i + slotW / 2}
          y={H - 10}
          textAnchor="middle"
          fontSize={11}
          fill="var(--text-secondary,#64748b)"
        >
          {lb}
        </text>,
      )
    })

    return (
      <>
        {grid}
        {bars}
        {lines}
        {xLabels}
      </>
    )
  }, [cfg, n, hasR, padR, plotH, plotW])

  if (!n) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.mutedSm}>No data.</div>
      </div>
    )
  }

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartLegend}>
        {cfg.series.map((s) => (
          <span key={s.name} className={styles.chartLegItem}>
            <span
              className={styles.chartDot}
              style={{ background: s.color }}
            />
            {s.name}
            {s.colorNeg && (
              <>
                <span
                  className={styles.chartDot}
                  style={{ background: s.colorNeg, marginLeft: 6 }}
                />
                {s.nameNeg || `${s.name} (−)`}
              </>
            )}
          </span>
        ))}
      </div>
      <div className={styles.chartSvgWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg}>
          {chart}
        </svg>
        {tip && (
          <div
            className={styles.chartTip}
            style={{ left: tip.x, top: tip.y }}
          >
            {tip.html}
          </div>
        )}
      </div>
    </div>
  )
}

/** Pre-React multi-panel fundamentals grid (7 charts). */
export function FundCharts({ series }: { series: DashSeriesPoint[] }) {
  if (!series.length) return null
  const labels = series.map((s) => s.label || '—')
  const isAnnual = labels.some((l) => /FY|20\d{2}$/i.test(l) && !/Q\d/i.test(l))
  const shareDeltaName = isAnnual ? 'Share Δ % (YoY)' : 'Share Δ % (QoQ)'
  const shareDeltaNeg = isAnnual ? 'Dilution % (YoY)' : 'Dilution % (QoQ)'

  const charts: ChartCfg[] = [
    {
      labels,
      series: [
        { name: 'Revenue', color: COLORS.blue, values: col(series, 'revenue') },
        {
          name: 'Net Income',
          color: COLORS.green,
          colorNeg: COLORS.red,
          nameNeg: 'Net Loss',
          values: col(series, 'net_income'),
        },
        {
          name: 'EBITDA',
          color: COLORS.orange,
          colorNeg: COLORS.red,
          nameNeg: 'EBITDA (neg)',
          values: col(series, 'ebitda'),
        },
      ],
    },
    {
      labels,
      fmtL: pctF,
      series: [
        {
          name: 'Gross Margin %',
          color: COLORS.blue,
          values: col(series, 'gross_margin_pct'),
        },
        {
          name: 'Op. Margin %',
          color: COLORS.orange,
          values: col(series, 'operating_margin_pct'),
        },
        {
          name: 'Net Margin %',
          color: COLORS.green,
          colorNeg: COLORS.red,
          nameNeg: 'Net Margin % (neg)',
          values: col(series, 'net_margin_pct'),
        },
      ],
    },
    {
      labels,
      series: [
        { name: 'Cash + STI', color: COLORS.green, values: col(series, 'cash') },
        { name: 'Total Debt', color: COLORS.red, values: col(series, 'debt') },
      ],
    },
    {
      labels,
      series: [
        {
          name: 'Operating CF',
          color: COLORS.orange,
          colorNeg: COLORS.red,
          nameNeg: 'OCF (neg)',
          values: col(series, 'ocf'),
        },
        {
          name: 'Free CF',
          color: COLORS.blue,
          colorNeg: COLORS.red,
          nameNeg: 'FCF (neg)',
          values: col(series, 'fcf'),
        },
        {
          name: 'Net Income',
          color: COLORS.green,
          colorNeg: COLORS.red,
          nameNeg: 'Net Loss',
          values: col(series, 'net_income'),
        },
        {
          name: 'Dividends',
          color: COLORS.purple,
          values: col(series, 'dividends'),
        },
        {
          name: 'Buybacks',
          color: COLORS.pink,
          values: col(series, 'buybacks'),
        },
      ],
    },
    {
      labels,
      fmtL: pctF,
      series: [
        {
          name: 'ROIC %',
          color: COLORS.green,
          colorNeg: COLORS.red,
          nameNeg: 'ROIC % (neg)',
          values: col(series, 'roic_pct'),
        },
        {
          name: 'WACC % (est.)',
          color: COLORS.red,
          values: col(series, 'wacc_pct'),
        },
        {
          name: 'ROIC − WACC',
          color: 'var(--text-primary)',
          type: 'line',
          values: series.map((x) =>
            x.roic_pct != null && x.wacc_pct != null
              ? x.roic_pct - x.wacc_pct
              : null,
          ),
        },
      ],
    },
    {
      labels,
      fmtL: (v) => gfCount(v),
      fmtR: pctF,
      clampR: { lo: -25, hi: 25 },
      series: [
        {
          name: 'Shares Outstanding',
          color: COLORS.blue,
          values: col(series, 'shares'),
        },
        {
          name: shareDeltaName,
          nameNeg: shareDeltaNeg,
          color: COLORS.green,
          colorNeg: COLORS.red,
          axis: 'R',
          values: col(series, 'buyback_ratio_pct'),
        },
      ],
    },
    {
      labels,
      series: [
        {
          name: 'Stockholders Equity',
          color: COLORS.green,
          colorNeg: COLORS.red,
          nameNeg: 'Equity (neg)',
          values: col(series, 'equity'),
        },
        {
          name: 'Total Assets',
          color: COLORS.blue,
          values: col(series, 'assets'),
        },
      ],
    },
  ]

  return (
    <div className={styles.chartGrid}>
      {charts.map((c, i) => (
        <ChartCard key={i} cfg={c} />
      ))}
    </div>
  )
}
