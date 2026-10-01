import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type MarketMoversResponse,
  type MarketPulseResponse,
  type PulseHeadline,
  type PulseNewsItem,
} from '@/lib/api'
import { delayAfterWatchlist } from '@/lib/deskBoot'
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

function ageFromTs(ts?: number | null): string {
  if (ts == null || !Number.isFinite(Number(ts))) return ''
  const sec = Math.max(0, Date.now() / 1000 - Number(ts))
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

function newsItems(row?: PulseHeadline | null): PulseNewsItem[] {
  const items = row?.items || []
  if (items.length) return items
  const title = (row?.headline || '').trim()
  if (!title) return []
  return [
    {
      title,
      url: row?.url,
      publisher: row?.publisher,
      pub_ts: row?.pub_ts,
      source: row?.source,
    },
  ]
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
  const [openTk, setOpenTk] = useState<string | null>(null)
  const [news, setNews] = useState<Record<string, PulseHeadline>>({})
  const [newsBusy, setNewsBusy] = useState<Record<string, boolean>>({})

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

  const loadNews = useCallback(async (tk: string) => {
    setNewsBusy((s) => ({ ...s, [tk]: true }))
    try {
      const d = await api<MarketPulseResponse>(
        `/api/market/pulse?limit=8&merge=true&tickers=${encodeURIComponent(tk)}`,
      )
      const row = d?.results?.[tk] || d?.results?.[tk.toUpperCase()]
      setNews((s) => ({ ...s, [tk]: row || { headline: '' } }))
    } catch {
      /* leave unset so the next open tries again */
    } finally {
      setNewsBusy((s) => ({ ...s, [tk]: false }))
    }
  }, [])

  const toggleRow = (tk: string) => {
    if (!tk) return
    const next = openTk === tk ? null : tk
    setOpenTk(next)
    if (next && !news[tk] && !newsBusy[tk]) void loadNews(tk)
  }

  useEffect(() => {
    let interval = 0
    const onVis = () => {
      if (document.hidden) return
      void load(false)
    }
    const stopFirst = delayAfterWatchlist(900, () => {
      void load(false)
      interval = window.setInterval(() => {
        if (document.hidden) return
        void load(false)
      }, 90_000)
      document.addEventListener('visibilitychange', onVis)
    })
    return () => {
      stopFirst()
      window.clearInterval(interval)
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
          const open = openTk === tk
          const row = news[tk]
          const list = newsItems(row)
          return (
            <div key={tk || i}>
              <div
                className={`${styles.moversRow} ${open ? styles.moversRowOpen : ''}`}
                role="button"
                tabIndex={0}
                title="Click for latest headlines"
                onClick={() => toggleRow(tk)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleRow(tk)
                  }
                }}
              >
                <span className={styles.moversRank}>{i + 1}</span>
                <span className={styles.moversMain}>
                  <button
                    type="button"
                    className={styles.moversTkBtn}
                    title={tk ? `Snapshot for ${tk}` : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (tk) onPeek?.(tk)
                    }}
                  >
                    <span className={styles.moversTk}>{tk || '—'}</span>
                  </button>
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
                <span className={styles.moversMore} aria-hidden>
                  {open ? '▾' : '▸'}
                </span>
              </div>
              {open && (
                <div className={styles.pulseHeadList}>
                  {newsBusy[tk] && list.length === 0 && (
                    <div className={styles.pulseHeadEmpty}>Loading headlines…</div>
                  )}
                  {list.map((it, n) => {
                    const title = (it.title || '').trim()
                    const href = (it.url || '').trim()
                    const age = ageFromTs(it.pub_ts)
                    const inner = (
                      <>
                        <span className={styles.pulseHeadMeta}>
                          {age ? `${age} ago` : '—'}
                          {it.publisher ? ` · ${it.publisher}` : ''}
                        </span>
                        <span className={styles.pulseHeadTitle}>{title || '—'}</span>
                      </>
                    )
                    return href ? (
                      <a
                        key={`${tk}-${n}-${href}`}
                        className={styles.pulseHeadItem}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {inner}
                      </a>
                    ) : (
                      <div key={`${tk}-${n}-${title}`} className={styles.pulseHeadItem}>
                        {inner}
                      </div>
                    )
                  })}
                  {!list.length && !newsBusy[tk] && (
                    <div className={styles.pulseHeadEmpty}>
                      No public headlines for {tk}.
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className={styles.wireFoot}>
        US stocks · $1B+ mkt cap · Yahoo screeners · headlines from Yahoo / Google News · no LLM
      </div>
    </div>
  )

  if (bare) return body
  return body
}
