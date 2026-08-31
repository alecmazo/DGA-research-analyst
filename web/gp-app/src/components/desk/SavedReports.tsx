import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api, type Quote, type SavedReport } from '@/lib/api'
import { fmtPct, fmtPx, pctClass, relativeTime } from '@/lib/format'
import { openReportWindow } from '@/pages/ReportPage'
import styles from './deskWidgets.module.css'

function tsMs(v?: string | null): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return !Number.isNaN(t) && t > 0 ? t : 0
}

function fmtTgt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return `$${n >= 100 ? n.toFixed(0) : n.toFixed(2)}`
}

/** Live last vs 12m PT; fall back to the stored report-day %. */
function liveUpside(
  pt: number | null | undefined,
  price: number | null,
  fallback?: number | null,
): number | null {
  if (pt != null && Number.isFinite(Number(pt)) && price != null && price > 0) {
    return ((Number(pt) - price) / price) * 100
  }
  if (fallback != null && Number.isFinite(Number(fallback))) return Number(fallback)
  return null
}

function freshnessMs(rep: SavedReport): number {
  return Math.max(
    tsMs(rep.generated_at),
    tsMs(rep.claude_generated_at),
    tsMs(rep.kimi_generated_at),
    tsMs(rep.deepseek_generated_at),
    tsMs(rep.last_attempt_at),
    tsMs(rep.report_date),
  )
}

/** Open the engine that actually just ran, not always Grok. */
function preferredProvider(rep: SavedReport): string {
  const available = new Set(rep.providers || [])
  const cands: Array<[string, number]> = [
    ['claude', tsMs(rep.claude_generated_at)],
    ['kimi', tsMs(rep.kimi_generated_at)],
    ['deepseek', tsMs(rep.deepseek_generated_at)],
    ['grok', tsMs(rep.generated_at)],
  ]
  const ranked = cands
    .filter(([p, t]) => t > 0 && (available.size === 0 || available.has(p)))
    .sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] || (rep.providers || [])[0] || 'grok'
}

type Props = {
  refreshKey?: number
  onAnalyze?: (ticker: string) => void
  /** When true, omit outer Panel (Desk board supplies chrome). */
  embed?: boolean
}

export function SavedReports({ refreshKey = 0, onAnalyze, embed = false }: Props) {
  const [reports, setReports] = useState<SavedReport[]>([])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busyTk, setBusyTk] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<'recent' | 'upside'>('recent')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const openRep = (ticker: string, provider?: string) => {
    openReportWindow(ticker, provider || 'grok')
  }

  const load = useCallback(async () => {
    setErr(null)
    try {
      const list = await api<SavedReport[]>('/api/reports')
      const arr = Array.isArray(list) ? list : []
      setReports(arr)
      const tickers = arr.map((r) => r.ticker).filter(Boolean)
      if (tickers.length) {
        try {
          const q: Record<string, Quote> = {}
          const chunk = 80
          for (let i = 0; i < tickers.length; i += chunk) {
            const part = tickers.slice(i, i + chunk)
            const got = await api<Record<string, Quote>>(
              `/api/quotes?tickers=${encodeURIComponent(part.join(','))}`,
            )
            Object.assign(q, got || {})
          }
          setQuotes(q)
        } catch {
          /* keep seed prices on reports */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load reports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const anyRunning = reports.some(
    (r) =>
      r.last_attempt_status === 'running' ||
      r.last_attempt_status === 'in_progress',
  )
  useEffect(() => {
    const ms = anyRunning ? 4000 : 25000
    const id = window.setInterval(() => void load(), ms)
    return () => window.clearInterval(id)
  }, [load, anyRunning])

  const grokUpsideOf = useCallback(
    (rep: SavedReport): number | null => {
      const q = quotes[rep.ticker] || {}
      const price =
        q.price != null
          ? Number(q.price)
          : rep.current_price != null
            ? Number(rep.current_price)
            : null
      const grokPt =
        rep.grok_price_target != null ? Number(rep.grok_price_target) : null
      return liveUpside(grokPt, price, rep.grok_upside_pct)
    },
    [quotes],
  )

  const sorted = useMemo(
    () =>
      [...reports].sort((a, b) => {
        if (sortKey === 'upside') {
          const au = grokUpsideOf(a)
          const bu = grokUpsideOf(b)
          const aN = au == null || Number.isNaN(au)
          const bN = bu == null || Number.isNaN(bu)
          if (aN && bN) return freshnessMs(b) - freshnessMs(a)
          if (aN) return 1
          if (bN) return -1
          const d = au - bu
          return sortDir === 'desc' ? -d : d
        }
        const d = freshnessMs(b) - freshnessMs(a)
        if (d !== 0) return sortDir === 'desc' ? d : -d
        return String(a.ticker || '').localeCompare(String(b.ticker || ''))
      }),
    [reports, sortKey, sortDir, grokUpsideOf],
  )

  const clickSort = (key: 'recent' | 'upside') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
      return
    }
    setSortKey(key)
    setSortDir('desc')
  }

  const remove = async (tk: string, e: MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Remove saved report for ${tk}?`)) return
    setBusyTk(tk)
    try {
      await api(`/api/reports/${encodeURIComponent(tk)}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusyTk(null)
    }
  }

  const table = (
    <>
      <div className={styles.reportsToolbar}>
        <span className={styles.metaDim}>
          {loading ? '…' : `${sorted.length} reports`} · click opens new window
        </span>
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {err && <div className={styles.bannerErr}>{err}</div>}
      <div className={styles.reportsScroll}>
        <table className={styles.repTable}>
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className={`${styles.thSort} ${sortKey === 'recent' ? styles.thSortOn : ''}`}
                  title="Default: most recently run report first"
                  onClick={() => clickSort('recent')}
                >
                  Ticker
                  {sortKey === 'recent' && (
                    <span className={styles.sortMark}>{sortDir === 'desc' ? '▼' : '▲'}</span>
                  )}
                </button>
              </th>
              <th className={styles.num}>Price</th>
              <th className={styles.num}>
                <button
                  type="button"
                  className={`${styles.thSort} ${styles.thSortRight} ${sortKey === 'upside' ? styles.thSortOn : ''}`}
                  title="Sort by Grok 12m upside vs live last — largest first"
                  onClick={() => clickSort('upside')}
                >
                  TGT / Upside
                  {sortKey === 'upside' && (
                    <span className={styles.sortMark}>{sortDir === 'desc' ? '▼' : '▲'}</span>
                  )}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && !sorted.length && (
              <tr>
                <td colSpan={3} className={styles.emptyCell}>
                  Loading saved reports…
                </td>
              </tr>
            )}
            {!loading && !sorted.length && (
              <tr>
                <td colSpan={3} className={styles.emptyCell}>
                  No saved reports yet — run Analyze on a ticker.
                </td>
              </tr>
            )}
            {sorted.map((rep) => {
              const q = quotes[rep.ticker] || {}
              const price =
                q.price != null
                  ? Number(q.price)
                  : rep.current_price != null
                    ? Number(rep.current_price)
                    : null
              const pct =
                q.pct != null
                  ? Number(q.pct)
                  : q.pct_change != null
                    ? Number(q.pct_change)
                    : rep.pct_change != null
                      ? Number(rep.pct_change)
                      : null
              const grokPt =
                rep.grok_price_target != null ? Number(rep.grok_price_target) : null
              const claudePt =
                rep.claude_price_target != null
                  ? Number(rep.claude_price_target)
                  : null
              const bothEngines = grokPt != null && claudePt != null
              const grokUp = liveUpside(grokPt, price, rep.grok_upside_pct)
              const claudeUp = liveUpside(claudePt, price, rep.claude_upside_pct)
              const target =
                grokPt != null
                  ? grokPt
                  : claudePt != null
                    ? claudePt
                    : rep.price_target != null
                      ? Number(rep.price_target)
                      : null
              const upside = liveUpside(target, price, rep.upside_pct)
              const runMs = freshnessMs(rep)
              const runIso = runMs ? new Date(runMs).toISOString() : rep.last_attempt_at
              const providers = rep.providers || []
              const failed = rep.last_attempt_status === 'failed'
              const running =
                rep.last_attempt_status === 'running' ||
                rep.last_attempt_status === 'in_progress'

              return (
                <tr
                  key={rep.ticker}
                  className={styles.repRow}
                  onClick={() => openRep(rep.ticker, preferredProvider(rep))}
                >
                    <td>
                      <div className={styles.repTkRow}>
                        {running ? (
                          <span title="Analyze in progress">⏳</span>
                        ) : providers.length ? (
                          <>
                            <span title="OK">✅</span>
                            {failed && (
                              <span
                                title={
                                  rep.last_attempt_error ||
                                  'Last refresh failed — prior report still available'
                                }
                              >
                                ⚠
                              </span>
                            )}
                          </>
                        ) : failed ? (
                          <span title={rep.last_attempt_error || 'Failed'}>❌</span>
                        ) : null}
                        <span className={styles.repTk}>{rep.ticker}</span>
                        {Number(rep.version_count || 1) > 1 && (
                          <span
                            className={`${styles.pill} ${styles.pillVer}`}
                            title="Thesis versions archived for this ticker"
                          >
                            v{rep.version_count}
                          </span>
                        )}
                        {rep.delta_from_prior &&
                          (rep.delta_from_prior.rating_changed ||
                            rep.delta_from_prior.pt_changed ||
                            rep.delta_from_prior.has_change) && (
                            <span
                              className={`${styles.pill} ${styles.pillDelta}`}
                              title="Changed vs prior Analyze — open report for thesis continuity"
                            >
                              Δ
                            </span>
                          )}
                        <button
                          type="button"
                          className={styles.repDel}
                          title="Remove report"
                          disabled={busyTk === rep.ticker}
                          onClick={(e) => void remove(rep.ticker, e)}
                        >
                          ×
                        </button>
                      </div>
                      <div className={styles.repPills}>
                        {rep.has_docx !== false && (
                          <span className={`${styles.pill} ${styles.pillDoc}`}>DOC</span>
                        )}
                        {rep.has_pptx && (
                          <span
                            className={`${styles.pill} ${styles.pillPpt}${
                              rep.pptx_stale ? ` ${styles.pillStale}` : ''
                            }`}
                          >
                            PPT
                          </span>
                        )}
                        {providers.includes('grok') && (
                          <button
                            type="button"
                            className={`${styles.pill} ${styles.pillGrok}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              openRep(rep.ticker, 'grok')
                            }}
                          >
                            GROK
                          </button>
                        )}
                        {providers.includes('claude') && (
                          <button
                            type="button"
                            className={`${styles.pill} ${styles.pillClaude}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              openRep(rep.ticker, 'claude')
                            }}
                          >
                            CLAUDE
                          </button>
                        )}
                        {providers.includes('kimi') && (
                          <button
                            type="button"
                            className={`${styles.pill} ${styles.pillKimi}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              openRep(rep.ticker, 'kimi')
                            }}
                          >
                            KIMI
                          </button>
                        )}
                        {providers.includes('deepseek') && (
                          <button
                            type="button"
                            className={`${styles.pill} ${styles.pillDeep}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              openRep(rep.ticker, 'deepseek')
                            }}
                          >
                            DEEPSEEK
                          </button>
                        )}
                        {onAnalyze && (
                          <button
                            type="button"
                            className={styles.pillGhost}
                            title="Re-run analyze"
                            onClick={(e) => {
                              e.stopPropagation()
                              onAnalyze(rep.ticker)
                            }}
                          >
                            ⚡
                          </button>
                        )}
                      </div>
                      <div className={styles.repDate}>{relativeTime(runIso)}</div>
                    </td>
                    <td className={styles.num}>
                      <div className={styles.numPrimary}>{fmtPx(price)}</div>
                      <div className={`tabular ${pctClass(pct)}`}>{fmtPct(pct)}</div>
                    </td>
                    <td className={styles.num}>
                      {bothEngines ? (
                        <div className={styles.tgtStack}>
                          <div className={styles.tgtLine} title="Grok 12m PT vs live last">
                            <div className={styles.tgtPx}>
                              <span className={styles.tgtG}>G</span> {fmtTgt(grokPt)}
                            </div>
                            <div className={`tabular ${styles.tgtUp} ${pctClass(grokUp)}`}>
                              {fmtPct(grokUp)}
                            </div>
                          </div>
                          <div className={styles.tgtLine} title="Claude 12m PT vs live last">
                            <div className={styles.tgtPx}>
                              <span className={styles.tgtC}>C</span> {fmtTgt(claudePt)}
                            </div>
                            <div className={`tabular ${styles.tgtUp} ${pctClass(claudeUp)}`}>
                              {fmtPct(claudeUp)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={styles.numPrimary}>{fmtTgt(target)}</div>
                          <div className={`tabular ${pctClass(upside)}`}>
                            {fmtPct(upside)}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
    </>
  )

  if (embed) return <div className={styles.reportsEmbed}>{table}</div>
  return (
    <Panel
      title="Saved Reports"
      badge={loading ? '…' : String(sorted.length)}
      flush
      className={styles.reportsPanel}
    >
      {table}
    </Panel>
  )
}
