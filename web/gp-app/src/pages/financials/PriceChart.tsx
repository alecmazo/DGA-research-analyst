import { useEffect, useMemo, useState, type MouseEvent, type ReactNode, type TouchEvent } from 'react'
import { api } from '@/lib/api'
import type { PriceHistory } from './types'
import { PRICE_RANGES } from './types'
import { HoverTip } from './HoverTip'
import styles from '../FinancialsPage.module.css'

const W = 920
const H = 280
const PAD_L = 8
const PAD_R = 64
const PAD_T = 14
const PAD_B = 26

function fmtPx(v: number) {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: v < 1000 ? 2 : 0,
    maximumFractionDigits: v < 1000 ? 2 : 0,
  })
}

function fmtDate(t?: string) {
  const s = String(t || '')
  if (s.length >= 16 && s.includes('T')) return s.slice(0, 16).replace('T', ' ')
  return s.slice(0, 10)
}

export function PriceChart({ ticker }: { ticker: string }) {
  const [range, setRange] = useState('YTD')
  const [data, setData] = useState<PriceHistory | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [ptr, setPtr] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const tk = ticker.trim().toUpperCase()
    if (!tk) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    setHover(null)
    setPtr(null)
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

  const geo = useMemo(() => {
    if (pts.length < 2) return null
    const n = pts.length
    const ys = pts.map((p) => p.c)
    let lo = Math.min(...ys)
    let hi = Math.max(...ys)
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1
    lo -= pad
    hi += pad
    const xOf = (i: number) => PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R)
    const yOf = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B)
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
    dArea += `L${xOf(n - 1).toFixed(1)} ${H - PAD_B} L${xOf(0).toFixed(1)} ${H - PAD_B} Z`
    const last = ys[n - 1]!
    const grid: ReactNode[] = []
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4
      const y = yOf(v)
      grid.push(
        <g key={k}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y}
            y2={y}
            stroke="var(--border-subtle,#e2e8f0)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
          <text
            x={W - PAD_R + 6}
            y={y + 4}
            fontSize={12}
            fill="var(--text-tertiary,#94a3b8)"
          >
            {v.toFixed(v < 5 ? 2 : v < 1000 ? 1 : 0)}
          </text>
        </g>,
      )
    }
    const xLabels = [0, Math.floor((n - 1) / 2), n - 1].map((i) => {
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
    })
    return { n, xOf, yOf, lineCol, areaCol, dLine, dArea, last, grid, xLabels, ys }
  }, [pts])

  const pickIndex = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    if (!geo) return
    const rect = svg.getBoundingClientRect()
    if (!rect.width) return
    const vx = ((clientX - rect.left) / rect.width) * W
    let best = 0
    let bd = Infinity
    for (let i = 0; i < geo.n; i++) {
      const dd = Math.abs(geo.xOf(i) - vx)
      if (dd < bd) {
        bd = dd
        best = i
      }
    }
    setHover(best)
    setPtr({ x: clientX, y: clientY })
  }

  const onMove = (e: MouseEvent<SVGSVGElement>) =>
    pickIndex(e.clientX, e.clientY, e.currentTarget)
  const onTouch = (e: TouchEvent<SVGSVGElement>) => {
    const t = e.touches[0]
    if (t) pickIndex(t.clientX, t.clientY, e.currentTarget)
  }

  const hi = hover != null && pts[hover] ? pts[hover] : null
  const hiX = hover != null && geo ? geo.xOf(hover) : 0
  const hiY = hi && geo ? geo.yOf(hi.c) : 0

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
          {(hi?.c != null || stats.last != null) && (
            <span className={styles.priceLast}>
              ${fmtPx(hi?.c ?? (stats.last as number))}
            </span>
          )}
        </div>
      )}
      {loading && (
        <div className={styles.priceEmpty}>Loading {ticker} {range}…</div>
      )}
      {err && !loading && <div className={styles.priceEmpty}>{err}</div>}
      {!loading && !err && geo && (
        <div className={styles.priceSvgWrap}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className={styles.priceSvg}
            preserveAspectRatio="none"
            onMouseMove={onMove}
            onMouseLeave={() => {
              setHover(null)
              setPtr(null)
            }}
            onTouchMove={onTouch}
            onTouchEnd={() => {
              setHover(null)
              setPtr(null)
            }}
          >
            {geo.grid}
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={geo.yOf(Math.max(...geo.ys))}
              y2={geo.yOf(Math.max(...geo.ys))}
              stroke="#16a34a"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={geo.yOf(Math.min(...geo.ys))}
              y2={geo.yOf(Math.min(...geo.ys))}
              stroke="#dc2626"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <path d={geo.dArea} fill={geo.areaCol} stroke="none" />
            <path
              d={geo.dLine}
              fill="none"
              stroke={geo.lineCol}
              strokeWidth={1.8}
              strokeLinejoin="round"
            />
            {geo.xLabels}
            <rect
              x={W - PAD_R + 2}
              y={geo.yOf(geo.last) - 11}
              width={PAD_R - 4}
              height={22}
              rx={4}
              fill={geo.lineCol}
            />
            <text
              x={W - PAD_R / 2}
              y={geo.yOf(geo.last) + 4}
              fontSize={12}
              fontWeight={700}
              fill="#fff"
              textAnchor="middle"
            >
              {geo.last.toFixed(geo.last < 1000 ? 1 : 0)}
            </text>
            {hi && (
              <>
                <line
                  x1={hiX}
                  x2={hiX}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="var(--text-secondary,#64748b)"
                  strokeWidth={1}
                  opacity={0.55}
                />
                <circle
                  cx={hiX}
                  cy={hiY}
                  r={4}
                  fill={geo.lineCol}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              </>
            )}
          </svg>
          {hi && ptr && (
            <HoverTip x={ptr.x} y={ptr.y} className={styles.priceTip}>
              <span className={styles.priceTipDate}>{fmtDate(hi.t)}</span>
              <strong>${fmtPx(hi.c)}</strong>
            </HoverTip>
          )}
        </div>
      )}
      {!loading && !err && !geo && (
        <div className={styles.priceEmpty}>Not enough data to plot.</div>
      )}
    </div>
  )
}
