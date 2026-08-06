import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api, type Quote, type SavedReport } from '@/lib/api'
import { fmtPct, fmtPx, pctClass, relativeTime } from '@/lib/format'
import { ReportModal } from './ReportModal'
import styles from './deskWidgets.module.css'

function freshnessMs(rep: SavedReport): number {
  const ms = (v?: string | null) => {
    if (!v) return 0
    const t = new Date(v).getTime()
    return !Number.isNaN(t) && t > 0 ? t : 0
  }
  return Math.max(
    ms(rep.generated_at),
    ms(rep.claude_generated_at),
    ms(rep.kimi_generated_at),
    ms(rep.deepseek_generated_at),
    ms(rep.last_attempt_at),
    ms(rep.report_date),
  )
}

type Props = {
  refreshKey?: number
  onAnalyze?: (ticker: string) => void
}

export function SavedReports({ refreshKey = 0, onAnalyze }: Props) {
  const [reports, setReports] = useState<SavedReport[]>([])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<{ ticker: string; provider: string } | null>(null)
  const [busyTk, setBusyTk] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const list = await api<SavedReport[]>('/api/reports')
      const arr = Array.isArray(list) ? list : []
      setReports(arr)
      const tickers = arr.map((r) => r.ticker).filter(Boolean)
      if (tickers.length) {
        try {
          const q = await api<Record<string, Quote>>(
            `/api/quotes?tickers=${encodeURIComponent(tickers.join(','))}`,
          )
          setQuotes(q || {})
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

  const sorted = useMemo(
    () =>
      [...reports].sort((a, b) => {
        const d = freshnessMs(b) - freshnessMs(a)
        if (d !== 0) return d
        return String(a.ticker || '').localeCompare(String(b.ticker || ''))
      }),
    [reports],
  )

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

  return (
    <>
      <Panel
        title="Saved Reports"
        badge={loading ? '…' : String(sorted.length)}
        action={
          <div className={styles.ideaActions}>
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        }
        flush
        className={styles.reportsPanel}
      >
        {err && <div className={styles.bannerErr}>{err}</div>}
        <div className={styles.reportsScroll}>
          <table className={styles.repTable}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th className={styles.num}>Price</th>
                <th className={styles.num}>TGT / Upside</th>
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
                const target =
                  rep.price_target != null ? Number(rep.price_target) : null
                const upside =
                  target != null && price != null && price > 0
                    ? ((target - price) / price) * 100
                    : rep.upside_pct != null
                      ? Number(rep.upside_pct)
                      : null
                const runMs = freshnessMs(rep)
                const runIso = runMs ? new Date(runMs).toISOString() : rep.last_attempt_at
                const providers = rep.providers || []
                const failed = rep.last_attempt_status === 'failed'

                return (
                  <tr
                    key={rep.ticker}
                    className={styles.repRow}
                    onClick={() =>
                      setOpen({
                        ticker: rep.ticker,
                        provider: providers[0] || 'grok',
                      })
                    }
                  >
                    <td>
                      <div className={styles.repTkRow}>
                        {failed ? (
                          <span title={rep.last_attempt_error || 'Failed'}>❌</span>
                        ) : rep.generated_at || providers.length ? (
                          <span title="OK">✅</span>
                        ) : null}
                        <span className={styles.repTk}>{rep.ticker}</span>
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
                              setOpen({ ticker: rep.ticker, provider: 'grok' })
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
                              setOpen({ ticker: rep.ticker, provider: 'claude' })
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
                              setOpen({ ticker: rep.ticker, provider: 'kimi' })
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
                              setOpen({ ticker: rep.ticker, provider: 'deepseek' })
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
                      {rep.grok_price_target != null &&
                      rep.claude_price_target != null ? (
                        <div className={styles.tgtStack}>
                          <div>
                            <span className={styles.tgtG}>G</span>{' '}
                            {fmtPx(rep.grok_price_target)}
                          </div>
                          <div>
                            <span className={styles.tgtC}>C</span>{' '}
                            {fmtPx(rep.claude_price_target)}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={styles.numPrimary}>
                            {target != null
                              ? `$${target >= 100 ? target.toFixed(0) : target.toFixed(2)}`
                              : '—'}
                          </div>
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
      </Panel>

      {open && (
        <ReportModal
          ticker={open.ticker}
          provider={open.provider}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
