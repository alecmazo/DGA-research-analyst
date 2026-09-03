import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type Quote,
  type MarketPulseResponse,
  type PulseHeadline,
  type PulseNewsItem,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { fmtPct, pctClass } from '@/lib/format'
import styles from './deskWidgets.module.css'

type PulseResp = MarketPulseResponse

function quotePct(q?: Quote | null): number | null {
  if (!q) return null
  const v = q.pct ?? q.pct_change
  return v == null || Number.isNaN(Number(v)) ? null : Number(v)
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

export function MarketPulse({
  watchlist = [],
  quotes = {},
  onPeek,
  bare = false,
}: {
  watchlist?: string[]
  quotes?: Record<string, Quote>
  onPeek?: (ticker: string) => void
  bare?: boolean
}) {
  const [data, setData] = useState<PulseResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [openTk, setOpenTk] = useState<string | null>(null)
  const [extra, setExtra] = useState<Record<string, PulseHeadline>>({})
  const [extraBusy, setExtraBusy] = useState<Record<string, boolean>>({})

  const tickers = useMemo(
    () =>
      [...new Set(watchlist.map((t) => String(t || '').toUpperCase()).filter(Boolean))],
    [watchlist],
  )

  const load = useCallback(
    async (force = false) => {
      if (!tickers.length) {
        setData({ ok: true, results: {}, count: 0 })
        setErr(null)
        return
      }
      setBusy(true)
      try {
        const q =
          `/api/market/pulse?limit=6&tickers=${encodeURIComponent(tickers.join(','))}` +
          (force ? '&force=true' : '')
        const d = await api<PulseResp>(q)
        setData(d)
        setErr(null)
        if (force) setExtra({})
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Headlines unavailable')
      } finally {
        setBusy(false)
      }
    },
    [tickers],
  )

  const loadMore = useCallback(async (tk: string) => {
    setExtraBusy((s) => ({ ...s, [tk]: true }))
    try {
      const d = await api<PulseResp>(
        `/api/market/pulse?limit=8&merge=true&tickers=${encodeURIComponent(tk)}`,
      )
      const row = d?.results?.[tk] || d?.results?.[tk.toUpperCase()]
      if (row) setExtra((s) => ({ ...s, [tk]: row }))
    } catch {
      /* keep whatever we already have on the row */
    } finally {
      setExtraBusy((s) => ({ ...s, [tk]: false }))
    }
  }, [])

  useEffect(() => {
    void load(false)
    const id = window.setInterval(() => {
      if (document.hidden) return
      void load(false)
    }, 5 * 60_000)
    const onVis = () => {
      if (!document.hidden) void load(false)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  const entries = useMemo(() => {
    const results = data?.results || {}
    return tickers
      .map((tk) => {
        const q = quotes[tk] || quotes[tk.toUpperCase()]
        const pct = quotePct(q)
        const row = extra[tk] || results[tk] || results[tk.toUpperCase()] || {}
        return {
          tk,
          pct,
          abs: pct == null ? -1 : Math.abs(pct),
          row,
        }
      })
      .sort((a, b) => b.abs - a.abs || a.tk.localeCompare(b.tk))
  }, [tickers, quotes, data, extra])

  const withNews = entries.filter((e) => e.row.headline).length

  const toggleRow = (tk: string) => {
    const next = openTk === tk ? null : tk
    setOpenTk(next)
    if (next && !extra[tk] && !extraBusy[tk]) {
      void loadMore(tk)
    }
  }

  const body = (
    <div className={styles.pulseEmbed}>
      <div className={styles.pulseToolbar}>
        <span className={styles.wireHint}>
          {busy && !data
            ? 'Loading…'
            : [
                data?.as_of ? `as of ${data.as_of}` : null,
                tickers.length ? `${withNews}/${tickers.length}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
        </span>
        <div className={styles.pulseActions}>
          <button
            type="button"
            className={styles.pulseInfoBtn}
            title="What Market Pulse does"
            onClick={() => setInfoOpen((o) => !o)}
          >
            *
          </button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !tickers.length}
            onClick={() => void load(true)}
          >
            {busy ? '…' : '↻'}
          </Button>
        </div>
      </div>
      {infoOpen && (
        <div className={styles.pulseInfo}>
          Newest public headline for each watchlist name, from Yahoo Finance
          and Google News RSS. No LLM. Ranked by |day %|. Click the ticker
          for a snapshot, the headline to open the article, or empty space
          on the row for the latest headlines.
        </div>
      )}
      <div className={styles.pulseList}>
        {err && !entries.length && <div className={styles.wireEmpty}>{err}</div>}
        {!tickers.length && (
          <div className={styles.wireEmpty}>
            Add tickers to the watchlist to see today’s headlines.
          </div>
        )}
        {!!tickers.length && !err && !entries.length && (
          <div className={styles.wireEmpty}>
            {busy ? 'Loading headlines…' : 'No headlines yet.'}
          </div>
        )}
        {entries.map(({ tk, pct, row }) => {
          const age = ageFromTs(row.pub_ts)
          const title = (row.headline || '').trim()
          const href = (row.url || '').trim()
          const open = openTk === tk
          const list = newsItems(row)
          return (
            <div key={tk}>
              <div
                className={`${styles.pulseRow} ${open ? styles.pulseRowOpen : ''}`}
                role="button"
                tabIndex={0}
                title="Click empty space for latest headlines"
                onClick={() => toggleRow(tk)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleRow(tk)
                  }
                }}
              >
                <button
                  type="button"
                  className={styles.pulseTkBtn}
                  title={`Snapshot for ${tk}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPeek?.(tk)
                  }}
                >
                  <span className={styles.pulseTk}>{tk}</span>
                </button>
                {pct != null && (
                  <span className={`tabular ${styles.pulseDay} ${pctClass(pct)}`}>
                    {fmtPct(pct)}
                  </span>
                )}
                {row.publisher ? (
                  <span className={styles.pulsePub}>{row.publisher}</span>
                ) : null}
                {age ? <span className={styles.pulseAge}>{age} ago</span> : null}
                <span className={styles.pulseMore} aria-hidden>
                  {open ? '▾' : '▸'}
                </span>
                {href && title ? (
                  <a
                    className={styles.pulseHeadline}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={title}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {title}
                  </a>
                ) : (
                  <span className={styles.pulseHeadline}>
                    {title || (busy ? '…' : 'No recent headline')}
                  </span>
                )}
              </div>
              {open && (
                <div className={styles.pulseHeadList}>
                  {extraBusy[tk] && list.length < 2 && (
                    <div className={styles.pulseHeadEmpty}>Loading headlines…</div>
                  )}
                  {list.map((it, i) => {
                    const t = (it.title || '').trim()
                    const u = (it.url || '').trim()
                    const a = ageFromTs(it.pub_ts)
                    const inner = (
                      <>
                        <span className={styles.pulseHeadMeta}>
                          {a ? `${a} ago` : '—'}
                          {it.publisher ? ` · ${it.publisher}` : ''}
                        </span>
                        <span className={styles.pulseHeadTitle}>{t || '—'}</span>
                      </>
                    )
                    return u ? (
                      <a
                        key={`${tk}-${i}-${u}`}
                        className={styles.pulseHeadItem}
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {inner}
                      </a>
                    ) : (
                      <div key={`${tk}-${i}-${t}`} className={styles.pulseHeadItem}>
                        {inner}
                      </div>
                    )
                  })}
                  {!list.length && !extraBusy[tk] && (
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
        Watchlist · Yahoo / Google News RSS · no LLM
      </div>
    </div>
  )

  if (bare) return body
  return body
}
