import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Quote, type MarketPulseResponse } from '@/lib/api'
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
          `/api/market/pulse?limit=1&tickers=${encodeURIComponent(tickers.join(','))}` +
          (force ? '&force=true' : '')
        const d = await api<PulseResp>(q)
        setData(d)
        setErr(null)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Headlines unavailable')
      } finally {
        setBusy(false)
      }
    },
    [tickers],
  )

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
        const row = results[tk] || results[tk.toUpperCase()] || {}
        return {
          tk,
          pct,
          abs: pct == null ? -1 : Math.abs(pct),
          row,
        }
      })
      .sort((a, b) => b.abs - a.abs || a.tk.localeCompare(b.tk))
  }, [tickers, quotes, data])

  const withNews = entries.filter((e) => e.row.headline).length

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
          and Google News RSS. No LLM, no paid news API. Ranked by |day %|
          like the watchlist. Click the ticker for a snapshot, the headline
          to open the article.
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
          return (
            <div key={tk} className={styles.pulseRow}>
              <button
                type="button"
                className={styles.pulseTkBtn}
                title={`Snapshot for ${tk}`}
                onClick={() => onPeek?.(tk)}
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
              {href && title ? (
                <a
                  className={styles.pulseHeadline}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={title}
                >
                  {title}
                </a>
              ) : (
                <span className={styles.pulseHeadline}>
                  {title || (busy ? '…' : 'No recent headline')}
                </span>
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
