import styles from '../FinancialsPage.module.css'

type SparkProps = {
  vals: Array<number | null | undefined>
  w?: number
  h?: number
  color?: string
}

export function Sparkline({ vals, w = 150, h = 34, color }: SparkProps) {
  const pad = 3
  const nums = vals.filter((v): v is number => v != null && Number.isFinite(v))
  if (nums.length < 2) return null
  let mn = Math.min(...nums)
  let mx = Math.max(...nums)
  if (mn === mx) {
    mn -= 1
    mx += 1
  }
  const span = mx - mn
  const n = vals.length
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, n - 1)
  const y = (v: number) => pad + (h - 2 * pad) * (1 - (v - mn) / span)
  let d = ''
  let started = false
  vals.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) return
    d += `${started ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `
    started = true
  })
  const col =
    color || (nums[nums.length - 1]! >= nums[0]! ? '#16a34a' : '#dc2626')
  let li = -1
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i] != null && Number.isFinite(vals[i] as number)) {
      li = i
      break
    }
  }
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={styles.spark}
      aria-hidden
    >
      {mn < 0 && mx > 0 && (
        <line
          x1={pad}
          y1={y(0)}
          x2={w - pad}
          y2={y(0)}
          stroke="var(--border-subtle)"
          strokeWidth={1}
          strokeDasharray="2,2"
        />
      )}
      <path d={d.trim()} fill="none" stroke={col} strokeWidth={1.5} />
      {li >= 0 && (
        <circle
          cx={x(li)}
          cy={y(vals[li] as number)}
          r={2}
          fill={col}
        />
      )}
    </svg>
  )
}

export function SparkCard({
  label,
  vals,
  fmt,
}: {
  label: string
  vals: Array<number | null | undefined>
  fmt: (v: number | null | undefined) => string
}) {
  let last: number | undefined
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i]
    if (v != null && Number.isFinite(v)) {
      last = v
      break
    }
  }
  const svg = <Sparkline vals={vals} />
  if (!svg) return null
  return (
    <div className={styles.sparkCard}>
      <div className={styles.sparkLbl}>{label}</div>
      <div className={`${styles.sparkVal} tabular`}>
        {last !== undefined ? fmt(last) : '—'}
      </div>
      {svg}
    </div>
  )
}

/** Mini bar-history spark for rank cards (self history). */
export function HistBars({
  series,
  title,
}: {
  series: Array<{ as_of?: string; value?: number | null }>
  title?: string
}) {
  if (!series || series.length < 2) return null
  const vals = series
    .map((p) => p.value)
    .filter((v): v is number => v != null && !Number.isNaN(v))
  if (vals.length < 2) return null
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  return (
    <div className={styles.histWrap} title={title || 'History'}>
      <div className={styles.histBars}>
        {series.map((p, i) => {
          if (p.value == null || Number.isNaN(p.value)) {
            return <span key={i} style={{ height: 2 }} className={styles.histBarEmpty} />
          }
          const h = Math.max(3, Math.round(((p.value - lo) / span) * 20))
          return (
            <span
              key={i}
              className={styles.histBar}
              style={{ height: h }}
              title={`${p.as_of || ''}: ${p.value}`}
            />
          )
        })}
      </div>
      <div className={styles.histNote}>
        vs itself over time · {series.length} snapshots
      </div>
    </div>
  )
}
