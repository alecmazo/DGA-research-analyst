import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { DashSeriesPoint } from './types'
import { gfCount, gfMoney } from './format'
import { HoverTip } from './HoverTip'
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
  values: Array<number | null>
  axis?: 'L' | 'R'
  type?: 'bar' | 'line'
  /** Per-point outline bars (GuruFocus forecast years). */
  hollow?: boolean[] | boolean
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

function yearLines(cfg: ChartCfg, i: number): string[] {
  const fmtL = cfg.fmtL || ((v: number) => `$${gfMoney(v)}`)
  const fmtR = cfg.fmtR || pctF
  const lines = [cfg.labels[i] || '—']
  for (const s of cfg.series) {
    const v = s.values[i]
    if (v == null || !Number.isFinite(v)) continue
    const axis = s.axis || 'L'
    const hollow = Array.isArray(s.hollow) ? !!s.hollow[i] : !!s.hollow
    let name = s.name
    if (hollow) name = `${name} Forecast`
    else if (v < 0 && s.nameNeg) name = s.nameNeg
    lines.push(`${name}: ${axis === 'R' ? fmtR(v) : fmtL(v)}`)
  }
  return lines
}

function ChartCard({ cfg }: { cfg: ChartCfg }) {
  const [hoverI, setHoverI] = useState<number | null>(null)
  const [tip, setTip] = useState<{ lines: string[]; x: number; y: number } | null>(
    null,
  )
  const showYear = useCallback((i: number, e: { clientX: number; clientY: number }) => {
    setHoverI(i)
    setTip({ lines: yearLines(cfg, i), x: e.clientX, y: e.clientY })
  }, [cfg])
  const hideTip = useCallback(() => {
    setHoverI(null)
    setTip(null)
  }, [])
  const W = 480
  const H = 196
  const padL = 72
  const hasR = cfg.series.some((s) => s.axis === 'R')
  const padR = hasR ? 58 : 12
  const padT = 8
  const padB = 32
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
          fontSize={15}
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
            fontSize={15}
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
        const col = s.color
        const barY = Math.min(y, y0)
        const barH = Math.max(1, Math.abs(y0 - y))
        const isHollow = Array.isArray(s.hollow) ? !!s.hollow[i] : !!s.hollow
        bars.push(
          <rect
            key={`b${si}-${i}`}
            x={x}
            y={barY}
            width={bw - 1}
            height={barH}
            fill={isHollow ? 'none' : col}
            stroke={isHollow ? col : undefined}
            strokeWidth={isHollow ? 1.25 : undefined}
            rx={1}
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
              r={3.5}
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
          fontSize={14}
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
        {cfg.title && <div className={styles.chartTitle}>{cfg.title}</div>}
        <div className={styles.mutedSm}>No data.</div>
      </div>
    )
  }

  return (
    <div className={styles.chartCard}>
      {cfg.title && <div className={styles.chartTitle}>{cfg.title}</div>}
      <div className={styles.chartLegend}>
        {cfg.series.map((s) => (
          <span key={s.name} className={styles.chartLegItem}>
            <span
              className={styles.chartDot}
              style={{ background: s.color }}
            />
            {s.name}
          </span>
        ))}
        {cfg.series
          .filter(
            (s) =>
              Array.isArray(s.hollow) && s.hollow.some(Boolean) &&
              s.values.some((v, i) => s.hollow && (s.hollow as boolean[])[i] && v != null),
          )
          .map((s) => (
            <span key={`${s.name}-fc`} className={styles.chartLegItem}>
              <span
                className={styles.chartSwatchHollow}
                style={{ border: `1.5px solid ${s.color}` }}
              />
              {s.name} Forecast
            </span>
          ))}
      </div>
      <div className={styles.chartSvgWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg}>
          {chart}
          {cfg.labels.map((_, i) => (
            <rect
              key={`hit${i}`}
              x={padL + (plotW / n) * i}
              y={padT}
              width={plotW / n}
              height={plotH}
              fill={hoverI === i ? 'rgba(14,165,233,0.10)' : 'transparent'}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => showYear(i, e)}
              onMouseMove={(e) => showYear(i, e)}
              onMouseLeave={hideTip}
            />
          ))}
        </svg>
        {tip && (
          <HoverTip x={tip.x} y={tip.y} className={styles.chartTip} wrap>
            {tip.lines.map((line, i) => (
              <div key={i} className={i === 0 ? styles.chartTipYear : undefined}>
                {line}
              </div>
            ))}
          </HoverTip>
        )}
      </div>
    </div>
  )
}

/** Pre-React multi-panel fundamentals grid (7 charts). */
export function FundCharts({
  series,
  nextEarningsDate,
}: {
  series: DashSeriesPoint[]
  nextEarningsDate?: string | null
}) {
  if (!series.length) return null
  const hist = series.filter((s) => !s.forecast)
  const labelsAll = series.map((s) => s.label || '—')
  const labels = (hist.length ? hist : series).map((s) => s.label || '—')
  const isAnnual = labelsAll.some((l) => /FY|20\d{2}$/i.test(l) && !/Q\d/i.test(l))
  const shareDeltaName = isAnnual ? 'Share Δ % (YoY)' : 'Share Δ % (QoQ)'
  const shareDeltaNeg = isAnnual ? 'Dilution % (YoY)' : 'Dilution % (QoQ)'
  const hollow = series.map((s) => !!s.forecast)
  const hasFwd = hollow.some(Boolean)
  const histSeries = hist.length ? hist : series
  const ed = (nextEarningsDate || '').slice(0, 10)
  const revTitle = ed
    ? `Financials (Next Earnings Date: ${ed} Est.)`
    : 'Financials'

  const charts: ChartCfg[] = [
    {
      title: revTitle,
      labels: hasFwd ? labelsAll : labels,
      series: [
        {
          name: 'Revenue',
          color: COLORS.blue,
          values: col(hasFwd ? series : histSeries, 'revenue'),
          hollow: hasFwd ? hollow : undefined,
        },
        {
          name: 'Net Income',
          color: COLORS.green,
          values: col(hasFwd ? series : histSeries, 'net_income'),
          hollow: hasFwd ? hollow : undefined,
        },
        {
          name: 'EBITDA',
          color: COLORS.orange,
          values: col(hasFwd ? series : histSeries, 'ebitda'),
          hollow: hasFwd ? hollow : undefined,
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
          values: col(histSeries, 'gross_margin_pct'),
        },
        {
          name: 'Op. Margin %',
          color: COLORS.orange,
          values: col(histSeries, 'operating_margin_pct'),
        },
        {
          name: 'Net Margin %',
          color: COLORS.green,
          values: col(histSeries, 'net_margin_pct'),
        },
      ],
    },
    {
      labels,
      series: [
        { name: 'Cash + STI', color: COLORS.green, values: col(histSeries, 'cash') },
        { name: 'Borrowings', color: COLORS.orange, values: col(histSeries, 'borrowings') },
        { name: 'Lease liabilities *', color: COLORS.purple, values: col(histSeries, 'leases') },
      ],
    },
    {
      labels,
      series: [
        {
          name: 'OCF',
          color: COLORS.orange,
          values: col(histSeries, 'ocf'),
        },
        {
          name: 'FCF',
          color: COLORS.blue,
          values: col(histSeries, 'fcf'),
        },
        {
          name: 'Dividends',
          color: COLORS.purple,
          values: col(histSeries, 'dividends'),
        },
        {
          name: 'Buybacks',
          color: COLORS.pink,
          values: col(histSeries, 'buybacks'),
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
          values: col(histSeries, 'roic_pct'),
        },
        {
          name: 'WACC % (est.)',
          color: COLORS.red,
          values: col(histSeries, 'wacc_pct'),
        },
        {
          name: 'ROIC − WACC',
          color: 'var(--text-primary)',
          type: 'line',
          values: histSeries.map((x) =>
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
          values: col(histSeries, 'shares'),
        },
        {
          name: shareDeltaName,
          nameNeg: shareDeltaNeg,
          color: COLORS.green,
          axis: 'R',
          values: col(histSeries, 'buyback_ratio_pct'),
        },
      ],
    },
    {
      title: 'Balance sheet',
      labels,
      series: [
        {
          name: 'Total Assets',
          color: COLORS.blue,
          values: col(histSeries, 'assets'),
        },
        {
          name: 'Total Liabilities',
          color: COLORS.orange,
          values: col(histSeries, 'liabilities'),
        },
        {
          name: 'Stockholders Equity',
          color: COLORS.green,
          values: col(histSeries, 'equity'),
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
