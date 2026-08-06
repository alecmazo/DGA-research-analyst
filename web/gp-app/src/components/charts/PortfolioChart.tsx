import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { api } from '@/lib/api'
import { fmtUsd } from '@/lib/format'
import styles from './PortfolioChart.module.css'

export type ChartPeriod = '1m' | 'ytd' | '1y' | '3y'

type ChartData = {
  dates?: string[]
  values?: number[]
  min_val?: number
  max_val?: number
  change_abs?: number
  error?: string
}

type Props = {
  period: ChartPeriod
  fundId?: string | null
  height?: number
}

function fmtTickDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso.slice(5, 10)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

export function PortfolioChart({ period, fundId = null, height = 180 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<ChartData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [width, setWidth] = useState(800)
  const [hover, setHover] = useState<{
    i: number
    clientX: number
    clientY: number
  } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 800))
    ro.observe(el)
    setWidth(el.clientWidth || 800)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    ;(async () => {
      try {
        let url = `/api/v2/gp/portfolio-chart?period=${encodeURIComponent(period)}`
        if (fundId) url += `&fund_id=${encodeURIComponent(fundId)}`
        const d = await api<ChartData>(url)
        if (!alive) return
        setData(d)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Chart unavailable')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [period, fundId])

  const drawn = useMemo(() => {
    const dates = data?.dates || []
    const vals = data?.values || []
    if (dates.length < 2 || vals.length < 2) return null
    const W = width
    const H = height
    const PAD_L = 8
    const PAD_R = 8
    const PAD_T = 12
    const PAD_B = 20
    const W2 = W - PAD_L - PAD_R
    const H2 = H - PAD_T - PAD_B
    const minV = data?.min_val ?? Math.min(...vals)
    const maxV = data?.max_val ?? Math.max(...vals)
    const range = maxV - minV || 1
    const n = vals.length
    const pts = vals.map((v, i) => {
      const x = PAD_L + (i / (n - 1)) * W2
      const y = PAD_T + H2 - ((v - minV) / range) * H2
      return [x, y] as [number, number]
    })
    let d = `M${pts[0][0]},${pts[0][1]}`
    for (let i = 1; i < pts.length; i++) {
      const cp1x = (pts[i - 1][0] + pts[i][0]) / 2
      d += ` C${cp1x},${pts[i - 1][1]} ${cp1x},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`
    }
    const last = pts[pts.length - 1]
    const first = pts[0]
    const baselineY = PAD_T + H2
    const area = `${d} L${last[0]},${baselineY} L${first[0]},${baselineY} Z`
    const isUp = (data?.change_abs || 0) >= 0
    const lineClr = isUp ? '#5BB8D4' : '#dc2626'
    const tickCount = Math.min(6, Math.max(2, Math.floor(W / 110)))
    const ticks: { x: number; label: string; anchor: string }[] = []
    for (let t = 0; t < tickCount; t++) {
      const ratio = tickCount === 1 ? 0 : t / (tickCount - 1)
      const idx = Math.round(ratio * (n - 1))
      ticks.push({
        x: PAD_L + ratio * W2,
        label: fmtTickDate(dates[idx]),
        anchor: t === 0 ? 'start' : t === tickCount - 1 ? 'end' : 'middle',
      })
    }
    return {
      W,
      H,
      d,
      area,
      pts,
      vals,
      dates,
      lineClr,
      ticks,
      PAD_L,
      W2,
      PAD_T,
      baselineY,
    }
  }, [data, width, height])

  const onMove = (evt: MouseEvent<SVGSVGElement>) => {
    if (!drawn) return
    const rect = evt.currentTarget.getBoundingClientRect()
    const xInSvg = evt.clientX - rect.left
    const xPlot = Math.max(
      drawn.PAD_L,
      Math.min(drawn.PAD_L + drawn.W2, xInSvg * (drawn.W / rect.width)),
    )
    const ratio = (xPlot - drawn.PAD_L) / drawn.W2
    const idx = Math.round(ratio * (drawn.vals.length - 1))
    if (idx < 0 || idx >= drawn.vals.length) return
    setHover({ i: idx, clientX: evt.clientX, clientY: evt.clientY })
  }

  return (
    <div className={styles.wrap} ref={wrapRef} style={{ height }}>
      {loading && <div className={styles.loading}>Loading chart…</div>}
      {!loading && (err || !drawn) && (
        <div className={styles.loading}>
          {err ||
            data?.error ||
            'No chart data available — run a YTD upload to populate positions'}
        </div>
      )}
      {!loading && drawn && (
        <>
          <svg
            width={drawn.W}
            height={drawn.H}
            viewBox={`0 0 ${drawn.W} ${drawn.H}`}
            className={styles.svg}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="gpChartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={drawn.lineClr} stopOpacity={0.25} />
                <stop offset="100%" stopColor={drawn.lineClr} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <path d={drawn.area} fill="url(#gpChartGrad)" stroke="none" />
            <path
              d={drawn.d}
              fill="none"
              stroke={drawn.lineClr}
              strokeWidth={2.2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle
              cx={drawn.pts[drawn.pts.length - 1][0]}
              cy={drawn.pts[drawn.pts.length - 1][1]}
              r={4}
              fill={drawn.lineClr}
            />
            {hover && (
              <>
                <line
                  x1={drawn.pts[hover.i][0]}
                  y1={drawn.PAD_T}
                  x2={drawn.pts[hover.i][0]}
                  y2={drawn.baselineY}
                  stroke="#94a3b8"
                  strokeWidth={1}
                  strokeDasharray="2,3"
                />
                <circle
                  cx={drawn.pts[hover.i][0]}
                  cy={drawn.pts[hover.i][1]}
                  r={4}
                  fill="#fff"
                  stroke={drawn.lineClr}
                  strokeWidth={2}
                />
              </>
            )}
            {drawn.ticks.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={drawn.H - 4}
                fontSize={9}
                fill="#94a3b8"
                textAnchor={t.anchor as 'start' | 'middle' | 'end'}
                fontFamily="Inter, system-ui, sans-serif"
              >
                {t.label}
              </text>
            ))}
          </svg>
          {hover && (
            <div
              className={styles.tip}
              style={{
                left: Math.min(window.innerWidth - 180, hover.clientX + 14),
                top: Math.max(8, hover.clientY - 16),
              }}
            >
              <div className={styles.tipVal}>{fmtUsd(drawn.vals[hover.i])}</div>
              <div className={styles.tipDate}>{fmtTickDate(drawn.dates[hover.i])}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
