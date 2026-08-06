import { useEffect, useRef, useState } from 'react'
import styles from './perfCharts.module.css'

export type MonthlyBarPoint = {
  label?: string
  month?: string | number
  return_pct?: number | null
  end_balance?: number | null
  beg_balance?: number | null
  spy_ytd_pct?: number | null
  skip?: boolean
  deposits?: number
  withdrawals?: number
  dividends?: number
  cash_only_balance?: number | null
  movers?: Array<{ ticker?: string; contrib?: number }>
  perf_detail?: Record<string, number>
}

export type AllTimePoint = {
  label?: string
  year?: number
  return_pct?: number | null
  end_balance?: number | null
  beg_balance?: number | null
  cash_only_balance?: number | null
  deposits?: number
  withdrawals?: number
  dividends?: number
  skip?: boolean
  data_months?: number
  benchmark_return_pct?: number | null
  return_source?: string
  inception_month?: number
}

function fmtM(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtU(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return (
    '$' +
    Math.abs(Number(v)).toLocaleString('en-US', { maximumFractionDigits: 0 })
  )
}

/** YTD monthly portfolio return bars + benchmark overlay (pre-React parity). */
export function MonthlyBarChart({
  points,
  height = 220,
  benchLabel = 'Benchmark',
}: {
  points: MonthlyBarPoint[]
  height?: number
  benchLabel?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{
    html: string
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !points.length) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW = wrap.clientWidth || 700
      const cssH = height
      canvas.style.height = `${cssH}px`
      canvas.width = cssW * dpr
      canvas.height = cssH * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const W = cssW
      const H = cssH
      const padL = 56
      const padR = 14
      const padT = 16
      const padB = 32
      const chartW = W - padL - padR
      const chartH = H - padT - padB

      const spyMonthly = points.map((p, i) => {
        const curr = p.spy_ytd_pct
        if (curr == null) return null
        if (i === 0) return curr
        const prev = points[i - 1].spy_ytd_pct
        return prev != null ? curr - prev : curr
      })

      const returns = points.filter((p) => !p.skip).map((p) => p.return_pct || 0)
      const allVals = [
        ...returns,
        ...spyMonthly.filter((v, i) => v != null && !points[i]?.skip),
      ].map(Number)
      const maxAbs = Math.max(
        Math.abs(Math.min(...(allVals.length ? allVals : [0]))),
        Math.abs(Math.max(...(allVals.length ? allVals : [0]))),
        0.5,
      )
      const yRange = maxAbs * 1.25
      const yAt = (v: number) => padT + chartH * (1 - (v + yRange) / (2 * yRange))
      const y0 = yAt(0)

      ctx.clearRect(0, 0, W, H)

      // grid
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'
      ctx.lineWidth = 1
      ;[-yRange * 0.5, 0, yRange * 0.5, yRange].forEach((v) => {
        const y = yAt(v)
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(W - padR, y)
        ctx.stroke()
        ctx.fillStyle = '#64748b'
        ctx.font = '9.5px Inter, system-ui, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(
          `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
          padL - 5,
          y + 3.5,
        )
      })

      ctx.strokeStyle = 'rgba(0,0,0,0.15)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(padL, y0)
      ctx.lineTo(W - padR, y0)
      ctx.stroke()

      const n = points.length
      const totalSlot = chartW / n
      const barW = Math.max(8, Math.min(totalSlot * 0.55, 52))

      const barMeta = points.map((p, i) => {
        const x = padL + totalSlot * i + totalSlot / 2 - barW / 2
        const ret = p.return_pct || 0
        const barH = Math.abs(yAt(ret) - y0)
        const barY = ret >= 0 ? yAt(ret) : y0
        return { x, barW, barY, barH, ret, i, skip: !!p.skip }
      })

      barMeta.forEach(({ x, barW: bw, barY, barH, ret, skip }) => {
        if (skip) {
          ctx.globalAlpha = 0.25
          ctx.fillStyle = '#888'
          ctx.fillRect(x + bw * 0.3, y0 - 3, bw * 0.4, 6)
          ctx.globalAlpha = 1
          return
        }
        ctx.fillStyle = ret >= 0 ? '#1a7f40' : '#cc3333'
        ctx.beginPath()
        const r = 3
        if (ret >= 0) {
          ctx.moveTo(x + r, barY)
          ctx.lineTo(x + bw - r, barY)
          ctx.quadraticCurveTo(x + bw, barY, x + bw, barY + r)
          ctx.lineTo(x + bw, barY + barH)
          ctx.lineTo(x, barY + barH)
          ctx.lineTo(x, barY + r)
          ctx.quadraticCurveTo(x, barY, x + r, barY)
        } else {
          ctx.moveTo(x, barY)
          ctx.lineTo(x + bw, barY)
          ctx.lineTo(x + bw, barY + barH - r)
          ctx.quadraticCurveTo(x + bw, barY + barH, x + bw - r, barY + barH)
          ctx.lineTo(x + r, barY + barH)
          ctx.quadraticCurveTo(x, barY + barH, x, barY + barH - r)
          ctx.lineTo(x, barY)
        }
        ctx.closePath()
        ctx.fill()
      })

      // bench line
      ctx.strokeStyle = '#c9a84c'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1.8
      ctx.beginPath()
      let started = false
      spyMonthly.forEach((v, i) => {
        if (v == null) return
        const cx = padL + totalSlot * i + totalSlot / 2
        const cy = yAt(v)
        if (!started) {
          ctx.moveTo(cx, cy)
          started = true
        } else ctx.lineTo(cx, cy)
      })
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#c9a84c'
      spyMonthly.forEach((v, i) => {
        if (v == null) return
        const cx = padL + totalSlot * i + totalSlot / 2
        ctx.beginPath()
        ctx.arc(cx, yAt(v), 3.5, 0, Math.PI * 2)
        ctx.fill()
      })

      ctx.fillStyle = '#475569'
      ctx.font = '10px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      points.forEach((p, i) => {
        const cx = padL + totalSlot * i + totalSlot / 2
        ctx.fillText(String(p.label || p.month || ''), cx, H - 10)
      })

      canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        let hit = -1
        barMeta.forEach(({ x, barW: bw, i }) => {
          if (mx >= x - 6 && mx <= x + bw + 6) hit = i
        })
        if (hit < 0) {
          setTip(null)
          return
        }
        const p = points[hit]
        const spyRet = spyMonthly[hit]
        const curYear = new Date().getFullYear()
        let html = `<div style="font-weight:800;font-size:12px;margin-bottom:6px;color:#3e9ab8;">${p.label || ''} ${curYear}</div>`
        if (p.skip) {
          html += `<div style="color:#f59e0b;font-size:11px;">N/A — Custodial Transfer</div>`
        } else {
          const rc = (p.return_pct || 0) >= 0 ? '#16a34a' : '#dc2626'
          html += `<div style="display:flex;justify-content:space-between;gap:16px;"><span>Portfolio</span><span style="font-weight:700;color:${rc}">${fmtM(p.return_pct)}</span></div>`
          html += `<div style="display:flex;justify-content:space-between;gap:16px;"><span>${benchLabel}</span><span style="color:#c9a84c;font-weight:700;">${fmtM(spyRet)}</span></div>`
          if (p.end_balance != null)
            html += `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px;"><span>End bal</span><span>${fmtU(p.end_balance)}</span></div>`
        }
        setTip({ html, x: e.clientX, y: e.clientY })
      }
      canvas.onmouseleave = () => setTip(null)
    }

    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    return () => {
      ro.disconnect()
      canvas.onmousemove = null
      canvas.onmouseleave = null
    }
  }, [points, height, benchLabel])

  return (
    <div ref={wrapRef} className={styles.chartWrap}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <div className={styles.legend}>
        <span>
          <i className={styles.legGain} /> Portfolio gain
        </span>
        <span>
          <i className={styles.legLoss} /> Portfolio loss
        </span>
        <span>
          <i className={styles.legBench} /> {benchLabel} monthly
        </span>
      </div>
      {tip && (
        <div
          className={styles.tip}
          style={{
            left: Math.min(window.innerWidth - 220, tip.x + 14),
            top: Math.max(8, tip.y - 20),
          }}
          dangerouslySetInnerHTML={{ __html: tip.html }}
        />
      )}
    </div>
  )
}

/** All-time return bars + portfolio balance line (pre-React parity). */
export function AllTimePerfChart({
  points,
  height = 260,
}: {
  points: AllTimePoint[]
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{
    html: string
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !points.length) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW = wrap.clientWidth || 700
      const cssH = height
      canvas.style.height = `${cssH}px`
      canvas.width = cssW * dpr
      canvas.height = cssH * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const W = cssW
      const H = cssH
      const padL = 56
      const padR = 68
      const padT = 20
      const padB = 40
      const chartW = W - padL - padR
      const chartH = H - padT - padB

      const nonSkip = points.filter((p) => !p.skip)
      const returns = nonSkip.map((p) => p.return_pct || 0)
      const maxAbs = Math.max(
        Math.abs(Math.min(...(returns.length ? returns : [0]))),
        Math.abs(Math.max(...(returns.length ? returns : [0]))),
        0.5,
      )
      const yRange = maxAbs * 1.25
      const yAt = (v: number) => padT + chartH * (1 - (v + yRange) / (2 * yRange))
      const y0 = yAt(0)

      const balances = points
        .map((p) => p.end_balance)
        .filter((v): v is number => v != null && v > 0)
      const cashOnlys = points
        .map((p) => p.cash_only_balance)
        .filter((v): v is number => v != null && v > 0)
      const allDollar = [...balances, ...cashOnlys]
      const maxDollar = allDollar.length ? Math.max(...allDollar) * 1.12 : 1
      const minDollar = allDollar.length ? Math.min(...allDollar) * 0.88 : 0
      const yAtUSD = (v: number) =>
        padT + chartH * (1 - (v - minDollar) / Math.max(maxDollar - minDollar, 1))

      ctx.clearRect(0, 0, W, H)

      ctx.strokeStyle = 'rgba(0,0,0,0.08)'
      ctx.lineWidth = 1
      ;[-yRange * 0.5, 0, yRange * 0.5, yRange].forEach((v) => {
        const y = yAt(v)
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(W - padR, y)
        ctx.stroke()
        ctx.fillStyle = '#64748b'
        ctx.font = '9.5px Inter, system-ui, sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(
          `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
          padL - 5,
          y + 3.5,
        )
      })

      // right axis $
      const dollarTicks = 4
      ctx.fillStyle = '#64748b'
      ctx.font = '9px Inter, system-ui, sans-serif'
      ctx.textAlign = 'left'
      for (let i = 0; i <= dollarTicks; i++) {
        const v = minDollar + ((maxDollar - minDollar) * i) / dollarTicks
        const y = yAtUSD(v)
        const label =
          v >= 1e6
            ? `$${(v / 1e6).toFixed(1)}M`
            : v >= 1e3
              ? `$${(v / 1e3).toFixed(0)}K`
              : `$${v.toFixed(0)}`
        ctx.fillText(label, W - padR + 4, y + 3.5)
      }

      ctx.strokeStyle = 'rgba(0,0,0,0.15)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(padL, y0)
      ctx.lineTo(W - padR, y0)
      ctx.stroke()

      const n = points.length
      const totalSlot = chartW / n
      const barW = Math.max(6, Math.min(totalSlot * 0.6, 52))
      const barMeta = points.map((p, i) => {
        const x = padL + totalSlot * i + totalSlot / 2 - barW / 2
        const ret = p.return_pct || 0
        const barH = Math.abs(yAt(ret) - y0)
        const barY = ret >= 0 ? yAt(ret) : y0
        return { x, barW, barY, barH, ret, i, skip: !!p.skip }
      })

      barMeta.forEach(({ x, barW: bw, barY, barH, ret, skip }) => {
        if (skip) {
          ctx.globalAlpha = 0.25
          ctx.fillStyle = '#888'
          ctx.fillRect(x + bw * 0.3, y0 - 3, bw * 0.4, 6)
          ctx.globalAlpha = 1
          return
        }
        ctx.fillStyle = ret >= 0 ? '#1a7f40' : '#cc3333'
        ctx.fillRect(x, barY, bw, Math.max(barH, 1))
      })

      // balance line
      ctx.strokeStyle = '#5BB8D4'
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.beginPath()
      let started = false
      points.forEach((p, i) => {
        if (p.end_balance == null) return
        const x = padL + totalSlot * i + totalSlot / 2
        const y = yAtUSD(p.end_balance)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      })
      if (started) ctx.stroke()
      ctx.fillStyle = '#5BB8D4'
      points.forEach((p, i) => {
        if (p.end_balance == null) return
        const x = padL + totalSlot * i + totalSlot / 2
        ctx.beginPath()
        ctx.arc(x, yAtUSD(p.end_balance), 2.5, 0, Math.PI * 2)
        ctx.fill()
      })

      // cash-only dashed
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      let cStarted = false
      points.forEach((p, i) => {
        if (p.cash_only_balance == null) return
        const x = padL + totalSlot * i + totalSlot / 2
        const y = yAtUSD(p.cash_only_balance)
        if (!cStarted) {
          ctx.moveTo(x, y)
          cStarted = true
        } else ctx.lineTo(x, y)
      })
      if (cStarted) ctx.stroke()
      ctx.setLineDash([])

      // legend
      ctx.font = '9px Inter, system-ui, sans-serif'
      ctx.fillStyle = '#5BB8D4'
      ctx.fillRect(padL + 6, padT + 5, 16, 2)
      ctx.fillStyle = '#1e293b'
      ctx.textAlign = 'left'
      ctx.fillText('Portfolio Balance', padL + 26, padT + 10)
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(padL + 120, padT + 6)
      ctx.lineTo(padL + 136, padT + 6)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#64748b'
      ctx.fillText('If Not Invested', padL + 140, padT + 10)

      // x labels
      ctx.fillStyle = '#475569'
      ctx.font = '9.5px Inter, system-ui, sans-serif'
      const skipEvery = n > 24 ? 3 : n > 12 ? 2 : 1
      points.forEach((p, i) => {
        if (i % skipEvery !== 0) return
        const cx = padL + totalSlot * i + totalSlot / 2
        ctx.save()
        ctx.translate(cx, H - padB + 8)
        ctx.rotate(-Math.PI / 4)
        ctx.textAlign = 'right'
        ctx.fillText(String(p.label || p.year || ''), 0, 0)
        ctx.restore()
      })

      canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        let hit = -1
        barMeta.forEach(({ x, barW: bw, i }) => {
          if (mx >= x - 6 && mx <= x + bw + 6) hit = i
        })
        if (hit < 0) {
          setTip(null)
          return
        }
        const p = points[hit]
        let html = `<div style="font-weight:800;font-size:12px;margin-bottom:6px;color:#3e9ab8;">${p.label || ''}</div>`
        if (p.skip) {
          html += `<div style="color:#f59e0b;font-size:11px;">N/A — Custodial Transfer</div>`
        } else {
          const rc = (p.return_pct || 0) >= 0 ? '#16a34a' : '#dc2626'
          html += `<div style="display:flex;justify-content:space-between;gap:16px;"><span>Return</span><span style="font-weight:700;color:${rc}">${fmtM(p.return_pct)}</span></div>`
          if (p.end_balance != null)
            html += `<div style="display:flex;justify-content:space-between;gap:16px;"><span>Ending Balance</span><span>${fmtU(p.end_balance)}</span></div>`
          if (p.cash_only_balance != null)
            html += `<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b">If Not Invested</span><span style="color:#64748b">${fmtU(p.cash_only_balance)}</span></div>`
          const net = (p.deposits || 0) - (p.withdrawals || 0)
          if (net !== 0)
            html += `<div style="display:flex;justify-content:space-between;gap:16px;"><span>Net Deposits</span><span>${net >= 0 ? '+' : '−'}${fmtU(Math.abs(net))}</span></div>`
        }
        setTip({ html, x: e.clientX, y: e.clientY })
      }
      canvas.onmouseleave = () => setTip(null)
    }

    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    return () => {
      ro.disconnect()
      canvas.onmousemove = null
      canvas.onmouseleave = null
    }
  }, [points, height])

  return (
    <div ref={wrapRef} className={styles.chartWrap}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {tip && (
        <div
          className={styles.tip}
          style={{
            left: Math.min(window.innerWidth - 240, tip.x + 14),
            top: Math.max(8, tip.y - 20),
          }}
          dangerouslySetInnerHTML={{ __html: tip.html }}
        />
      )}
    </div>
  )
}
