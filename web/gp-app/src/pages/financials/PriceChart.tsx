import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { PriceHistory } from './types'
import { PRICE_RANGES } from './types'
import styles from '../FinancialsPage.module.css'

export function PriceChart({ ticker }: { ticker: string }) {
  const [range, setRange] = useState('YTD')
  const [data, setData] = useState<PriceHistory | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const tk = ticker.trim().toUpperCase()
    if (!tk) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    void api<PriceHistory>(
      `/api/financials/${encodeURIComponent(tk)}/price-history?range=${encodeURIComponent(range)}`,
    )
      .then((d) => {
        if (cancelled) return
        if (d && d.ok === false) {
          setData(null)
          setErr(d.error || 'Price history failed')
          return
        }
        setData(d)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setData(null)
        setErr(e instanceof Error ? e.message : 'Price history failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker, range])

  const pts = useMemo(
    () => (data?.points || []).filter((p) => p && p.c != null) as Array<{ t?: string; c: number }>,
    [data],
  )

  const chart = useMemo(() => {
    if (pts.length < 2) return null
    const W = 920
    const H = 280
    const padL = 8
    const padR = 64
    const padT = 14
    const padB = 26
    const n = pts.length
    const ys = pts.map((p) => p.c)
    let lo = Math.min(...ys)
    let hi = Math.max(...ys)
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1
    lo -= pad
    hi += pad
    const xOf = (i: number) => padL + (i / (n - 1)) * (W - padL - padR)
    const yOf = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
    const up = ys[n - 1]! >= ys[0]!
    const lineCol = up ? '#16a34a' : '#dc2626'
    const areaCol = up ? 'rgba(22,163,74,0.13)' : 'rgba(220,38,38,0.12)'
    let dLine = ''
    let dArea = ''
    pts.forEach((p, i) => {
      const x = xOf(i).toFixed(1)
      const y = yOf(p.c).toFixed(1)
      dLine += `${i ? 'L' : 'M'}${x} ${y} `
      dArea += `${i ? 'L' : 'M'}${x} ${y} `
    })
    dArea += `L${xOf(n - 1).toFixed(1)} ${H - padB} L${xOf(0).toFixed(1)} ${H - padB} Z`
    const last = ys[n - 1]!
    const lpY = yOf(last)
    const grid: ReactNode[] = []
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4
      const y = yOf(v)
      grid.push(
        <g key={k}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y}
            y2={y}
            stroke="var(--border-subtle,#e2e8f0)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
          <text
            x={W - padR + 6}
            y={y + 4}
            fontSize={12}
            fill="var(--text-tertiary,#94a3b8)"
          >
            {v.toFixed(v < 5 ? 2 : v < 1000 ? 1 : 0)}
          </text>
        </g>,
      )
    }
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.priceSvg}
        preserveAspectRatio="none"
      >
        {grid}
        <line
          x1={padL}
          x2={W - padR}
          y1={yOf(Math.max(...ys))}
          y2={yOf(Math.max(...ys))}
          stroke="#16a34a"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />
        <line
          x1={padL}
          x2={W - padR}
          y1={yOf(Math.min(...ys))}
          y2={yOf(Math.min(...ys))}
          stroke="#dc2626"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.5}
        />
        <path d={dArea} fill={areaCol} stroke="none" />
        <path
          d={dLine}
          fill="none"
          stroke={lineCol}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => {
          const x = xOf(i)
          const anch = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
          return (
            <text
              key={i}
              x={x}
              y={H - 6}
              fontSize={12}
              fill="var(--text-tertiary,#94a3b8)"
              textAnchor={anch}
            >
              {String(pts[i]!.t || '').slice(0, 10)}
            </text>
          )
        })}
        <rect
          x={W - padR + 2}
          y={lpY - 11}
          width={padR - 4}
          height={22}
          rx={4}
          fill={lineCol}
        />
        <text
          x={W - padR / 2}
          y={lpY + 4}
          fontSize={12}
          fontWeight={700}
          fill="#fff"
          textAnchor="middle"
        >
          {last.toFixed(last < 1000 ? 1 : 0)}
        </text>
      </svg>
    )
  }, [pts])

  const stats = data?.stats
  const pf = (v: number | null | undefined) =>
    v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  const sc = (v: number | null | undefined) =>
    v == null ? undefined : v >= 0 ? '#16a34a' : '#dc2626'

  return (
    <div className={styles.pricePanel}>
      <div className={styles.priceRanges}>
        {PRICE_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={range === r ? styles.segOn : styles.segBtn}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      {stats && (
        <div className={styles.priceStats}>
          <span>
            <span className={styles.muted}>{stats.change_label || range} change:</span>{' '}
            <strong style={{ color: sc(stats.change_pct) }}>{pf(stats.change_pct)}</strong>
          </span>
          <span>
            <span className={styles.muted}>Above Low:</span>{' '}
            <strong style={{ color: sc(stats.above_low_pct) }}>
              {pf(stats.above_low_pct)}
            </strong>
          </span>
          <span>
            <span className={styles.muted}>Below High:</span>{' '}
            <strong style={{ color: sc(stats.below_high_pct) }}>
              {pf(stats.below_high_pct)}
            </strong>
          </span>
          {stats.last != null && (
            <span className={styles.priceLast}>
              ${stats.last.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
      )}
      {loading && (
        <div className={styles.priceEmpty}>Loading {ticker} {range}…</div>
      )}
      {err && !loading && <div className={styles.priceEmpty}>{err}</div>}
      {!loading && !err && chart}
      {!loading && !err && !chart && (
        <div className={styles.priceEmpty}>Not enough data to plot.</div>
      )}
    </div>
  )
}
