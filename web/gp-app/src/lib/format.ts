export function fmtPx(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `$${Number(v).toFixed(digits)}`
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(digits)}%`
}

export function fmtUsd(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number(v))
}

export function pctClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return ''
  if (Number(v) > 0) return 'pos'
  if (Number(v) < 0) return 'neg'
  return ''
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const t = new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime()
    const mins = Math.round((Date.now() - t) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const h = Math.round(mins / 60)
    if (h < 48) return `${h}h ago`
    return `${Math.round(h / 24)}d ago`
  } catch {
    return ''
  }
}
