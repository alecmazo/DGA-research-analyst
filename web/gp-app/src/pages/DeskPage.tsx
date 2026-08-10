import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { LiveMarkets } from '@/components/desk/LiveMarkets'
import { AnalyzeCard } from '@/components/desk/AnalyzeCard'
import { AnalystCard } from '@/components/desk/AnalystCard'
import { StrategistCard } from '@/components/desk/StrategistCard'
import { IdeaGenerator } from '@/components/desk/IdeaGenerator'
import { SavedReports } from '@/components/desk/SavedReports'
import { DeskBoard } from '@/components/desk/DeskBoard'
import { EarningsCard } from '@/components/desk/EarningsCard'
import {
  api,
  type DailyBrief,
  type Quote,
  type WatchlistEarning,
  type WatchlistResponse,
} from '@/lib/api'
import { fmtPct, fmtPx, pctClass, relativeTime } from '@/lib/format'
import { openReportWindow } from '@/pages/ReportPage'
import styles from './DeskPage.module.css'

function earnChipClass(earn: WatchlistEarning): string {
  const du = earn.days_until
  if (du === 0) return `${styles.earn} ${styles.earnToday}`
  if (du != null && du < 0) return `${styles.earn} ${styles.earnPast}`
  if (du != null && du <= 2) return `${styles.earn} ${styles.earnSoon}`
  return styles.earn
}

function earnLabel(earn: WatchlistEarning): string {
  const du = earn.days_until
  const label =
    earn.label ||
    (du === 0 ? 'TODAY' : du != null ? `${du}d` : 'EARN')
  const sess = earn.session ? ` ${earn.session}` : ''
  return `EARN ${label}${sess}`
}

function earnTitle(tk: string, earn: WatchlistEarning): string {
  const du = earn.days_until
  const when =
    du === 0
      ? 'TODAY'
      : du === -1
        ? 'yesterday'
        : du != null && du > 0
          ? `in ${du}d`
          : ''
  const bits = [
    `Earnings ${when}`,
    earn.date ? `(${earn.date})` : '',
    earn.session || '',
    earn.fiscal_quarter ? `· ${earn.fiscal_quarter}` : '',
    earn.eps_forecast != null ? `· est ${earn.eps_forecast}` : '',
    '· click for results / beat-miss card',
  ]
  return bits.filter(Boolean).join(' ')
}

function quotePct(q?: Quote | null): number | null {
  if (!q) return null
  const v = q.pct ?? q.pct_change
  return v == null || Number.isNaN(Number(v)) ? null : Number(v)
}

export function DeskPage() {
  const [wl, setWl] = useState<WatchlistResponse | null>(null)
  const [brief, setBrief] = useState<DailyBrief | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tickerIn, setTickerIn] = useState('')
  const [busy, setBusy] = useState(false)

  const [analyzeTk, setAnalyzeTk] = useState('')
  const [runToken, setRunToken] = useState(0)
  const [reportsKey, setReportsKey] = useState(0)
  const [earningsTk, setEarningsTk] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [w, b] = await Promise.all([
        api<WatchlistResponse>('/api/watchlist'),
        api<DailyBrief>('/api/daily-brief/latest').catch(() => ({ exists: false })),
      ])
      setWl(w)
      setBrief(b)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load desk')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 45_000)
    return () => window.clearInterval(id)
  }, [load])

  const rows = useMemo(() => {
    const tickers = wl?.tickers || []
    const quotes = wl?.quotes || {}
    const earnings = wl?.earnings || {}
    return [...tickers]
      .map((tk) => {
        const q = quotes[tk] || {}
        const pct = quotePct(q)
        const ytdRaw = q.ytd ?? q.ytd_pct
        const ytd =
          ytdRaw == null || Number.isNaN(Number(ytdRaw))
            ? null
            : Number(ytdRaw)
        const earn = earnings[tk] || null
        return { tk, q, pct, ytd, earn, abs: pct == null ? -1 : Math.abs(pct) }
      })
      .sort((a, b) => b.abs - a.abs)
  }, [wl])

  const addTicker = async () => {
    const tk = tickerIn.trim().toUpperCase()
    if (!tk) return
    setBusy(true)
    try {
      await api('/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({ ticker: tk }),
      })
      setTickerIn('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  const removeTicker = async (tk: string) => {
    setBusy(true)
    try {
      await api(`/api/watchlist/${encodeURIComponent(tk)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  const runPulse = async () => {
    setBusy(true)
    setErr(null)
    try {
      await api('/api/daily-brief', { method: 'POST', body: '{}' })
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const b = await api<DailyBrief>('/api/daily-brief/latest')
        if (b?.markdown && b.generated_at !== brief?.generated_at) {
          setBrief(b)
          break
        }
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Pulse failed')
    } finally {
      setBusy(false)
    }
  }

  const focusAnalyze = (tk: string, autoRun = false) => {
    setAnalyzeTk(tk.toUpperCase())
    if (autoRun) setRunToken((n) => n + 1)
  }

  // Topbar stock peek → “Run AI analysis” dispatches this event.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const d = (e as CustomEvent<{ ticker?: string; autoRun?: boolean }>).detail
      const tk = (d?.ticker || '').trim().toUpperCase()
      if (!tk) return
      focusAnalyze(tk, !!d?.autoRun)
      // Scroll analyze card into view if present
      window.setTimeout(() => {
        document
          .querySelector('[data-desk-widget="analyze"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
    }
    window.addEventListener('dga-focus-analyze', onFocus)
    return () => window.removeEventListener('dga-focus-analyze', onFocus)
  }, [])

  const cards = [
    {
      id: 'watchlist' as const,
      title: 'Watchlist',
      badge: rows.length || '0',
      flush: true,
      action: (
        <span className={styles.meta}>
          {wl?.timing_ms != null
            ? `${wl.timing_ms}ms`
            : loading
              ? '…'
              : 'Live'}
        </span>
      ),
      children: (
        <div className={styles.fillCol}>
          <div className={styles.addRow}>
            <input
              className={styles.addInput}
              placeholder="Add ticker…"
              value={tickerIn}
              onChange={(e) => setTickerIn(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addTicker()
              }}
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => void addTicker()}
              disabled={busy}
            >
              Add
            </Button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="tabular">Last</th>
                  <th className={`tabular ${styles.colDay}`}>Day %</th>
                  <th className={`tabular ${styles.colYtd}`} title="Calendar year-to-date return">
                    YTD
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading && !rows.length && (
                  <tr>
                    <td colSpan={5} className={styles.empty}>
                      Loading quotes…
                    </td>
                  </tr>
                )}
                {!loading && !rows.length && (
                  <tr>
                    <td colSpan={5} className={styles.empty}>
                      No tickers yet — add a name above.
                    </td>
                  </tr>
                )}
                {rows.map(({ tk, q, pct, ytd, earn }) => (
                  <tr
                    key={tk}
                    className={earn ? styles.rowEarn : undefined}
                  >
                    <td>
                      <div className={styles.tkCell}>
                        <button
                          type="button"
                          className={styles.tkBtn}
                          title="Analyze this ticker"
                          onClick={() => focusAnalyze(tk, false)}
                        >
                          <span className={styles.tk}>{tk}</span>
                        </button>
                        {earn && (
                          <button
                            type="button"
                            className={earnChipClass(earn)}
                            title={earnTitle(tk, earn)}
                            onClick={(e) => {
                              e.stopPropagation()
                              setEarningsTk(tk)
                            }}
                          >
                            {earnLabel(earn)}
                          </button>
                        )}
                        {(wl?.reports?.[tk] || earn?.has_report) && (
                          <button
                            type="button"
                            className={styles.rptBtn}
                            title={`Open saved report for ${tk}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              openReportWindow(tk, 'grok')
                            }}
                          >
                            Rpt
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="tabular">{fmtPx(q.price)}</td>
                    <td className={`tabular ${styles.colDay} ${pctClass(pct)}`}>
                      {fmtPct(pct)}
                    </td>
                    <td
                      className={`tabular ${styles.colYtd} ${pctClass(ytd)}`}
                      title={
                        ytd == null
                          ? 'YTD unavailable (no Jan price in store)'
                          : 'Calendar year-to-date %'
                      }
                    >
                      {fmtPct(ytd)}
                    </td>
                    <td className={styles.actions}>
                      <button
                        type="button"
                        className={styles.rm}
                        onClick={() => void removeTicker(tk)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: 'pulse' as const,
      title: 'Daily Pulse',
      badge: brief?.provider || '—',
      action: (
        <span className={styles.meta}>
          {brief?.generated_at ? relativeTime(brief.generated_at) : '—'}
        </span>
      ),
      children: brief?.markdown ? (
        <div className={styles.pulse}>
          <pre className={styles.pulsePre}>{brief.markdown.slice(0, 6000)}</pre>
        </div>
      ) : (
        <div className={styles.emptyBlock}>
          <p>No pulse yet. Run Daily Pulse for a morning read on your book.</p>
        </div>
      ),
    },
    {
      id: 'reports' as const,
      title: 'Saved Reports',
      flush: true,
      children: (
        <SavedReports
          refreshKey={reportsKey}
          onAnalyze={(tk) => focusAnalyze(tk, false)}
          embed
        />
      ),
    },
    {
      id: 'analyst' as const,
      title: 'Analyst',
      badge: 'Agentic',
      action: <span className={styles.meta}>Live quotes · reports · news</span>,
      flush: true,
      children: <AnalystCard bare />,
    },
    {
      id: 'strategist' as const,
      title: 'Portfolio Strategist',
      badge: 'Agentic · EV',
      action: (
        <span className={styles.meta}>whole-book → roundup / memo</span>
      ),
      flush: true,
      children: <StrategistCard bare />,
    },
    {
      id: 'markets' as const,
      title: 'Live Markets',
      badge: 'Real-time',
      flush: true,
      action: <span className={styles.meta}>TradingView</span>,
      children: <LiveMarkets bare />,
    },
    {
      id: 'ideas' as const,
      title: 'Idea Generator',
      flush: true,
      children: <IdeaGenerator onAnalyze={focusAnalyze} bare />,
    },
    {
      id: 'analyze' as const,
      title: 'Analyze Ticker',
      flush: true,
      children: (
        <AnalyzeCard
          ticker={analyzeTk}
          onTickerChange={setAnalyzeTk}
          runToken={runToken}
          onComplete={() => setReportsKey((k) => k + 1)}
          bare
        />
      ),
    },
    {
      id: 'health' as const,
      title: 'Desk health',
      badge: 'OK',
      children: (
        <ul className={styles.health}>
          <li>
            <span>Watchlist</span>
            <strong>{rows.length} names</strong>
          </li>
          <li>
            <span>Quotes</span>
            <strong>
              {rows.filter((r) => r.q.price != null).length}/{rows.length || 0}
            </strong>
          </li>
          <li>
            <span>Saved reports</span>
            <strong>{Object.keys(wl?.reports || {}).length}</strong>
          </li>
          <li>
            <span>Pulse</span>
            <strong>{brief?.markdown ? 'Ready' : 'Idle'}</strong>
          </li>
        </ul>
      ),
    },
  ]

  return (
    <div className={styles.desk} data-desk-board>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <strong className={styles.toolbarTitle}>Desk</strong>
          <span className={styles.toolbarMeta}>
            {rows.length} watch · {Object.keys(wl?.reports || {}).length} reports
          </span>
        </div>
        <div className={styles.toolbarActions}>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={busy}>
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => void runPulse()} disabled={busy}>
            Run Daily Pulse
          </Button>
        </div>
      </div>

      {err && <div className={styles.bannerErr}>{err}</div>}

      <DeskBoard cards={cards} />

      {earningsTk && (
        <EarningsCard
          ticker={earningsTk}
          onClose={() => setEarningsTk(null)}
        />
      )}
    </div>
  )
}
