import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPx, fmtUsd } from '@/lib/format'
import page from './page.module.css'
import styles from './FinancialsPage.module.css'

type Dash = {
  ok?: boolean
  ticker?: string
  entity_name?: string
  sector?: string
  industry?: string
  price?: { last?: number; pct?: number } | number
  ttm?: Record<string, number | null>
  key_metrics?: Record<string, number | null>
  peers?: { ticker?: string; name?: string; market_cap?: number; pe?: number; is_subject?: boolean }[]
  notes?: string
  earnings_8k_pending_10q?: { filed?: string } | null
}

export function FinancialsPage() {
  const [ticker, setTicker] = useState('AAPL')
  const [input, setInput] = useState('AAPL')
  const [dash, setDash] = useState<Dash | null>(null)
  const [coverageN, setCoverageN] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void api<{ coverage?: unknown[] }>('/api/financials/coverage')
      .then((d) => setCoverageN(Array.isArray(d.coverage) ? d.coverage.length : null))
      .catch(() => null)
  }, [])

  const load = async (tk: string) => {
    const t = tk.trim().toUpperCase()
    if (!t) return
    setLoading(true)
    setErr(null)
    setTicker(t)
    try {
      const d = await api<Dash>(
        `/api/financials/${encodeURIComponent(t)}/dashboard?period_type=annual`,
      )
      setDash(d)
    } catch (e) {
      setDash(null)
      setErr(e instanceof Error ? e.message : 'Dashboard failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('AAPL')
  }, [])

  const price =
    typeof dash?.price === 'number'
      ? dash.price
      : dash?.price && typeof dash.price === 'object'
        ? dash.price.last
        : null
  const ttm = dash?.ttm || {}

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research</p>
          <h1 className={page.h1}>Financials</h1>
          <p className={page.sub}>
            EDGAR-backed dashboards · store coverage{' '}
            {coverageN != null ? <strong>{coverageN.toLocaleString()}</strong> : '—'} tickers.
          </p>
        </div>
        <div className={page.heroActions}>
          <input
            className={styles.search}
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && void load(input)}
            placeholder="Ticker"
          />
          <Button variant="primary" size="sm" onClick={() => void load(input)} disabled={loading}>
            Load
          </Button>
        </div>
      </header>
      {err && <div className={page.bannerErr}>{err}</div>}
      {loading && <Spinner label={`Loading ${ticker}…`} />}
      {!loading && dash && (
        <>
          <div className={styles.headCard}>
            <div>
              <div className={styles.tk}>{dash.ticker || ticker}</div>
              <div className={styles.entity}>{dash.entity_name}</div>
              <div className={styles.sector}>
                {[dash.sector, dash.industry].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className={styles.priceBlock}>
              <div className={`${styles.price} tabular`}>{fmtPx(price)}</div>
              {dash.earnings_8k_pending_10q?.filed && (
                <div className={styles.flag}>
                  Earnings 8-K {String(dash.earnings_8k_pending_10q.filed).slice(0, 10)} · 10-Q pending
                </div>
              )}
            </div>
          </div>
          <div className={styles.metrics}>
            {[
              ['Revenue (TTM)', ttm.revenue, 'usd'],
              ['Net income', ttm.net_income, 'usd'],
              ['Gross margin', ttm.gross_margin ?? ttm.gross_margin_pct, 'pct'],
              ['Op. margin', ttm.operating_margin ?? ttm.op_margin_pct, 'pct'],
            ].map(([label, val, kind]) => (
              <div key={String(label)} className={styles.metric}>
                <div className={styles.metricLbl}>{label}</div>
                <div className={`${styles.metricVal} tabular`}>
                  {kind === 'usd'
                    ? fmtUsd(val as number)
                    : val != null
                      ? `${Number(val).toFixed(1)}%`
                      : '—'}
                </div>
              </div>
            ))}
          </div>
          <Panel title="Peer comps" badge={(dash.peers || []).length}>
            {!(dash.peers || []).length ? (
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
                    {(dash.peers || []).slice(0, 16).map((p) => (
                      <tr
                        key={p.ticker}
                        className={p.is_subject ? styles.subject : undefined}
                        onClick={() => p.ticker && void load(p.ticker)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className={styles.tkSm}>{p.ticker}</td>
                        <td>{p.name || '—'}</td>
                        <td className="tabular">{fmtUsd(p.market_cap)}</td>
                        <td className="tabular">
                          {p.pe != null ? Number(p.pe).toFixed(1) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {dash.notes && (
            <Panel title="Notes">
              <p className={styles.notes}>{dash.notes}</p>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
