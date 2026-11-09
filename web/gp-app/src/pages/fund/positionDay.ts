/** Dollar move of a position from the prior close.

`dayPct` is (last − previous close) / previous close, in percent points.
Market value is last × shares, so the dollar change is
market value × dayPct / (100 + dayPct).
*/
export function positionDayDollars(
  marketValue: number | null | undefined,
  dayPct: number | null | undefined,
): number | null {
  if (marketValue == null || dayPct == null) return null
  const mv = Number(marketValue)
  const pct = Number(dayPct)
  if (!Number.isFinite(mv) || !Number.isFinite(pct)) return null
  const denom = 100 + pct
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-6) return null
  return mv * (pct / denom)
}

/** Compound period returns into the year-to-date level at each row. */
export function portfolioYtdPath(
  points: Array<{ return_pct?: number | null; skip?: boolean }>,
): Array<number | null> {
  let prod = 1
  let started = false
  return points.map((p) => {
    const raw = p.return_pct
    const missing = Boolean(p.skip) || raw == null || Number.isNaN(Number(raw))
    if (missing) return started ? (prod - 1) * 100 : null
    prod *= 1 + Number(raw) / 100
    started = true
    return (prod - 1) * 100
  })
}
