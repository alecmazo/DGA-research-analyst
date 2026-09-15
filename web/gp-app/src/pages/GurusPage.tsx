import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { fmtCap, fmtPct } from '@/lib/format'
import { openFinancialsPage } from '@/lib/financialsNav'
import { Button } from '@/components/ui/Button'
import styles from './GurusPage.module.css'

type Guru = {
  id: string
  name?: string
  firm?: string
  cik?: string
  last_13f?: string | null
  equity_k?: number | null
  n?: number | null
  n_new?: number | null
  n_sold?: number | null
  turnover_proxy?: number | null
  top5_pct?: number | null
}

type Holding = {
  symbol?: string | null
  issuer?: string
  title?: string
  cusip?: string
  shares?: number | null
  value_k?: number | null
  weight_pct?: number | null
  action?: string | null
  share_change?: number | null
  impact?: number | null
  put_call?: string | null
}

type Summary = {
  guru?: Guru
  portdate?: string | null
  holdings?: Holding[]
  kpis?: {
    equity_k?: number
    n?: number
    n_new?: number
    n_sold?: number
    n_add?: number
    n_cut?: number
    turnover_proxy?: number
    top5_pct?: number
    top10_pct?: number
    hhi?: number
  }
  book_hist?: { portdate?: string; equity_k?: number; n?: number }[]
  overlap?: {
    symbol?: string
    weight_pct?: number | null
    also?: { id: string; name?: string; weight_pct?: number }[]
  }[]
  caveat?: string
}

type History = {
  dates?: string[]
  series?: { key: string; weights: Array<number | null> }[]
}

function fmtShares(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function actionTone(action?: string | null): 'up' | 'down' | '' {
  const a = action || ''
  if (a === 'New Buy' || a === 'Add') return 'up'
  if (a === 'Reduce' || a === 'Sold Out') return 'down'
  return ''
}

function toneClass(action?: string | null): string {
  const t = actionTone(action)
  return t === 'up' ? styles.up : t === 'down' ? styles.down : ''
}

const FLOW_COLORS = ['#0a1628', '#5bb8d4', '#047857', '#b91c1c', '#d97706', '#7c3aed']

type KpiId = 'equity' | 'names' | 'new' | 'sold' | 'turnover' | 'top5' | 'top10' | 'hhi'

function BookSpark({
  points,
}: {
  points: { portdate?: string; equity_k?: number }[]
}) {
  if (points.length < 2) return null
  const W = 240
  const H = 36
  const vals = points.map((p) => Number(p.equity_k) || 0)
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals, 0)
  const span = max - min || 1
  const d = vals
    .map((v, i) => {
      const x = (i / Math.max(1, vals.length - 1)) * W
      const y = H - 2 - ((v - min) / span) * (H - 4)
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.spark} role="img" aria-label="13F equity history">
      <path d={d} fill="none" stroke="#0a1628" strokeWidth="1.5" />
    </svg>
  )
}

function HistoryChart({
  data,
  actions,
}: {
  data: History | null
  actions?: Record<string, string | null | undefined>
}) {
  const dates = data?.dates || []
  const series = data?.series || []
  if (dates.length < 2 || !series.length) {
    return <div className={styles.muted}>Need at least two 13F quarters for a time-flow chart.</div>
  }
  const W = 640
  const H = 128
  const pad = { l: 28, r: 52, t: 8, b: 18 }
  const innerW = W - pad.l - pad.r
  const innerH = H - pad.t - pad.b
  const max = Math.max(
    8,
    ...series.flatMap((s) => (s.weights || []).map((v) => Number(v) || 0)),
  )
  const x = (i: number) => pad.l + (i / Math.max(1, dates.length - 1)) * innerW
  const y = (v: number) => pad.t + innerH - (v / max) * innerH
  const labels = series
    .map((s, si) => {
      const weights = s.weights || []
      let lastI = -1
      let lastV = 0
      weights.forEach((v, i) => {
        if (v != null && Number.isFinite(Number(v))) {
          lastI = i
          lastV = Number(v)
        }
      })
      if (lastI < 0) return null
      return {
        key: s.key,
        color: FLOW_COLORS[si % FLOW_COLORS.length],
        x: x(lastI),
        y: y(lastV),
        atEnd: lastI === dates.length - 1,
      }
    })
    .filter((v): v is NonNullable<typeof v> => v != null)
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 10) {
      labels[i] = { ...labels[i], y: labels[i - 1].y + 10 }
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const v = max * t
        const yy = y(v)
        return (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={yy} y2={yy} className={styles.grid} />
            <text x={pad.l - 4} y={yy + 3} className={styles.axis} textAnchor="end">
              {v.toFixed(0)}%
            </text>
          </g>
        )
      })}
      {series.map((s, si) => {
        const pts = (s.weights || [])
          .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(Number(v)).toFixed(1)}`))
          .filter(Boolean)
          .join(' ')
        return (
          <polyline
            key={s.key}
            fill="none"
            stroke={FLOW_COLORS[si % FLOW_COLORS.length]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={pts}
          />
        )
      })}
      {labels.map((lb) => {
        const tone = actionTone(actions?.[lb.key])
        const fill =
          tone === 'up' ? '#15915a' : tone === 'down' ? '#c23b3b' : lb.color
        return (
          <text
            key={lb.key}
            x={lb.atEnd ? lb.x + 6 : lb.x + 4}
            y={lb.y + 3}
            className={styles.lineLbl}
            fill={fill}
            textAnchor="start"
          >
            {lb.key}
          </text>
        )
      })}
      {dates.map((d, i) => (
        <text key={d} x={x(i)} y={H - 8} className={styles.axis} textAnchor="middle">
          {d.slice(0, 7)}
        </text>
      ))}
    </svg>
  )
}

function holdingLabel(h: Holding): string {
  return h.symbol || (h.issuer || '—').slice(0, 22)
}

function KpiDetail({
  id,
  holdings,
  trades,
  kpis,
}: {
  id: KpiId
  holdings: Holding[]
  trades: Holding[]
  kpis?: Summary['kpis']
}) {
  const live = holdings.filter((h) => (h.action || '') !== 'Sold Out')
  const byWt = [...live].sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0))
  const byVal = [...live].sort((a, b) => (b.value_k || 0) - (a.value_k || 0))
  const news = live.filter((h) => h.action === 'New Buy')
  const turned = (trades.length ? trades : holdings).filter((h) =>
    ['New Buy', 'Add', 'Reduce', 'Sold Out'].includes(h.action || ''),
  )
  const top5 = byWt.slice(0, 5)
  const hhiRows = byWt.map((h) => {
    const w = (h.weight_pct || 0) / 100
    return { h, w2: w * w }
  })

  if (id === 'equity') {
    return (
      <>
        <p className={styles.detailLead}>
          13F reported long US equity {fmtCap((kpis?.equity_k || 0) * 1000)} across {live.length}{' '}
          names. Top by value:
        </p>
        <HoldingsTable rows={byVal.slice(0, 12)} />
      </>
    )
  }
  if (id === 'names') {
    return (
      <>
        <p className={styles.detailLead}>{live.length} names in the latest 13F (click ticker for Financials).</p>
        <HoldingsTable rows={byWt} />
      </>
    )
  }
  if (id === 'new') {
    return news.length ? (
      <>
        <p className={styles.detailLead}>{news.length} new buy{news.length === 1 ? '' : 's'} vs the prior 13F.</p>
        <HoldingsTable rows={news} />
      </>
    ) : (
      <p className={styles.muted}>No new buys this quarter.</p>
    )
  }
  if (id === 'turnover') {
    return turned.length ? (
      <>
        <p className={styles.detailLead}>
          Turnover proxy {kpis?.turnover_proxy != null ? `${kpis.turnover_proxy}%` : '—'} is half the
          sum of absolute weight impacts from New Buy / Add / Reduce / Sold Out.
        </p>
        <HoldingsTable rows={turned} />
      </>
    ) : (
      <p className={styles.muted}>No QoQ adds, cuts, or exits in the cached 13F.</p>
    )
  }
  if (id === 'sold') {
    const sold = (trades.length ? trades : holdings).filter((h) => h.action === 'Sold Out')
    return sold.length ? (
      <>
        <p className={styles.detailLead}>{sold.length} sold out vs the prior 13F.</p>
        <HoldingsTable rows={sold} />
      </>
    ) : (
      <p className={styles.muted}>No sold-out names this quarter.</p>
    )
  }
  if (id === 'top5') {
    return (
      <>
        <p className={styles.detailLead}>
          Top 5 are {kpis?.top5_pct != null ? `${kpis.top5_pct}%` : '—'} of the book.
        </p>
        <HoldingsTable rows={top5} />
      </>
    )
  }
  if (id === 'top10') {
    return (
      <>
        <p className={styles.detailLead}>
          Top 10 are {kpis?.top10_pct != null ? `${kpis.top10_pct}%` : '—'} of the book.
        </p>
        <HoldingsTable rows={byWt.slice(0, 10)} />
      </>
    )
  }
  return (
    <>
      <p className={styles.detailLead}>
        HHI {kpis?.hhi != null ? kpis.hhi.toFixed(3) : '—'} = sum of squared weights. 0 is many small
        names; 1 is a single name.
        {(kpis?.hhi || 0) >= 0.25
          ? ' This book is concentrated.'
          : (kpis?.hhi || 0) >= 0.15
            ? ' Moderate concentration.'
            : ' Relatively diversified for a 13F.'}
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th className="tabular">Weight</th>
            <th className="tabular">w²</th>
          </tr>
        </thead>
        <tbody>
          {hhiRows.map((r, i) => (
            <tr key={`${holdingLabel(r.h)}-${i}`}>
              <td>{holdingLabel(r.h)}</td>
              <td className="tabular">{(r.h.weight_pct || 0).toFixed(1)}%</td>
              <td className="tabular">{r.w2.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function GurusPage() {
  const [gurus, setGurus] = useState<Guru[]>([])
  const [gid, setGid] = useState('ackman')
  const [tab, setTab] = useState<'summary' | 'activity' | 'portfolio'>('summary')
  const [freq, setFreq] = useState<'q' | 'y'>('q')
  const [kpiOpen, setKpiOpen] = useState<KpiId | null>(null)
  const [sum, setSum] = useState<Summary | null>(null)
  const [activity, setActivity] = useState<{
    trades?: Holding[]
    subsequent_filings?: Array<{
      form?: string
      filed?: string
      url?: string
      accession?: string
    }>
  } | null>(null)
  const [hist, setHist] = useState<History | null>(null)
  const [actFilter, setActFilter] = useState<'all' | 'buys' | 'sells'>('all')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const loadList = useCallback(async () => {
    const d = await api<{ gurus?: Guru[] }>('/api/gurus')
    setGurus(d.gurus || [])
  }, [])

  const loadGuru = useCallback(
    async (id: string) => {
      setLoading(true)
      setErr(null)
      try {
        const [s, a, h] = await Promise.all([
          api<Summary>(`/api/gurus/${encodeURIComponent(id)}`),
          api<{
            trades?: Holding[]
            subsequent_filings?: Array<{
              form?: string
              filed?: string
              url?: string
              accession?: string
            }>
          }>(`/api/gurus/${encodeURIComponent(id)}/activity`).catch(() => null),
          api<History>(
            `/api/gurus/${encodeURIComponent(id)}/history?freq=${freq}`,
          ).catch(() => null),
        ])
        setSum(s)
        setActivity(a)
        setHist(h)
        if (!s.portdate) {
          setErr('No 13F cached yet — click Refresh to pull SEC EDGAR.')
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not load guru')
      } finally {
        setLoading(false)
      }
    },
    [freq],
  )

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    setKpiOpen(null)
    void loadGuru(gid)
  }, [gid, loadGuru])

  const refresh = async () => {
    setBusy(true)
    setErr(null)
    try {
      const d = await api<{ ok?: boolean; error?: string; quarters?: number }>(
        `/api/gurus/${encodeURIComponent(gid)}/refresh`,
        { method: 'POST' },
      )
      if (d.ok === false) throw new Error(d.error || 'Refresh failed')
      await loadGuru(gid)
      await loadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'SEC refresh failed')
    } finally {
      setBusy(false)
    }
  }

  const holdings = sum?.holdings || []
  const k = sum?.kpis

  const trades = (activity?.trades || []).filter((t) => {
    if (actFilter === 'buys') return t.action === 'New Buy' || t.action === 'Add'
    if (actFilter === 'sells') return t.action === 'Reduce' || t.action === 'Sold Out'
    return true
  })

  const g = gurus.find((x) => x.id === gid) || sum?.guru

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <div className={styles.kicker}>13F · SEC EDGAR · not GuruFocus data</div>
          <h1 className={styles.h1}>Gurus</h1>
        </div>
        <div className={styles.tools}>
          <select
            className={styles.pull}
            value={gid}
            onChange={(e) => setGid(e.target.value)}
            aria-label="Select guru"
          >
            {(gurus.length ? gurus : [{ id: 'ackman', name: 'Bill Ackman', firm: '' }]).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {x.firm ? ` — ${x.firm}` : ''}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'SEC…' : 'Refresh 13F'}
          </Button>
        </div>
      </header>

      <p className={styles.sub}>
        {g?.firm || '—'} · CIK {g?.cik || '—'} · last 13F {sum?.portdate || '—'}
      </p>
      <p className={styles.caveat}>
        {sum?.caveat ||
          '13F is long-only US listed names, filed up to 45 days after quarter-end.'}
      </p>

      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.tabs}>
        {(['summary', 'activity', 'portfolio'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? styles.tabOn : styles.tab}
            onClick={() => setTab(t)}
          >
            {t === 'summary' ? 'Summary' : t === 'activity' ? 'Activity' : 'Portfolio'}
          </button>
        ))}
      </div>

      {loading && <div className={styles.muted}>Loading…</div>}

      {!loading && tab === 'summary' && (
        <>
          <div className={styles.kpis}>
            {(
              [
                ['equity', 'Equity', fmtCap((k?.equity_k || 0) * 1000)],
                ['names', 'Names', String(k?.n ?? '—')],
                ['new', 'New', String(k?.n_new ?? '—')],
                ['sold', 'Sold', String(k?.n_sold ?? '—')],
                [
                  'turnover',
                  'Turnover',
                  k?.turnover_proxy != null ? `${k.turnover_proxy}%` : '—',
                ],
                ['top5', 'Top 5', k?.top5_pct != null ? `${k.top5_pct}%` : '—'],
                ['top10', 'Top 10', k?.top10_pct != null ? `${k.top10_pct}%` : '—'],
                ['hhi', 'HHI', k?.hhi != null ? k.hhi.toFixed(3) : '—'],
              ] as [KpiId, string, string][]
            ).map(([id, lab, val]) => (
              <button
                key={id}
                type="button"
                className={`${styles.kpi} ${kpiOpen === id ? styles.kpiOn : ''}`}
                aria-expanded={kpiOpen === id}
                onClick={() => setKpiOpen((cur) => (cur === id ? null : id))}
              >
                <span>{lab}</span>
                <strong className="tabular">{val}</strong>
              </button>
            ))}
          </div>
          {kpiOpen && (
            <div className={styles.kpiDetail}>
              <KpiDetail id={kpiOpen} holdings={holdings} trades={trades} kpis={k} />
            </div>
          )}
          <div className={styles.split}>
            <section className={styles.card}>
              <h2>Top holdings</h2>
              <HoldingsTable rows={holdings.slice(0, 12)} />
            </section>
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2>Weight over time</h2>
                <select
                  className={styles.pullSm}
                  value={freq}
                  onChange={(e) => setFreq(e.target.value as 'q' | 'y')}
                >
                  <option value="q">Q</option>
                  <option value="y">Y</option>
                </select>
              </div>
              <HistoryChart
                data={hist}
                actions={Object.fromEntries(
                  holdings.flatMap((h) => {
                    const a = h.action || ''
                    const out: [string, string][] = []
                    if (h.symbol) out.push([h.symbol, a])
                    if (h.issuer) out.push([h.issuer, a])
                    return out
                  }),
                )}
              />
              {(sum?.book_hist || []).length > 1 && (
                <>
                  <div className={styles.muted} style={{ padding: '6px 0 2px' }}>
                    13F equity {fmtCap(((sum?.book_hist || []).slice(-1)[0]?.equity_k || 0) * 1000)}
                  </div>
                  <BookSpark points={sum?.book_hist || []} />
                </>
              )}
            </section>
          </div>
          <div className={styles.split}>
            <section className={styles.card}>
              <h2>Buys / adds this 13F</h2>
              <HoldingsTable
                rows={holdings.filter((h) => h.action === 'New Buy' || h.action === 'Add')}
              />
            </section>
            <section className={styles.card}>
              <h2>Cuts / sold out</h2>
              <HoldingsTable
                rows={(activity?.trades || []).filter(
                  (h) => h.action === 'Reduce' || h.action === 'Sold Out',
                )}
              />
            </section>
          </div>
          {(sum?.overlap || []).length > 0 && (
            <section className={styles.card}>
              <h2>Also held on this roster</h2>
              {(sum?.overlap || []).map((row) => (
                <div key={row.symbol} className={styles.also}>
                  <button
                    type="button"
                    className={`${styles.tk} ${styles.alsoTk}`}
                    onClick={() => row.symbol && openFinancialsPage(row.symbol)}
                  >
                    {row.symbol}
                  </button>
                  <span className={styles.muted} style={{ padding: 0 }}>
                    {row.weight_pct != null ? `${Number(row.weight_pct).toFixed(1)}%` : ''}
                  </span>
                  {(row.also || []).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={styles.alsoChip}
                      onClick={() => setGid(a.id)}
                    >
                      {a.name} {a.weight_pct != null ? `${a.weight_pct}%` : ''}
                    </button>
                  ))}
                </div>
              ))}
            </section>
          )}
          <section className={styles.card}>
            <h2>Roster snapshot</h2>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Guru</th>
                    <th>As of</th>
                    <th className="tabular">Equity</th>
                    <th className="tabular">N</th>
                    <th className="tabular">New</th>
                    <th className="tabular">Turn</th>
                    <th className="tabular">Top 5</th>
                  </tr>
                </thead>
                <tbody>
                  {gurus.map((row) => (
                    <tr key={row.id} className={row.id === gid ? styles.rowOn : undefined}>
                      <td>
                        <button
                          type="button"
                          className={styles.rosterBtn}
                          onClick={() => setGid(row.id)}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td>{row.last_13f || '—'}</td>
                      <td className="tabular">
                        {row.equity_k != null ? fmtCap(row.equity_k * 1000) : '—'}
                      </td>
                      <td className="tabular">{row.n ?? '—'}</td>
                      <td className="tabular">{row.n_new ?? '—'}</td>
                      <td className="tabular">
                        {row.turnover_proxy != null ? `${row.turnover_proxy}%` : '—'}
                      </td>
                      <td className="tabular">
                        {row.top5_pct != null ? `${row.top5_pct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!loading && tab === 'activity' && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>QoQ vs prior 13F</h2>
            <div className={styles.filters}>
              {(['all', 'buys', 'sells'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={actFilter === f ? styles.chipOn : styles.chip}
                  onClick={() => setActFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <HoldingsTable rows={trades} />
          {(activity?.subsequent_filings || []).length > 0 && (
            <>
              <h2 className={styles.h2}>After the 13F (Form 4 / 13D / 13G)</h2>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Filed</th>
                    <th>Form</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {(activity?.subsequent_filings || []).map((f, i) => (
                    <tr key={`${f.accession || i}`}>
                      <td>{f.filed || '—'}</td>
                      <td>{f.form}</td>
                      <td>
                        {f.url ? (
                          <a href={f.url} target="_blank" rel="noopener noreferrer">
                            EDGAR
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {!loading && tab === 'portfolio' && (
        <section className={styles.card}>
          <h2>Current 13F book</h2>
          <HoldingsTable rows={holdings} tall />
        </section>
      )}
    </div>
  )
}

function HoldingsTable({ rows, tall }: { rows: Holding[]; tall?: boolean }) {
  return (
    <div className={tall ? styles.scrollTall : styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Issuer</th>
            <th className="tabular">Shares</th>
            <th className="tabular">Value</th>
            <th className="tabular">Wt</th>
            <th>Action</th>
            <th className="tabular">Δ sh</th>
            <th className="tabular">Impact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => {
            const tk = h.symbol
            const tone = toneClass(h.action)
            return (
              <tr key={`${tk || h.cusip || h.issuer}-${i}`} className={tone}>
                <td>
                  {tk ? (
                    <button
                      type="button"
                      className={`${styles.tk} ${tone}`}
                      onClick={() => openFinancialsPage(tk)}
                    >
                      {tk}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={tone}>{h.issuer || '—'}</td>
                <td className="tabular">{fmtShares(h.shares)}</td>
                <td className="tabular">{fmtCap((h.value_k || 0) * 1000)}</td>
                <td className="tabular">
                  {h.weight_pct != null ? `${Number(h.weight_pct).toFixed(1)}%` : '—'}
                </td>
                <td className={tone}>{h.action || '—'}</td>
                <td className="tabular">{fmtShares(h.share_change)}</td>
                <td className="tabular">{fmtPct(h.impact)}</td>
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={8} className={styles.muted}>
                No holdings. Refresh to pull the latest 13F from SEC.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
