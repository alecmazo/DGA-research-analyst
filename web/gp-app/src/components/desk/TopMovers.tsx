import { useCallback, useEffect, useState } from 'react'
import { api, type MarketMoversResponse } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import styles from './deskWidgets.module.css'

function fmtMcap(v?: number | null): string {
  if (v == null || !Number.isFinite(Number(v))) return ''
  const n = Number(v)
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${Math.round(n)}`
}

function sessLabel(iso?: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function TopMovers({
  onPeek,
  bare = false,
}: {
  onPeek?: (ticker: string) => void
  bare?: boolean
}) {
  const [data, setData] = useState<MarketMoversResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (force = false) => {
    setBusy(true)
    try {
      const q =
        '/api/market/movers?limit=10&min_market_cap=1000000000' +
        (force ? '&force=true' : '')
      const d = await api<MarketMoversResponse>(q)
      setData(d)
      setErr(d?.error && !(d.movers || []).length ? d.error : null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Movers unavailable')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
    const id = window.setInterval(() => {
      if (document.hidden) return
      void load(false)
    }, 90_000)
    const onVis = () => {
      if (document.hidden) return
      void load(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  const movers = data?.movers || []
  const upN = movers.filter((m) => Number(m.pct_change) > 0).length
  const dnN = movers.filter((m) => Number(m.pct_change) < 0).length
  const sess = sessLabel(data?.session_date)

  const body = (
    <div className={styles.moversEmbed}>
      <div className={styles.wireToolbar}>
        <span className={styles.wireHint}>
          {busy && !movers.length
            ? 'Loading…'
            : [
                sess || null,
                data?.as_of ? `as of ${data.as_of}` : null,
                movers.length ? `${upN} up · ${dnN} down` : null,
                data?.stale ? 'stale' : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {busy ? '…' : '↻'}
        </Button>
      </div>
      <div className={styles.moversList}>
        {err && !movers.length && <div className={styles.wireEmpty}>{err}</div>}
        {!err && !movers.length && (
          <div className={styles.wireEmpty}>
            {busy
              ? 'Loading today’s $1B+ movers…'
              : 'No $1B+ movers yet — market may be closed.'}
          </div>
        )}
        {movers.map((m, i) => {
          const pct = m.pct_change == null ? null : Number(m.pct_change)
          const dir = pct == null ? '' : pct >= 0 ? '▲' : '▼'
          const tk = (m.ticker || '').toUpperCase()
          return (
            <button
              key={tk || i}
              type="button"
              className={styles.moversRow}
              onClick={() => tk && onPeek?.(tk)}
              title={tk ? `Snapshot for ${tk}` : undefined}
            >
              <span className={styles.moversRank}>{i + 1}</span>
              <span className={styles.moversMain}>
                <span className={styles.moversTk}>{tk || '—'}</span>
                <span className={styles.moversName}>
                  {(m.name || '').slice(0, 32) || '—'}
                  {m.market_cap != null ? ` · ${fmtMcap(m.market_cap)}` : ''}
                </span>
              </span>
              <span className={styles.moversRight}>
                <span className={`tabular ${styles.moversPx}`}>
                  {fmtPx(m.price)}
                </span>
                <span className={`tabular ${styles.moversChg} ${pctClass(pct)}`}>
                  {dir} {fmtPct(pct)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className={styles.wireFoot}>
        US stocks · $1B+ mkt cap · Yahoo screeners · no LLM
      </div>
    </div>
  )

  if (bare) return body
  return body
}
