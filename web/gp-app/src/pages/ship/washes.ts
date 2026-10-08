/** Company stripes inside a sleeve. Weights come from the live book. */

export type BandInput = { symbol: string; weight_pct: number }

export type CompanyBand = {
  symbol: string
  share: number
  label: boolean
  scale: number
}

const LABEL_SHARE = 0.12
const LABEL_CAP = 4

export function companyBands(holdings: BandInput[]): CompanyBand[] {
  const rows = holdings.filter((row) => row.symbol)
  if (!rows.length) return []
  const sorted = [...rows].sort(
    (a, b) => b.weight_pct - a.weight_pct || a.symbol.localeCompare(b.symbol),
  )
  const sum = sorted.reduce((total, row) => total + Math.max(0, row.weight_pct), 0)
  const equal = sum <= 0
  let labels = 0
  return sorted.map((row) => {
    const share = equal ? 1 / sorted.length : Math.max(0, row.weight_pct) / sum
    const want = !equal && share >= LABEL_SHARE && labels < LABEL_CAP
    if (want) labels += 1
    return {
      symbol: row.symbol,
      share,
      label: want,
      scale: 0.62 + Math.min(share, 0.55) * 1.15,
    }
  })
}
