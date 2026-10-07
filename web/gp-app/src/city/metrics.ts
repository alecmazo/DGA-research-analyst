/** Server heights only. This module does not divide dollars. */

export type Metric = 'market_cap' | 'position_value' | 'total_assets'

export type EquityBand = { side: 'up' | 'down'; fraction: number } | null

export type Sized = {
  size: {
    height_by_market_cap: number | null
    height_by_position_value: number | null
    height_by_total_assets: number | null
    footprint: number
    footprint_by_market_cap?: number | null
    footprint_by_position_value?: number | null
    footprint_by_total_assets?: number | null
  }
}

const STUB = 8

export function metricHeight(company: Sized, metric: Metric): number | null {
  if (metric === 'market_cap') return company.size.height_by_market_cap
  if (metric === 'total_assets') return company.size.height_by_total_assets
  return company.size.height_by_position_value
}

export function metricFootprint(company: Sized, metric: Metric): number | null {
  if (metric === 'market_cap') return company.size.footprint_by_market_cap ?? null
  if (metric === 'total_assets') return company.size.footprint_by_total_assets ?? null
  return company.size.footprint_by_position_value ?? company.size.footprint
}

/** A missing metric is the short stub. The stub is not a computed dollar height. */
export function shownHeight(company: Sized, metric: Metric): number {
  const height = metricHeight(company, metric)
  return height == null ? STUB : height
}

export function shownFootprint(company: Sized, metric: Metric): number {
  const foot = metricFootprint(company, metric)
  return foot == null ? company.size.footprint : foot
}

/** Glass span from the server fraction. `below` is the garage under the street. */
export function equityGlass(height: number, band: EquityBand): { y: number; h: number; below: boolean } | null {
  if (!band || !(band.fraction > 0)) return null
  const h = height * band.fraction
  if (band.side === 'down') return { y: -h / 2, h, below: true }
  return { y: h / 2, h, below: false }
}

/** Weekday steps from the snapshot date to `now`. A time-only string is not stale. */
export function tradingDaysSince(asOf: string, now: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOf || '')
  if (!match) return null
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (start >= end) return 0
  let days = 0
  for (let t = start + 86_400_000; t <= end; t += 86_400_000) {
    const dow = new Date(t).getUTCDay()
    if (dow !== 0 && dow !== 6) days += 1
  }
  return days
}

export function isStale(asOf: string, now: Date): boolean {
  const days = tradingDaysSince(asOf, now)
  return days != null && days > 2
}
