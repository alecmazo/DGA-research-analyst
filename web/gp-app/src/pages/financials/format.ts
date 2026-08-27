/** Financials-tab formatters (legacy gp-main.js parity). */

export function finMoneyM(v: number | null | undefined): string {
  if (v == null || v === ('' as unknown) || !Number.isFinite(Number(v))) return '—'
  const n = Number(v) / 1e6
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function finPctFrac(v: number | null | undefined): string {
  if (v == null || v === ('' as unknown) || !Number.isFinite(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(1)}%`
}

export function finEps(v: number | null | undefined): string {
  if (v == null || v === ('' as unknown) || !Number.isFinite(Number(v))) return '—'
  return Number(v).toFixed(2)
}

export function finColFmt(
  kind: 'm' | 'pct' | 'eps',
  v: number | null | undefined,
): string {
  if (kind === 'm') return finMoneyM(v)
  if (kind === 'pct') return finPctFrac(v)
  return finEps(v)
}

/** Market-cap / EV — trillions aware. */
export function gfCap(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`
  return `${s}$${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

/** Chart money axis: millions / billions. */
export function gfMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v) / 1e6
  const a = Math.abs(n)
  return (
    (n < 0 ? '−' : '') +
    (a >= 1000
      ? `${(a / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`
      : `${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}M`)
  )
}

export function gfCount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  return (
    (n < 0 ? '−' : '') +
    (a >= 1e9
      ? `${(a / 1e9).toFixed(1)}B`
      : a >= 1e6
        ? `${(a / 1e6).toFixed(0)}M`
        : a.toLocaleString('en-US'))
  )
}

export function gradeColor(v: number | null | undefined): string {
  if (v == null) return 'var(--text-tertiary)'
  if (v >= 80) return '#16a34a'
  if (v >= 60) return '#65a30d'
  if (v >= 40) return '#f59e0b'
  return '#dc2626'
}

export function rankColor(rank: number | null | undefined): string {
  if (rank == null) return 'var(--text-tertiary)'
  if (rank >= 7) return '#16a34a'
  if (rank >= 4) return '#f59e0b'
  return '#dc2626'
}

export function verdictColor(v: string | null | undefined): string {
  const map: Record<string, string> = {
    'Significantly Undervalued': '#16a34a',
    Undervalued: '#65a30d',
    'Fairly Valued': '#f59e0b',
    Overvalued: '#ea580c',
    'Significantly Overvalued': '#dc2626',
  }
  return (v && map[v]) || '#7c5e00'
}

export function rkFmt(v: number | null | undefined, fmt?: string): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  if (fmt === 'pct') return `${n.toFixed(2)}%`
  if (fmt === 'int') return String(Math.round(n))
  if (fmt === 'score10') return `${Math.round(n)}/10`
  if (fmt === 'spread') return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
  if (fmt === 'x_ge') return `≥${n.toFixed(2)}`
  return n.toFixed(2)
}

export function vlMoney(
  v: number | string | null | undefined,
  unit?: string,
): string {
  if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) return '—'
  const x = Number(v)
  if (!Number.isFinite(x)) return String(v)
  if (unit === '%') return `${x.toFixed(1)}%`
  if (unit === 'x') return `${x.toFixed(2)}×`
  if (unit === '$/sh')
    return `$${x.toLocaleString('en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`
  if (unit === 'sh') {
    const a = Math.abs(x)
    if (a >= 1e9) return `${(x / 1e9).toFixed(2)}B`
    if (a >= 1e6) return `${(x / 1e6).toFixed(1)}M`
    return x.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  const a = Math.abs(x)
  const s = x < 0 ? '−' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${a.toFixed(0)}`
}

export function sgnColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return 'var(--text-primary)'
  return Number(v) >= 0 ? '#16a34a' : '#dc2626'
}

export function notesText(
  notes: Record<string, string> | string | string[] | null | undefined,
): string {
  if (notes == null) return ''
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) return notes.map(String).join('\n')
  if (typeof notes === 'object') {
    return ['pe', 'roic', 'wacc', 'share_delta', 'peers', 'tokens', 'history', 'filings']
      .map((k) => notes[k])
      .filter(Boolean)
      .join(' · ')
  }
  return String(notes)
}

export function peerList(
  peers: import('./types').PeersBlock | import('./types').PeerRow[] | undefined,
): import('./types').PeerRow[] {
  if (!peers) return []
  if (Array.isArray(peers)) return peers
  return Array.isArray(peers.peers) ? peers.peers : []
}

export function peerMeta(
  peers: import('./types').PeersBlock | import('./types').PeerRow[] | undefined,
): import('./types').PeersBlock {
  if (!peers) return {}
  if (Array.isArray(peers)) return { peers }
  return peers
}
