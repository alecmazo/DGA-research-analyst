import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api, downloadAuth } from '@/lib/api'
import { fmtPct, fmtUsd, pctClass } from '@/lib/format'
import { FundPositionsTable } from './FundPositionsTable'
import type {
  FundDetail,
  FundPosition,
  RebalanceResult,
  YtdCache,
  YtdResult,
} from './types'
import styles from './fund.module.css'

const BENCH_OPTIONS = [
  { key: 'SPY', label: 'SPY — S&P 500' },
  { key: 'QQQ', label: 'QQQ — Nasdaq 100' },
  { key: 'DIA', label: 'DIA — Dow Jones' },
  { key: 'URTH', label: 'URTH — MSCI World' },
  { key: 'EFA', label: 'EFA — MSCI EAFE' },
  { key: 'AGG', label: 'AGG — US Bonds' },
]

type Props = {
  fundId: string
  detail: FundDetail
  onBack: () => void
}

function parseYtd(cache: YtdCache): YtdResult | null {
  if (!cache?.result_json) return null
  if (typeof cache.result_json === 'string') {
    try {
      return JSON.parse(cache.result_json) as YtdResult
    } catch {
      return null
    }
  }
  return cache.result_json
}

export function ManagedDetail({ fundId, detail, onBack }: Props) {
  const [positions, setPositions] = useState<FundPosition[]>([])
  const [ytd, setYtd] = useState<YtdResult | null>(null)
  const [cachedYtd, setCachedYtd] = useState<number | null>(null)
  const [reb, setReb] = useState<RebalanceResult | null>(null)
  const [bench, setBench] = useState('SPY')
  const [benchYtd, setBenchYtd] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [rebBusy, setRebBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [balFile, setBalFile] = useState<File | null>(null)
  const [posFile, setPosFile] = useState<File | null>(null)
  const [actFile, setActFile] = useState<File | null>(null)
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [runBusy, setRunBusy] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const [pos, cache, rebData] = await Promise.all([
        api<FundPosition[]>(`/api/fund/positions?fund_id=${encodeURIComponent(fundId)}`).catch(
          () => [],
        ),
        api<YtdCache>(
          `/api/fund/account/${encodeURIComponent(fundId)}/ytd-cache`,
        ).catch(() => ({}) as YtdCache),
        api<RebalanceResult>(
          `/api/v2/gp/fund/${encodeURIComponent(fundId)}/rebalance`,
        ).catch(() => null),
      ])
      setPositions(Array.isArray(pos) ? pos : [])
      const parsed = parseYtd(cache)
      setYtd(parsed)
      setCachedYtd(cache.ytd_pct ?? null)
      if (rebData?.ok && rebData.rows) setReb(rebData)
      else setReb(null)

      const spyPts = parsed?.spy_monthly?.points || []
      const spyPct = spyPts.length ? spyPts[spyPts.length - 1].ytd_pct ?? null : null
      setBenchYtd(spyPct ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load account')
    } finally {
      setLoading(false)
    }
  }, [fundId])

  useEffect(() => {
    void load()
  }, [load])

  // Alternate benchmark
  useEffect(() => {
    if (bench === 'SPY') {
      const spyPts = ytd?.spy_monthly?.points || []
      setBenchYtd(spyPts.length ? spyPts[spyPts.length - 1].ytd_pct ?? null : null)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const d = await api<{ points?: Array<{ ytd_pct?: number }> }>(
          `/api/market/spy-monthly?ticker=${encodeURIComponent(bench)}`,
        )
        if (!alive) return
        const pts = d.points || []
        setBenchYtd(pts.length ? pts[pts.length - 1].ytd_pct ?? null : null)
      } catch {
        if (alive) setBenchYtd(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [bench, ytd])

  const liveNav = useMemo(
    () => positions.reduce((s, p) => s + (p.market_value || 0), 0),
    [positions],
  )

  const twrr =
    ytd?.twrr_return_pct != null
      ? ytd.twrr_return_pct
      : ytd?.md_return_pct != null
        ? ytd.md_return_pct
        : cachedYtd
  let xirr = ytd?.xirr_return_pct ?? null
  if (xirr != null && ytd?.twrr_return_pct != null && Math.abs(xirr - ytd.twrr_return_pct) > 50) {
    xirr = null
  }
  const alpha =
    twrr != null && benchYtd != null ? twrr - benchYtd : null

  const monthly = ytd?.monthly_chart?.monthly || []
  const attr = [...(ytd?.attribution || [])].sort(
    (a, b) => (b.contribution_pct || 0) - (a.contribution_pct || 0),
  )
  const flows = ytd?.flows || []
  const maxContrib = Math.max(...attr.map((r) => Math.abs(r.contribution_pct || 0)), 0.01)

  const runRebalance = async () => {
    setRebBusy(true)
    try {
      const data = await api<RebalanceResult>(
        `/api/v2/gp/fund/${encodeURIComponent(fundId)}/rebalance`,
        { method: 'POST' },
      )
      if (!data.ok) throw new Error(data.detail || 'Rebalance failed')
      setReb(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Rebalance failed')
    } finally {
      setRebBusy(false)
    }
  }

  const doExport = async (type: 'excel' | 'pdf') => {
    setExportBusy(true)
    try {
      await downloadAuth(
        `/api/fund/export-${type}?fund_id=${encodeURIComponent(fundId)}`,
        `${detail.short_name || fundId}.${type === 'excel' ? 'xlsx' : 'pdf'}`,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExportBusy(false)
    }
  }

  const runAnalysis = async () => {
    if (!balFile && !(posFile && actFile)) {
      setRunStatus(
        '❌ Choose the Balance & Income Detail CSV (Positions + Activity optional).',
      )
      return
    }
    setRunBusy(true)
    setRunStatus(null)
    const notes: string[] = []
    try {
      if (balFile) {
        const fd = new FormData()
        fd.append('file', balFile)
        const d = await api<{ months?: number; ytd_label?: string; detail?: string }>(
          `/api/fund/${encodeURIComponent(fundId)}/import-balance-history`,
          { method: 'POST', body: fd },
        )
        notes.push(`${d.months ?? '?'} mo · YTD ${d.ytd_label || ''}`)
      }
      if (posFile && actFile) {
        const fd = new FormData()
        fd.append('positions_file', posFile)
        fd.append('activity_file', actFile)
        if (balFile) fd.append('monthly_perf_file', balFile)
        const d = await api<{
          positions_sync_ok?: boolean
          positions_sync_msg?: string
          detail?: string
        }>(`/api/fund/account/${encodeURIComponent(fundId)}/ytd-run`, {
          method: 'POST',
          body: fd,
        })
        notes.push(
          d.positions_sync_ok
            ? 'holdings + attribution'
            : d.positions_sync_msg || 'attribution',
        )
      }
      setRunStatus(`✅ ${notes.join(' · ')} · Reloading…`)
      await load()
    } catch (e) {
      setRunStatus(`❌ ${e instanceof Error ? e.message : 'Run failed'}`)
    } finally {
      setRunBusy(false)
    }
  }

  const title = `${detail.fund_name || 'Account'}${detail.short_name ? ` (${detail.short_name})` : ''}`

  return (
    <div className={styles.detail}>
      <div className={styles.toolbar}>
        <Button variant="secondary" size="sm" onClick={onBack}>
          ← Back to Accounts
        </Button>
        <h2 className={styles.detailTitle}>{title}</h2>
        <div className={styles.toolbarRight}>
          <Button
            size="sm"
            variant="secondary"
            disabled={exportBusy}
            onClick={() => void doExport('excel')}
          >
            ⬇ Excel
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={exportBusy}
            onClick={() => void doExport('pdf')}
          >
            ⬇ PDF
          </Button>
        </div>
      </div>

      {err && <div className={styles.bannerErr}>{err}</div>}
      {loading ? (
        <Spinner label="Loading managed account…" />
      ) : (
        <>
          {/* Headline tiles */}
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Account Value</div>
              <div className={styles.tileVal}>
                {fmtUsd(liveNav > 0 ? liveNav : detail.nav ?? detail.market_nav)}
              </div>
              <div className={styles.tileSub}>
                {liveNav > 0
                  ? 'Live from positions'
                  : detail.nav_as_of
                    ? `as of ${detail.nav_as_of}`
                    : '—'}
              </div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>YTD Return</div>
              <div className={`${styles.tileVal} ${pctClass(twrr)}`}>{fmtPct(twrr)}</div>
              <div className={styles.tileSub}>Time-weighted (TWR)</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>{bench} YTD</div>
              <div className={`${styles.tileVal} ${pctClass(benchYtd)}`}>
                {fmtPct(benchYtd)}
              </div>
              <div className={styles.tileSub}>
                <select
                  className={styles.benchSelect}
                  value={bench}
                  onChange={(e) => setBench(e.target.value)}
                >
                  {BENCH_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Alpha</div>
              <div className={`${styles.tileVal} ${pctClass(alpha)}`}>{fmtPct(alpha)}</div>
              <div className={styles.tileSub}>vs {bench}</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Your Personal Return</div>
              <div className={`${styles.tileVal} ${pctClass(xirr)}`}>{fmtPct(xirr)}</div>
              <div className={styles.tileSub}>
                {ytd?.xirr_note || 'Money-weighted · reflects deposit timing'}
              </div>
            </div>
          </div>

          <div className={styles.metaLine}>
            <span>
              Managed Account
              {detail.short_name ? (
                <>
                  {' '}
                  · <strong>{detail.short_name}</strong>
                </>
              ) : null}
            </span>
            <span>
              Status <strong>{(detail.status || 'open').toUpperCase()}</strong>
            </span>
            <span>
              Inception <strong>{detail.inception_date || '—'}</strong>
            </span>
            {detail.mgmt_fee_pct != null && (
              <span>
                <strong>{(detail.mgmt_fee_pct * 100).toFixed(2)}% fee</strong>
              </span>
            )}
          </div>

          {/* Monthly balance */}
          <Panel title="Monthly Investment Balance vs Benchmark" badge="YTD">
            {!monthly.length ? (
              <Empty
                title="No performance data yet"
                sub='Upload the Fidelity "Investment Income & Balance Detail" CSV (or wait for SnapTrade sync) to populate returns and attribution.'
              />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="tabular">End balance</th>
                      <th className="tabular">Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m, i) => (
                      <tr key={i}>
                        <td>{m.label || m.month || '—'}</td>
                        <td className="tabular">{fmtUsd(m.end_balance)}</td>
                        <td className={`tabular ${pctClass(m.return_pct)}`}>
                          {fmtPct(m.return_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className={styles.sideBySide}>
            <FundPositionsTable rows={positions} />
            <Panel
              title="Rebalance Suggestions"
              badge={reb?.rows?.length || undefined}
              action={
                <Button size="sm" variant="primary" disabled={rebBusy} onClick={() => void runRebalance()}>
                  {rebBusy ? '…' : '📊 Run'}
                </Button>
              }
              flush
            >
              {!reb?.rows?.length ? (
                <div className={styles.pad}>
                  <p className={styles.hint}>
                    Run to compute suggested weights from research ratings &amp; upside.
                  </p>
                </div>
              ) : (
                <>
                  <div className={styles.rebEv}>
                    Expected value{' '}
                    <strong>{(reb.current_ev || 0).toFixed(1)}%</strong>
                    {' → '}
                    <strong className={pctClass((reb.suggested_ev || 0) - (reb.current_ev || 0))}>
                      {(reb.suggested_ev || 0).toFixed(1)}%
                    </strong>
                    {reb.run_at && (
                      <span className={styles.hint}> · {new Date(reb.run_at).toLocaleString()}</span>
                    )}
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Ticker</th>
                          <th>Rating</th>
                          <th className="tabular">Upside</th>
                          <th className="tabular">Cur → Sug</th>
                          <th className="tabular">Δ Sh</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...reb.rows]
                          .sort((a, b) => (b.suggested_pct || 0) - (a.suggested_pct || 0))
                          .map((row) => {
                            const sd = row.shares_delta
                            return (
                              <tr key={row.ticker}>
                                <td className={styles.tk}>{row.ticker}</td>
                                <td>{row.rating || '—'}</td>
                                <td className={`tabular ${pctClass(row.upside_pct)}`}>
                                  {fmtPct(row.upside_pct, 1)}
                                </td>
                                <td className="tabular">
                                  {(row.current_pct || 0).toFixed(1)}% →{' '}
                                  <strong>{(row.suggested_pct || 0).toFixed(1)}%</strong>
                                </td>
                                <td className={`tabular ${pctClass(sd)}`}>
                                  {sd != null && Math.abs(sd) >= 0.01
                                    ? `${sd > 0 ? '+' : ''}${sd.toFixed(2)}`
                                    : '—'}
                                </td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Panel>
          </div>

          <div className={styles.sideBySide}>
            <Panel
              title="YTD Attribution (per-stock contribution)"
              badge={attr.length || undefined}
              flush
            >
              {!attr.length ? (
                <div className={styles.pad}>
                  <p className={styles.hint}>
                    No per-stock attribution yet. Built from YTD activity — after a
                    fresh Fidelity re-link, SnapTrade may take a while to deliver
                    transactions. Fills in on the next sync.
                  </p>
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th className="tabular">Shares</th>
                        <th className="tabular">Jan 1 → Now</th>
                        <th className="tabular">Gain</th>
                        <th className="tabular">Return</th>
                        <th className="tabular">Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attr.map((r) => {
                        const bar =
                          r.contribution_pct != null
                            ? Math.min(
                                (Math.abs(r.contribution_pct) / maxContrib) * 100,
                                100,
                              )
                            : 0
                        return (
                          <tr key={r.ticker}>
                            <td>
                              <span className={styles.tk}>{r.ticker || '—'}</span>
                              {r.closed && <span className={styles.pill}>SOLD</span>}
                              {r.predecessor && (
                                <span className={styles.pill}>PRIOR</span>
                              )}
                              {r.origin_transfer && (
                                <span className={styles.pillWarn}>IN-KIND</span>
                              )}
                            </td>
                            <td className="tabular">
                              {r.end_shares != null && r.end_shares > 0
                                ? r.end_shares.toFixed(2)
                                : '—'}
                            </td>
                            <td className="tabular">
                              {r.jan1_price != null ? fmtUsd(r.jan1_price, 2) : '—'} →{' '}
                              {r.end_price != null ? fmtUsd(r.end_price, 2) : '—'}
                            </td>
                            <td className={`tabular ${pctClass(r.dollar_gain)}`}>
                              {r.dollar_gain != null ? fmtUsd(r.dollar_gain) : '—'}
                            </td>
                            <td className={`tabular ${pctClass(r.ticker_return_pct)}`}>
                              {fmtPct(r.ticker_return_pct)}
                            </td>
                            <td>
                              <div className={styles.contrib}>
                                <span className={pctClass(r.contribution_pct)}>
                                  {fmtPct(r.contribution_pct)}
                                </span>
                                <div className={styles.contribTrack}>
                                  <div
                                    className={styles.contribFill}
                                    style={{
                                      width: `${bar}%`,
                                      background:
                                        (r.contribution_pct || 0) >= 0
                                          ? '#1a7f40'
                                          : '#cc3333',
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {ytd?.attribution_contrib_sum != null && (
                    <div className={styles.attrSum}>
                      Σ {fmtPct(ytd.attribution_contrib_sum)}
                      {twrr != null ? ` · portfolio YTD ${fmtPct(twrr)}` : ''}
                      {ytd.attribution_estimated
                        ? ' · ≈ price-based estimate (trades pending)'
                        : ''}
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="YTD Cash Flows" badge={flows.length || undefined} flush>
              {!flows.length ? (
                <div className={styles.pad}>
                  <p className={styles.hint}>No cash-flow rows in the YTD cache.</p>
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Action</th>
                        <th>Symbol</th>
                        <th className="tabular">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flows.map((f, i) => (
                        <tr key={i}>
                          <td>{f.date || '—'}</td>
                          <td>{f.action || f.type || '—'}</td>
                          <td className={styles.tk}>{f.symbol || f.ticker || '—'}</td>
                          <td className={`tabular ${pctClass(f.amount)}`}>
                            {f.amount != null ? fmtUsd(f.amount) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Manual Data Uploads" badge="CSV · backup">
            <div className={styles.uploadGrid}>
              <label className={styles.fileCard}>
                <div className={styles.fileTitle}>
                  Balance &amp; Income Detail <span className={styles.req}>required</span>
                </div>
                <div className={styles.hint}>
                  Fidelity → Performance → Income &amp; Balance Detail · drives YTD
                  return/NAV + monthly chart
                </div>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => setBalFile(e.target.files?.[0] || null)}
                />
                <div className={styles.fileName}>{balFile?.name || 'No file chosen'}</div>
              </label>
              <label className={styles.fileCard}>
                <div className={styles.fileTitle}>
                  Positions CSV <span className={styles.opt}>optional</span>
                </div>
                <div className={styles.hint}>Holdings analysis</div>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => setPosFile(e.target.files?.[0] || null)}
                />
                <div className={styles.fileName}>{posFile?.name || 'No file chosen'}</div>
              </label>
              <label className={styles.fileCard}>
                <div className={styles.fileTitle}>
                  Activity CSV <span className={styles.opt}>optional</span>
                </div>
                <div className={styles.hint}>Cash-flow attribution</div>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => setActFile(e.target.files?.[0] || null)}
                />
                <div className={styles.fileName}>{actFile?.name || 'No file chosen'}</div>
              </label>
            </div>
            <div className={styles.uploadActions}>
              <Button
                size="sm"
                variant="primary"
                disabled={runBusy}
                onClick={() => void runAnalysis()}
              >
                {runBusy ? 'Running…' : '▶ Run'}
              </Button>
              {runStatus && <span className={styles.runStatus}>{runStatus}</span>}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
