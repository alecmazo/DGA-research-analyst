import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { LiveMarkets } from '@/components/desk/LiveMarkets'
import { AnalyzeCard } from '@/components/desk/AnalyzeCard'
import { IdeaGenerator } from '@/components/desk/IdeaGenerator'
import { SavedReports } from '@/components/desk/SavedReports'
import {
  api,
  type DailyBrief,
  type Quote,
  type WatchlistResponse,
} from '@/lib/api'
import { fmtPct, fmtPx, pctClass, relativeTime } from '@/lib/format'
import styles from './DeskPage.module.css'
import page from './page.module.css'

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

  // Analyze card control (Idea Generator / Saved Reports can prefill + run)
  const [analyzeTk, setAnalyzeTk] = useState('')
  const [runToken, setRunToken] = useState(0)
  const [reportsKey, setReportsKey] = useState(0)
  const analyzeAnchor = useRef<HTMLDivElement>(null)

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
    return [...tickers]
      .map((tk) => {
        const q = quotes[tk] || {}
        const pct = quotePct(q)
        return { tk, q, pct, abs: pct == null ? -1 : Math.abs(pct) }
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
    analyzeAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (autoRun) setRunToken((n) => n + 1)
  }

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Work surface</p>
          <h1 className={page.h1}>Desk</h1>
          <p className={page.sub}>
            Watchlist, saved reports, multi-engine analyze, idea feed, and live
            markets — the morning control surface.
          </p>
        </div>
        <div className={page.heroActions}>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={busy}>
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => void runPulse()} disabled={busy}>
            Run Daily Pulse
          </Button>
        </div>
      </header>

      {err && <div className={page.bannerErr}>{err}</div>}

      <div className={styles.deskGrid}>
        {/* ── Left: Watchlist + Pulse ── */}
        <div className={styles.colLeft}>
          <Panel
            title="Watchlist"
            badge={rows.length || '0'}
            action={
              <span className={styles.meta}>
                {wl?.timing_ms != null
                  ? `${wl.timing_ms}ms`
                  : loading
                    ? 'Loading…'
                    : 'Live'}
              </span>
            }
            flush
            className={styles.watchPanel}
          >
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
                    <th className="tabular">Day %</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {loading && !rows.length && (
                    <tr>
                      <td colSpan={4} className={styles.empty}>
                        Loading quotes…
                      </td>
                    </tr>
                  )}
                  {!loading && !rows.length && (
                    <tr>
                      <td colSpan={4} className={styles.empty}>
                        No tickers yet — add a name above.
                      </td>
                    </tr>
                  )}
                  {rows.map(({ tk, q, pct }) => (
                    <tr key={tk}>
                      <td>
                        <button
                          type="button"
                          className={styles.tkBtn}
                          title="Analyze this ticker"
                          onClick={() => focusAnalyze(tk, false)}
                        >
                          <span className={styles.tk}>{tk}</span>
                        </button>
                        {wl?.reports?.[tk] && <span className={styles.chip}>RPT</span>}
                      </td>
                      <td className="tabular">{fmtPx(q.price)}</td>
                      <td className={`tabular ${pctClass(pct)}`}>{fmtPct(pct)}</td>
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
          </Panel>

          <Panel
            title="Daily Pulse"
            badge={brief?.provider || '—'}
            action={
              <span className={styles.meta}>
                {brief?.generated_at
                  ? relativeTime(brief.generated_at)
                  : 'No pulse yet'}
              </span>
            }
          >
            {brief?.markdown ? (
              <div className={styles.pulse}>
                <pre className={styles.pulsePre}>{brief.markdown.slice(0, 4000)}</pre>
              </div>
            ) : (
              <div className={styles.emptyBlock}>
                <p>No pulse yet. Run Daily Pulse for a morning read on your book.</p>
              </div>
            )}
          </Panel>
        </div>

        {/* ── Center: Saved Reports ── */}
        <div className={styles.colCenter}>
          <SavedReports
            refreshKey={reportsKey}
            onAnalyze={(tk) => focusAnalyze(tk, false)}
          />
        </div>

        {/* ── Right: Live Markets + Idea Gen + Analyze ── */}
        <div className={styles.colRight}>
          <LiveMarkets />
          <IdeaGenerator onAnalyze={focusAnalyze} />
          <div ref={analyzeAnchor}>
            <AnalyzeCard
              ticker={analyzeTk}
              onTickerChange={setAnalyzeTk}
              runToken={runToken}
              onComplete={() => setReportsKey((k) => k + 1)}
            />
          </div>
          <Panel title="Desk health" badge="OK">
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
          </Panel>
        </div>
      </div>
    </div>
  )
}
