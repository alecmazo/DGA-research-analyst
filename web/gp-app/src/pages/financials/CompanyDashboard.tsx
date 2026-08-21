import { useCallback, useEffect, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPx } from '@/lib/format'
import type { CoverageRow, Dashboard, PeriodType } from './types'
import { LS_LAST_TICKER } from './types'
import {
  gfCap,
  gfMoney,
  gradeColor,
  notesText,
  peerList,
  peerMeta,
  sgnColor,
  verdictColor,
} from './format'
import { RankCardsView } from './RankCards'
import { SeriesPanel } from './SeriesTable'
import { FundCharts } from './FundCharts'
import { PriceChart } from './PriceChart'
import styles from '../FinancialsPage.module.css'

type Props = {
  ticker: string
  setTicker: (t: string) => void
  period: PeriodType
  setPeriod: (p: PeriodType) => void
  coverage: CoverageRow[]
  onViewed: (tk: string) => void
  reloadKey?: number
}

export function CompanyDashboard({
  ticker,
  setTicker,
  period,
  setPeriod,
  coverage,
  onViewed,
  reloadKey = 0,
}: Props) {
  const [input, setInput] = useState(ticker)
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)

  const load = useCallback(
    async (tk: string, pt: PeriodType = period) => {
      const t = tk.trim().toUpperCase()
      if (!t) return
      setLoading(true)
      setErr(null)
      setRefreshMsg(null)
      setTicker(t)
      setInput(t)
      onViewed(t)
      try {
        const d = await api<Dashboard>(
          `/api/financials/${encodeURIComponent(t)}/dashboard?period_type=${encodeURIComponent(pt)}`,
        )
        if (d && d.ok === false) {
          setDash(null)
          setErr(d.error || `No financials stored for ${t}`)
          return
        }
        setDash(d)
        try {
          localStorage.setItem(LS_LAST_TICKER, t)
        } catch {
          /* ignore */
        }
      } catch (e) {
        setDash(null)
        setErr(e instanceof Error ? e.message : 'Dashboard failed')
      } finally {
        setLoading(false)
      }
    },
    [period, setTicker, onViewed],
  )

  // Initial restore from localStorage or soft AAPL (once)
  useEffect(() => {
    let last: string | null = null
    try {
      last = localStorage.getItem(LS_LAST_TICKER)
    } catch {
      /* ignore */
    }
    const t = (ticker || last || 'AAPL').toUpperCase()
    setInput(t)
    void load(t, period)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  // External ticker changes (chip click, screen, nightly) — skip initial empty
  useEffect(() => {
    if (!ticker) return
    if (reloadKey === 0) return
    setInput(ticker)
    void load(ticker, period)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- driven by ticker + reloadKey
  }, [ticker, reloadKey])

  const refreshSec = async () => {
    const tk = (dash?.ticker || ticker || input).trim().toUpperCase()
    if (!tk) return
    setRefreshMsg('↻ Refreshing…')
    try {
      await api(`/api/financials/${encodeURIComponent(tk)}/refresh`, {
        method: 'POST',
      })
      setRefreshMsg('✓ Queued — reloading in 25s…')
      setTimeout(() => {
        void load(tk, period)
      }, 25000)
    } catch (e) {
      setRefreshMsg(
        `↻ Refresh failed: ${e instanceof Error ? e.message : 'error'}`,
      )
    }
  }

  const price =
    typeof dash?.price === 'number'
      ? dash.price
      : dash?.price &&
          typeof dash.price === 'object' &&
          typeof (dash.price as { last?: number }).last === 'number'
        ? (dash.price as { last: number }).last
        : null

  const km = dash?.key_metrics || {}
  const sc = dash?.dga_score || {}
  const comps = sc.components || {}
  const tg = dash?.targets || {}
  const ttm = dash?.ttm || {}
  const peers = peerList(dash?.peers)
  const pMeta = peerMeta(dash?.peers)
  const anchors = dash?.valuation || []
  const maxAbs = Math.max(
    price || 0,
    ...anchors.map((a) => Math.abs(a.value || 0)),
    1,
  )
  const aColor = (k?: string) =>
    k === 'dga' ? '#eab308' : k === 'target' ? '#3b82f6' : '#64748b'

  const action = (
    <div className={styles.dashActions}>
      <input
        className={styles.search}
        list="fin-dash-list"
        value={input}
        onChange={(e) => setInput(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && void load(input, period)}
        placeholder="Ticker…"
        maxLength={8}
      />
      <datalist id="fin-dash-list">
        {coverage.map((c) => (
          <option key={c.ticker} value={c.ticker || ''}>
            {c.entity_name || ''}
          </option>
        ))}
      </datalist>
      <div className={styles.seg}>
        <button
          type="button"
          className={period === 'annual' ? styles.segOn : styles.segBtn}
          onClick={() => {
            setPeriod('annual')
            if (ticker || input) void load(ticker || input, 'annual')
          }}
        >
          Annual
        </button>
        <button
          type="button"
          className={period === 'quarter' ? styles.segOn : styles.segBtn}
          onClick={() => {
            setPeriod('quarter')
            if (ticker || input) void load(ticker || input, 'quarter')
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
  )

  return (
    <CollapsibleCard
      id="fin-dash-panel"
      title="📊 Company Dashboard"
      action={action}
      defaultOpen
    >
      {err && <div className={styles.inlineErr}>{err}</div>}
      {loading && <Spinner label={`Loading ${ticker || input}…`} />}

      {!loading && !dash && !err && (
        <Empty
          title="Enter a ticker"
          sub="Type a name (e.g. MSFT) and hit View — peer comps, rank cards, DGA Score & Value from the SEC store."
        />
      )}

      {!loading && dash && (
        <>
          <div className={styles.headGrid}>
            {/* Identity + key metrics */}
            <div className={styles.card}>
              <div className={styles.entityLine}>
                <strong>{dash.entity_name || dash.ticker}</strong>
                <span className={styles.muted}>
                  {' '}
                  · {dash.ticker || ticker}
                </span>
              </div>
              {(dash.sector || dash.industry) && (
                <div className={styles.sectorLine}>
                  {[dash.sector, dash.industry].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className={styles.priceBig}>
                {price != null ? fmtPx(price) : '—'}
                {dash.rating && (
                  <span className={styles.ratingPill}>
                    {String(dash.rating).toUpperCase()}
                  </span>
                )}
              </div>
              <div className={styles.kmGrid}>
                <Km
                  lbl={`P/E${km.pe_basis ? ` (${km.pe_basis})` : ''}`}
                  val={km.pe != null ? Number(km.pe).toFixed(2) : '—'}
                />
                <Km lbl="Market Cap" val={gfCap(km.market_cap)} />
                <Km
                  lbl="EV / EBITDA"
                  val={
                    km.ev_ebitda != null
                      ? `${Number(km.ev_ebitda).toFixed(2)}×`
                      : '—'
                  }
                />
                <Km lbl="Enterprise V" val={gfCap(km.enterprise_value)} />
                <Km
                  lbl="P/B"
                  val={km.pb != null ? Number(km.pb).toFixed(2) : '—'}
                />
                <Km
                  lbl="FCF Yield"
                  val={
                    km.fcf_yield_pct != null
                      ? `${Number(km.fcf_yield_pct).toFixed(1)}%`
                      : '—'
                  }
                />
                <Km
                  lbl="Rev YoY"
                  val={
                    km.rev_yoy_pct != null
                      ? `${km.rev_yoy_pct >= 0 ? '+' : ''}${Number(km.rev_yoy_pct).toFixed(1)}%`
                      : '—'
                  }
                  col={sgnColor(km.rev_yoy_pct)}
                />
                <Km
                  lbl="ROIC"
                  val={
                    km.roic_pct != null
                      ? `${Number(km.roic_pct).toFixed(1)}%`
                      : '—'
                  }
                />
              </div>
              <div className={styles.targetsLine}>
                Targets — Grok: {tg.grok != null ? `$${tg.grok}` : '—'} · Claude:{' '}
                {tg.claude != null ? `$${tg.claude}` : '—'}
                {tg.as_of && (
                  <>
                    <br />
                    as of {String(tg.as_of).slice(0, 10)}
                  </>
                )}
              </div>
              <div className={styles.secMeta}>
                SEC 10-K/10-Q XBRL store · {dash.period_type || period} · zero
                LLM tokens
                {dash.latest_period?.period_end && (
                  <>
                    <br />
                    Latest period in store:{' '}
                    <strong>
                      {dash.latest_period.fp
                        ? `${dash.latest_period.fp} · `
                        : ''}
                      {String(dash.latest_period.period_end).slice(0, 10)}
                    </strong>
                  </>
                )}{' '}
                ·{' '}
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => void refreshSec()}
                >
                  {refreshMsg || '↻ Refresh from SEC'}
                </button>
              </div>
              {dash.earnings_8k_pending_10q?.filed && (
                <div className={styles.pendingBanner}>
                  <strong>Earnings 8-K</strong> filed{' '}
                  {String(dash.earnings_8k_pending_10q.filed).slice(0, 10)}{' '}
                  (Item 2.02). Full 10-Q XBRL is not in the store yet — numbers
                  stay at the last 10-Q until EDGAR posts the filing.
                </div>
              )}
            </div>

            {/* DGA Score */}
            <div className={styles.card}>
              <div className={styles.scoreKicker}>DGA SCORE™</div>
              <div
                className={styles.scoreBig}
                style={{ color: gradeColor(sc.total) }}
              >
                {sc.total == null ? '—' : sc.total}
                <span className={styles.scoreOf}> /100</span>
              </div>
              {(
                [
                  ['Profitability', comps.profitability],
                  ['Growth', comps.growth],
                  ['Fin. Strength', comps.financial_strength],
                  ['Predictability', comps.predictability],
                  ['Value', comps.value],
                ] as const
              ).map(([name, v]) => (
                <div key={name} className={styles.compRow}>
                  <span className={styles.compName}>{name}</span>
                  <div className={styles.compTrack}>
                    <div
                      className={styles.compFill}
                      style={{
                        width: `${v == null ? 0 : v}%`,
                        background: gradeColor(v),
                      }}
                    />
                  </div>
                  <span
                    className={styles.compVal}
                    style={{ color: gradeColor(v) }}
                  >
                    {v == null ? '—' : v}
                  </span>
                </div>
              ))}
              <div className={styles.mutedSm}>
                30% profit · 25% growth · 20% strength · 15% pred · 10% value
              </div>
            </div>

            {/* DGA Value + anchors */}
            <div className={styles.card}>
              <div className={styles.valueHead}>
                <span className={styles.scoreKicker}>DGA VALUE™</span>
                <span className={styles.valuePx}>
                  {dash.dga_value != null
                    ? `$${Number(dash.dga_value).toLocaleString('en-US', {
                        maximumFractionDigits: 2,
                      })}`
                    : '—'}
                </span>
                {dash.verdict && (
                  <span
                    className={styles.verdictPill}
                    style={{ color: verdictColor(dash.verdict) }}
                  >
                    {dash.verdict}
                  </span>
                )}
              </div>
              <div className={styles.anchors}>
                {anchors.length ? (
                  anchors.map((a, i) => {
                    const w = Math.min(
                      100,
                      (Math.abs(a.value || 0) / maxAbs) * 100,
                    )
                    return (
                      <div key={i} className={styles.anchorRow}>
                        <span className={styles.anchorLbl} title={a.label}>
                          {a.label}
                        </span>
                        <div className={styles.anchorTrack}>
                          <div
                            className={styles.anchorFill}
                            style={{
                              width: `${w}%`,
                              background:
                                (a.value || 0) < 0
                                  ? '#dc2626'
                                  : aColor(a.kind),
                            }}
                          />
                          {price != null && (
                            <div
                              className={styles.anchorPx}
                              style={{
                                left: `${Math.min(100, (price / maxAbs) * 100)}%`,
                              }}
                            />
                          )}
                        </div>
                        <span className={`${styles.anchorVal} tabular`}>
                          $
                          {Number(a.value).toLocaleString('en-US', {
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )
                  })
                ) : (
                  <span className={styles.mutedSm}>
                    No valuation anchors (need a saved report + financials).
                  </span>
                )}
              </div>
              {price != null && (
                <div className={styles.mutedSm}>
                  ┆ dashed line = current price ({fmtPx(price)})
                </div>
              )}
            </div>
          </div>

          {/* TTM */}
          {ttm.periods != null && (
            <div className={styles.ttmStrip}>
              <div className={styles.ttmHead}>
                TTM SNAPSHOT · last {ttm.periods} quarters
                {ttm.period_end
                  ? ` through ${String(ttm.period_end).slice(0, 10)}`
                  : ''}
              </div>
              <div className={styles.ttmGrid}>
                <Ttm
                  lbl="Revenue"
                  val={
                    ttm.revenue != null ? `$${gfMoney(ttm.revenue)}` : '—'
                  }
                />
                <Ttm
                  lbl="Net Income"
                  val={
                    ttm.net_income != null
                      ? `$${gfMoney(ttm.net_income)}`
                      : '—'
                  }
                />
                <Ttm
                  lbl="FCF"
                  val={
                    ttm.free_cash_flow != null
                      ? `$${gfMoney(ttm.free_cash_flow)}`
                      : '—'
                  }
                />
                <Ttm
                  lbl="EPS"
                  val={
                    ttm.eps != null ? `$${Number(ttm.eps).toFixed(2)}` : '—'
                  }
                />
                <Ttm
                  lbl="Net Margin"
                  val={
                    ttm.net_margin != null
                      ? `${(Number(ttm.net_margin) * 100).toFixed(1)}%`
                      : '—'
                  }
                />
                <Ttm
                  lbl="FCF Margin"
                  val={
                    ttm.fcf_margin != null
                      ? `${(Number(ttm.fcf_margin) * 100).toFixed(1)}%`
                      : '—'
                  }
                />
              </div>
            </div>
          )}

          {/* Pre-React multi-card fundamentals charts */}
          {Array.isArray(dash.series) && dash.series.length > 0 && (
            <FundCharts series={dash.series} />
          )}

          {/* Compact series table under charts */}
          {Array.isArray(dash.series) && dash.series.length > 0 && (
            <SeriesPanel series={dash.series} />
          )}

          {/* Price history */}
          {(dash.ticker || ticker) && (
            <PriceChart ticker={dash.ticker || ticker} />
          )}

          {/* Peers */}
          {peers.length > 0 && (
            <div className={styles.card}>
              <div className={styles.peersHead}>
                <span className={styles.peersTitle}>Comparable companies</span>
                <span className={styles.mutedSm}>
                  {[pMeta.industry || pMeta.group_id, pMeta.sector]
                    .filter(Boolean)
                    .join(' · ') || 'covered names'}
                </span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th className="tabular">Price</th>
                      <th className="tabular">Mkt Cap</th>
                      <th className="tabular">P/E</th>
                      <th className="tabular">EV/EBITDA</th>
                      <th className="tabular">Net Mgn</th>
                      <th className="tabular">Rev YoY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peers.map((p, i) => (
                      <tr
                        key={p.ticker || i}
                        className={p.is_subject ? styles.subject : undefined}
                        onClick={() =>
                          p.ticker &&
                          !p.is_subject &&
                          void load(p.ticker, period)
                        }
                        style={{
                          cursor:
                            p.ticker && !p.is_subject ? 'pointer' : undefined,
                        }}
                      >
                        <td>
                          <span className={styles.tkSm}>{p.ticker || '—'}</span>
                          {p.name && p.name !== p.ticker && (
                            <span className={styles.peerName}>
                              {String(p.name).slice(0, 36)}
                            </span>
                          )}
                        </td>
                        <td className="tabular">
                          {p.price != null ? fmtPx(p.price) : '—'}
                        </td>
                        <td className="tabular">{gfCap(p.market_cap)}</td>
                        <td
                          className="tabular"
                          style={
                            p.pe_nm
                              ? { color: 'var(--text-tertiary)' }
                              : undefined
                          }
                        >
                          {p.pe != null
                            ? `${Number(p.pe).toFixed(1)}×`
                            : p.pe_nm
                              ? 'n/m'
                              : '—'}
                        </td>
                        <td className="tabular">
                          {p.ev_ebitda != null
                            ? `${Number(p.ev_ebitda).toFixed(1)}×`
                            : '—'}
                        </td>
                        <td className="tabular">
                          {p.net_margin_pct != null
                            ? `${Number(p.net_margin_pct).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td
                          className="tabular"
                          style={{ color: sgnColor(p.rev_yoy_pct) }}
                        >
                          {p.rev_yoy_pct != null
                            ? `${p.rev_yoy_pct >= 0 ? '+' : ''}${Number(p.rev_yoy_pct).toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.mutedSm}>
                {pMeta.note ||
                  'Sell-side style: same industry / business model + similar market-cap band.'}{' '}
                Click a ticker to load its dashboard.
              </div>
            </div>
          )}

          {/* Rank cards */}
          <RankCardsView
            rc={dash.rank_cards}
            metricHistory={dash.metric_history}
          />

          {/* Notes */}
          {notesText(dash.notes) && (
            <div className={styles.notesBlock}>
              <strong>Methodology</strong> · {notesText(dash.notes)}
            </div>
          )}
        </>
      )}
    </CollapsibleCard>
  )
}

function Km({
  lbl,
  val,
  col,
}: {
  lbl: string
  val: string
  col?: string
}) {
  return (
    <div className={styles.kmCell}>
      <span className={styles.kmLbl}>{lbl}</span>
      <span className={`${styles.kmVal} tabular`} style={col ? { color: col } : undefined}>
        {val}
      </span>
    </div>
  )
}

function Ttm({ lbl, val }: { lbl: string; val: string }) {
  return (
    <div className={styles.ttmCell}>
      <div className={styles.ttmLbl}>{lbl}</div>
      <div className={`${styles.ttmVal} tabular`}>{val}</div>
    </div>
  )
}
