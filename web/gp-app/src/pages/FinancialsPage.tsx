import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPx, fmtUsd } from '@/lib/format'
import page from './page.module.css'
import styles from './FinancialsPage.module.css'

type Dash = {
  ok?: boolean
  error?: string
  ticker?: string
  entity_name?: string
  sector?: string
  industry?: string
  price?: { last?: number; pct?: number } | number | null
  ttm?: Record<string, number | null | undefined>
  key_metrics?: Record<string, number | null | undefined>
  peers?: {
    ticker?: string
    name?: string
    market_cap?: number
    pe?: number
    is_subject?: boolean
  }[]
  notes?: string | string[] | null
  earnings_8k_pending_10q?: { filed?: string } | null
  dga_value?: number | null
  rating?: string | null
}

function notesText(notes: Dash['notes']): string {
  if (notes == null) return ''
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) return notes.map(String).join('\n')
  return String(notes)
}

export function FinancialsPage() {
  const [ticker, setTicker] = useState('')
  const [input, setInput] = useState('')
  const [period, setPeriod] = useState<'annual' | 'quarter'>('annual')
  const [dash, setDash] = useState<Dash | null>(null)
  const [coverageN, setCoverageN] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void api<{ coverage?: unknown[]; count?: number; n?: number }>(
      '/api/financials/coverage',
    )
      .then((d) => {
        if (Array.isArray(d.coverage)) setCoverageN(d.coverage.length)
        else if (typeof d.count === 'number') setCoverageN(d.count)
        else if (typeof d.n === 'number') setCoverageN(d.n)
      })
      .catch(() => null)
  }, [])

  const load = useCallback(async (tk: string, pt: 'annual' | 'quarter' = period) => {
    const t = tk.trim().toUpperCase()
    if (!t) return
    setLoading(true)
    setErr(null)
    setTicker(t)
    setInput(t)
    try {
      const d = await api<Dash>(
        `/api/financials/${encodeURIComponent(t)}/dashboard?period_type=${encodeURIComponent(pt)}`,
      )
      if (d && d.ok === false) {
        setDash(null)
        setErr(d.error || `No financials stored for ${t}`)
        return
      }
      setDash(d)
    } catch (e) {
      setDash(null)
      setErr(e instanceof Error ? e.message : 'Dashboard failed')
    } finally {
      setLoading(false)
    }
  }, [period])

  // Don't hard-crash on default AAPL — only load when user asks, or soft-load AAPL
  useEffect(() => {
    void load('AAPL', 'annual')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial soft load only
  }, [])

  const price =
    typeof dash?.price === 'number'
      ? dash.price
      : dash?.price && typeof dash.price === 'object'
        ? dash.price.last
        : null

  const ttm = dash?.ttm || {}
  const notes = notesText(dash?.notes)

  const metricRows: [string, number | null | undefined, 'usd' | 'pct' | 'raw'][] = [
    ['Revenue (TTM)', ttm.revenue as number | null | undefined, 'usd'],
    ['Net income', ttm.net_income as number | null | undefined, 'usd'],
    [
      'Gross margin',
      (ttm.gross_margin ?? ttm.gross_margin_pct) as number | null | undefined,
      'pct',
    ],
    [
      'Op. margin',
      (ttm.operating_margin ?? ttm.op_margin_pct) as number | null | undefined,
      'pct',
    ],
  ]

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research</p>
          <h1 className={page.h1}>Financials</h1>
          <p className={page.sub}>
            EDGAR-backed company dashboard · store coverage{' '}
            {coverageN != null ? (
              <strong>{coverageN.toLocaleString()}</strong>
            ) : (
              '—'
            )}{' '}
            tickers · free · no LLM.
          </p>
        </div>
        <div className={page.heroActions}>
          <input
            className={styles.search}
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && void load(input, period)}
            placeholder="Ticker"
          />
          <div className={styles.seg}>
            <button
              type="button"
              className={period === 'annual' ? styles.segOn : styles.segBtn}
              onClick={() => {
                setPeriod('annual')
                if (ticker) void load(ticker, 'annual')
              }}
            >
              Annual
            </button>
            <button
              type="button"
              className={period === 'quarter' ? styles.segOn : styles.segBtn}
              onClick={() => {
                setPeriod('quarter')
                if (ticker) void load(ticker, 'quarter')
              }}
            >
              Quarterly
            </button>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void load(input, period)}
            disabled={loading || !input.trim()}
          >
            View ▶
          </Button>
        </div>
      </header>

      {err && <div className={page.bannerErr}>{err}</div>}
      {loading && <Spinner label={`Loading ${ticker || input}…`} />}

      {!loading && !dash && !err && (
        <Empty
          title="Enter a ticker"
          sub="Type a name (e.g. MSFT) and hit View — peer comps, margins, and store-backed fundamentals."
        />
      )}

      {!loading && dash && (
        <>
          <div className={styles.headCard}>
            <div>
              <div className={styles.tk}>{dash.ticker || ticker}</div>
              <div className={styles.entity}>{dash.entity_name || '—'}</div>
              <div className={styles.sector}>
                {[dash.sector, dash.industry, dash.rating]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </div>
            </div>
            <div className={styles.priceBlock}>
              <div className={`${styles.price} tabular`}>{fmtPx(price)}</div>
              {dash.dga_value != null && (
                <div className={styles.flag}>
                  DGA Value {fmtPx(dash.dga_value)}
                </div>
              )}
              {dash.earnings_8k_pending_10q?.filed && (
                <div className={styles.flag}>
                  Earnings 8-K{' '}
                  {String(dash.earnings_8k_pending_10q.filed).slice(0, 10)} · 10-Q
                  pending
                </div>
              )}
            </div>
          </div>

          <div className={styles.metrics}>
            {metricRows.map(([label, val, kind]) => (
              <div key={label} className={styles.metric}>
                <div className={styles.metricLbl}>{label}</div>
                <div className={`${styles.metricVal} tabular`}>
                  {kind === 'usd'
                    ? fmtUsd(val as number | null | undefined)
                    : kind === 'pct' && val != null && !Number.isNaN(Number(val))
                      ? `${Number(val) <= 2 && Number(val) >= -2 ? (Number(val) * 100).toFixed(1) : Number(val).toFixed(1)}%`
                      : val != null && !Number.isNaN(Number(val))
                        ? String(val)
                        : '—'}
                </div>
              </div>
            ))}
          </div>

          <Panel
            title="Peer comps"
            badge={Array.isArray(dash.peers) ? dash.peers.length : 0}
          >
            {!Array.isArray(dash.peers) || !dash.peers.length ? (
              <Empty title="No peers" sub="Peer set empty for this name." />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Name</th>
                      <th className="tabular">Mkt cap</th>
                      <th className="tabular">P/E</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.peers.slice(0, 24).map((p, i) => (
                      <tr
                        key={p.ticker || i}
                        className={p.is_subject ? styles.subject : undefined}
                        onClick={() => p.ticker && void load(p.ticker, period)}
                        style={{ cursor: p.ticker ? 'pointer' : undefined }}
                      >
                        <td className={styles.tkSm}>{p.ticker || '—'}</td>
                        <td>{p.name || '—'}</td>
                        <td className="tabular">{fmtUsd(p.market_cap)}</td>
                        <td className="tabular">
                          {p.pe != null && !Number.isNaN(Number(p.pe))
                            ? Number(p.pe).toFixed(1)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {notes ? (
            <Panel title="Notes">
              <p className={styles.notes}>{notes}</p>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  )
}
