import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type Quote,
  type MarketPulseResponse,
  type PulseHeadline,
  type PulseNewsItem,
  type SavedReport,
  type ValuationApproach,
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

function valChipClass(
  tone?: string | null,
  intensity?: number | null,
): string {
  const i = Number(intensity) || 0
  const t = String(tone || '').toLowerCase()
  if (t === 'under' || t === 'undervalued') {
    if (i < 0.35) return styles.valUnder0
    if (i < 0.6) return styles.valUnder1
    if (i < 0.8) return styles.valUnder2
    return styles.valUnder3
  }
  if (t === 'over' || t === 'overvalued') {
    if (i < 0.35) return styles.valOver0
    if (i < 0.6) return styles.valOver1
    if (i < 0.8) return styles.valOver2
    return styles.valOver3
  }
  if (t === 'fair') return styles.valFair
  return styles.valNone
}

function approachChips(rep?: SavedReport | null): ValuationApproach[] {
  const apps = rep?.valuation_approaches || []
  return apps.filter((a) => a && a.id !== 'report_pt' && a.verdict && a.verdict !== '—').slice(0, 6)
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
  const [reports, setReports] = useState<Record<string, SavedReport>>({})

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
    void api<SavedReport[]>('/api/reports')
      .then((list) => {
        const m: Record<string, SavedReport> = {}
        for (const r of Array.isArray(list) ? list : []) {
          const tk = String(r?.ticker || '').toUpperCase()
          if (tk) m[tk] = r
        }
        setReports(m)
      })
      .catch(() => {
        /* valuation chips are optional */
      })
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
          and Google News RSS. No LLM. Ranked by |day %|. Colored chips are
          each valuation approach vs last (DCF, comps, street, scenarios) —
          not a blended score. Click the ticker for a snapshot, the headline
          to open the article, or empty space on the row for more headlines.
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
          const chips = approachChips(reports[tk])
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
                {chips.length > 0 && (
                  <span className={styles.pulseValRow}>
                    {chips.map((a) => {
                      const gap =
                        a.gap == null || !Number.isFinite(Number(a.gap))
                          ? null
                          : Number(a.gap) * 100
                      const nm = (a.name || a.id || '—').replace(/\s+case$/i, '')
                      return (
                        <span
                          key={`${tk}-${a.id || nm}`}
                          className={`${styles.valChip} ${valChipClass(a.tone, a.intensity)}`}
                          title={`${a.name || nm} · ${a.verdict || '—'} · ${
                            a.value != null ? `$${Number(a.value).toFixed(2)}` : '—'
                          } vs last`}
                        >
                          {nm} {fmtPct(gap, 0)}
                        </span>
                      )
                    })}
                  </span>
                )}
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
