import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import {
  api,
  type IdeaFeed,
  type IdeaMover,
  type PrioritizePick,
  type PrioritizeResult,
} from '@/lib/api'
import { fmtPct, pctClass } from '@/lib/format'
import styles from './deskWidgets.module.css'

const THRESHOLD = 4.0

type Props = {
  onAnalyze: (ticker: string, autoRun?: boolean) => void
  /** When true, render without outer Panel (Desk board header). */
  bare?: boolean
}

function newsAge(ts?: number): string {
  if (!ts) return ''
  const ageMin = (Date.now() / 1000 - Number(ts)) / 60
  if (ageMin < 60) return `${Math.round(ageMin)}m ago`
  if (ageMin < 1440) return `${Math.round(ageMin / 60)}h ago`
  return `${Math.round(ageMin / 1440)}d ago`
}

export function IdeaGenerator({ onAnalyze, bare = false }: Props) {
  const [feed, setFeed] = useState<IdeaFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [prioBusy, setPrioBusy] = useState(false)
  const [prioHtml, setPrio] = useState<{
    header: string
    picks: PrioritizePick[]
    skipped?: PrioritizeResult['skipped']
  } | null>(null)

  const load = useCallback(async (force = false) => {
    setErr(null)
    if (force) setLoading(true)
    try {
      const url =
        `/api/v2/research/idea-feed?threshold=${encodeURIComponent(THRESHOLD)}` +
        `&limit=40${force ? '&force=true' : ''}&_t=${Date.now()}`
      const ctrl = new AbortController()
      const timer = window.setTimeout(() => ctrl.abort(), 10_000)
      const data = await api<IdeaFeed>(url, { signal: ctrl.signal, cache: 'no-store' })
      window.clearTimeout(timer)
      if (data?.error && !(data.movers || []).length) throw new Error(data.error)
      setFeed(data)
    } catch (e) {
      const msg =
        e instanceof Error && e.name === 'AbortError'
          ? 'Idea feed timed out — tap ↻ to retry.'
          : `Idea feed unavailable${e instanceof Error ? `: ${e.message}` : ''}. Tap ↻.`
      setErr(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    const id = window.setInterval(() => {
      if (document.hidden) return
      void load(false)
    }, 3 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [load])

  const toggleExpand = async (m: IdeaMover) => {
    const tk = m.ticker
    const will = !expanded[tk]
    setExpanded((prev) => ({ ...prev, [tk]: will }))
    if (will && (!m.news || !m.news.length)) {
      try {
        const dn = await api<{ news?: Record<string, IdeaMover['news']> }>(
          `/api/news?tickers=${encodeURIComponent(tk)}&limit=6`,
        )
        const items = dn.news?.[tk] || []
        if (items.length && feed) {
          setFeed({
            ...feed,
            movers: (feed.movers || []).map((x) =>
              x.ticker === tk ? { ...x, news: items } : x,
            ),
          })
        }
      } catch {
        /* ignore */
      }
    }
  }

  const prioritize = async () => {
    setPrioBusy(true)
    setPrio(null)
    try {
      const d = await api<PrioritizeResult>('/api/v2/research/prioritize?top_n=5', {
        method: 'POST',
      })
      if (!d.ok) {
        setPrio({ header: `❌ ${d.error || 'failed'}`, picks: [] })
        return
      }
      if (!d.picks?.length) {
        setPrio({ header: d.note || 'No picks returned.', picks: [] })
        return
      }
      const bc = d.bucket_counts || {}
      const breakdown =
        bc.active != null
          ? ` · 🔥${bc.active} active · ♻️${bc.stale ?? 0} stale · ·${bc.fresh ?? 0} fresh`
          : ''
      const header =
        `🎯 ${(d.provider || '').toUpperCase()} · ${d.model || 'model'} — RECOMMENDS ` +
        `(${d.considered ?? '?'} considered${breakdown} · ${d.picks.length} picks)`
      setPrio({ header, picks: d.picks, skipped: d.skipped })
    } catch (e) {
      setPrio({
        header: `❌ ${e instanceof Error ? e.message : 'failed'}`,
        picks: [],
      })
    } finally {
      setPrioBusy(false)
    }
  }

  const movers = feed?.movers || []
  const asof =
    feed?.session_date && feed?.as_of
      ? `${String(feed.session_date).slice(5)} · ${feed.as_of}`
      : feed?.as_of || '—'

  const body = (
    <>
      <div className={styles.ideaToolbar}>
        <span className={styles.metaDim}>{asof}</span>
        <span className={styles.metaDim}>
          {loading && !movers.length ? '…' : `${movers.length} movers`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void load(true)} title="Refresh">
          ↻
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void prioritize()}
          disabled={prioBusy}
          title="Pre-screen idea feed"
        >
          {prioBusy ? '…' : '🎯 Prioritize'}
        </Button>
      </div>
      {prioHtml && (
        <div className={styles.prioBox}>
          <div className={styles.prioHead}>{prioHtml.header}</div>
          {prioHtml.picks.map((p) => (
            <div key={p.ticker} className={styles.prioRow}>
              <span className={styles.prioTk}>{p.ticker}</span>
              <span
                className={`${styles.prioBadge} ${
                  p.priority === 'high'
                    ? styles.prioHigh
                    : p.priority === 'med'
                      ? styles.prioMed
                      : styles.prioLow
                }`}
              >
                {p.priority || 'med'}
              </span>
              <span className={styles.prioScore}>{p.score ?? '—'}</span>
              <span className={styles.prioReason}>{p.reason || ''}</span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => p.ticker && onAnalyze(p.ticker, true)}
              >
                ▶ Report
              </Button>
            </div>
          ))}
          {prioHtml.skipped && prioHtml.skipped.length > 0 && (
            <div className={styles.prioSkip}>
              <strong>Skipped:</strong>{' '}
              {prioHtml.skipped
                .slice(0, 12)
                .map((s) => `${s.ticker} (${s.reason || ''})`)
                .join(' · ')}
            </div>
          )}
        </div>
      )}

      {feed?.note && <div className={styles.ideaNote}>{feed.note}</div>}
      {err && <div className={styles.ideaEmpty}>{err}</div>}

      <div className={styles.ideaList}>
        {loading && !movers.length && !err && (
          <div className={styles.ideaEmpty}>Loading today&apos;s movers…</div>
        )}
        {!loading && !movers.length && !err && (
          <div className={styles.ideaEmpty}>
            No movers ≥ ±{feed?.threshold ?? THRESHOLD}% right now.
          </div>
        )}
        {movers.map((m) => {
          const open = !!expanded[m.ticker]
          const pct = m.pct_change
          return (
            <div key={m.ticker}>
              <button
                type="button"
                className={styles.ideaRow}
                onClick={() => void toggleExpand(m)}
              >
                <span className={styles.ideaTk}>{m.ticker}</span>
                <span className={`tabular ${pctClass(pct)} ${styles.ideaPct}`}>
                  {fmtPct(pct)}
                </span>
                <span className={styles.ideaReason}>
                  <span className={styles.ideaCls}>
                    {(m.reason_class || 'unknown').replace('_', ' ')}
                  </span>
                  {m.reason_text ||
                    (m.reason_class === 'unknown' ? 'No specific catalyst detected' : '')}
                </span>
                <span className={styles.ideaSrc}>
                  {(m.sources || []).map((s) => (
                    <span key={s} className={styles.srcChip} title={s}>
                      {s === 'watchlist'
                        ? 'WL'
                        : s === 'report'
                          ? 'RPT'
                          : s === 'position'
                            ? 'POS'
                            : s.toUpperCase()}
                    </span>
                  ))}
                </span>
              </button>
              {open && (
                <div className={styles.ideaDetail}>
                  <div className={styles.ideaSnap}>
                    <strong>
                      {m.price != null ? `$${Number(m.price).toFixed(2)}` : '—'}
                    </strong>
                    {' · '}
                    {m.sector && m.sector !== 'Unknown' ? m.sector : '—'}
                    {m.sector_etf
                      ? ` · ${m.sector_etf} ${fmtPct(m.sector_pct_change)}`
                      : ''}
                  </div>
                  {m.news && m.news.length > 0 ? (
                    <ul className={styles.newsList}>
                      {m.news.map((n, i) => (
                        <li key={i}>
                          {n.url ? (
                            <a href={n.url} target="_blank" rel="noopener noreferrer">
                              {n.title}
                            </a>
                          ) : (
                            <span>{n.title}</span>
                          )}
                          <div className={styles.newsMeta}>
                            {n.publisher || ''}
                            {n.pub_ts ? ` · ${newsAge(n.pub_ts)}` : ''}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className={styles.ideaEmpty}>No recent headlines available.</div>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onAnalyze(m.ticker, true)}
                  >
                    ⚡ Run deep-dive
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  if (bare) return <div className={styles.ideaEmbed}>{body}</div>
  return (
    <Panel
      title="Idea Generator"
      badge={loading && !movers.length ? '…' : String(movers.length)}
      flush
    >
      {body}
    </Panel>
  )
}
