import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api, downloadAuth } from '@/lib/api'
import { fmtUsd, pctClass } from '@/lib/format'
import { FundPositionsTable } from './FundPositionsTable'
import type { FundDetail, FundPosition, Waterfall } from './types'
import styles from './fund.module.css'

type Props = {
  fundId: string
  detail: FundDetail
  onBack: () => void
}

export function LpDetail({ fundId, detail, onBack }: Props) {
  const [positions, setPositions] = useState<FundPosition[]>([])
  const [wf, setWf] = useState<Waterfall | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [pos, waterfall] = await Promise.all([
        api<FundPosition[]>(
          `/api/fund/positions?fund_id=${encodeURIComponent(fundId)}`,
        ).catch(() => []),
        api<Waterfall>(
          `/api/fund/waterfall?fund_id=${encodeURIComponent(fundId)}`,
        ).catch(() => null),
      ])
      setPositions(Array.isArray(pos) ? pos : [])
      setWf(waterfall)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load fund')
    } finally {
      setLoading(false)
    }
  }, [fundId])

  useEffect(() => {
    void load()
  }, [load])

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

  const feePct =
    detail.mgmt_fee_pct != null ? `${(detail.mgmt_fee_pct * 100).toFixed(2)}%` : '—'
  const carryPct =
    detail.carry_pct != null ? `${(detail.carry_pct * 100).toFixed(2)}%` : '—'
  const hurdlePct =
    detail.hurdle_pct != null ? `${(detail.hurdle_pct * 100).toFixed(2)}%` : '—'
  const lps = detail.lps || []
  const totalCommitted =
    detail.total_committed ||
    lps.reduce((s, lp) => s + (lp.commitment_amount || lp.committed || 0), 0)
  const snaps = wf?.annual_snapshots || []
  const title = `${detail.fund_name || 'Fund'}${detail.short_name ? ` (${detail.short_name})` : ''}`

  return (
    <div className={styles.detail}>
      <div className={styles.toolbar}>
        <Button variant="secondary" size="sm" onClick={onBack}>
          ← Back to Funds
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
        <Spinner label="Loading LP fund…" />
      ) : (
        <>
          <Panel title="Fund Overview" badge={(detail.status || 'open').toUpperCase()}>
            <div className={styles.overviewGrid}>
              <div>
                <div className={styles.ovLabel}>Type</div>
                <div className={styles.ovVal}>LP Fund</div>
                <div className={styles.ovSub}>{detail.short_name || ''}</div>
              </div>
              <div>
                <div className={styles.ovLabel}>NAV</div>
                <div className={styles.ovVal}>{fmtUsd(detail.nav ?? detail.market_nav)}</div>
                <div className={styles.ovSub}>
                  {detail.nav_as_of
                    ? `as of ${detail.nav_as_of}`
                    : detail.market_nav
                      ? 'Live from positions'
                      : 'No snapshot'}
                </div>
              </div>
              <div>
                <div className={styles.ovLabel}>LPs / Committed</div>
                <div className={styles.ovVal}>{detail.lp_count ?? lps.length}</div>
                <div className={styles.ovSub}>{fmtUsd(totalCommitted)} committed</div>
              </div>
              <div>
                <div className={styles.ovLabel}>Carry / Hurdle</div>
                <div className={styles.ovVal}>{carryPct}</div>
                <div className={styles.ovSub}>
                  Hurdle {hurdlePct} · fee {feePct}
                </div>
              </div>
              <div>
                <div className={styles.ovLabel}>High watermark</div>
                <div className={styles.ovVal}>
                  {wf?.high_watermark != null ? fmtUsd(wf.high_watermark) : '—'}
                </div>
                <div className={styles.ovSub}>
                  {wf?.hurdle_cleared != null
                    ? wf.hurdle_cleared
                      ? 'Hurdle ✓ cleared'
                      : 'Hurdle not cleared'
                    : '—'}
                </div>
              </div>
              <div>
                <div className={styles.ovLabel}>GP accrued carry</div>
                <div className={styles.ovVal}>
                  {wf?.gp_accrued_carry != null ? fmtUsd(wf.gp_accrued_carry) : '—'}
                </div>
                <div className={styles.ovSub}>
                  {wf?.gp_equity_pct != null
                    ? `${wf.gp_equity_pct.toFixed(2)}% of NAV`
                    : '—'}
                </div>
              </div>
              <div>
                <div className={styles.ovLabel}>LP NAV (net of carry)</div>
                <div className={styles.ovVal}>
                  {wf?.lp_nav_after_carry != null ? fmtUsd(wf.lp_nav_after_carry) : '—'}
                </div>
                <div className={styles.ovSub}>after fractional carry</div>
              </div>
              <div>
                <div className={styles.ovLabel}>Inception</div>
                <div className={styles.ovVal}>{detail.inception_date || '—'}</div>
              </div>
            </div>
          </Panel>

          <Panel
            title="LP Roster"
            badge={
              lps.length
                ? `${lps.length} partners · ${fmtUsd(totalCommitted)}`
                : undefined
            }
            flush
          >
            {!lps.length ? (
              <div className={styles.pad}>
                <Empty
                  title="No LPs yet"
                  sub="Upload the Annual NAV / Waterfall Excel from the legacy tools, or add LPs in Settings → Fund Administration."
                />
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th className="tabular">Commitment</th>
                      <th className="tabular">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lps.map((lp, i) => {
                      const c = lp.commitment_amount ?? lp.committed ?? 0
                      const share = totalCommitted ? (c / totalCommitted) * 100 : 0
                      return (
                        <tr key={i}>
                          <td className={styles.tk}>
                            {lp.legal_name || lp.name || '—'}
                          </td>
                          <td className={styles.muted}>{lp.primary_email || '—'}</td>
                          <td className="tabular">{fmtUsd(c)}</td>
                          <td className="tabular">{share.toFixed(2)}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <FundPositionsTable rows={positions} />

          <Panel
            title="GP Waterfall & Carry"
            badge={snaps.length ? `${snaps.length} years` : undefined}
            flush
          >
            {!snaps.length ? (
              <div className={styles.pad}>
                <Empty
                  title="No annual snapshots"
                  sub={
                    wf?.data_source_warning ||
                    'Upload the Annual NAV / Waterfall Excel to populate carry.'
                  }
                />
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th className="tabular">Jan 1 NAV</th>
                      <th className="tabular">Dec 31 NAV</th>
                      <th className="tabular">Gross Profit</th>
                      <th className="tabular">HWM</th>
                      <th className="tabular">Hurdle</th>
                      <th className="tabular">Carry Earned</th>
                      <th className="tabular">GP Equity</th>
                      <th className="tabular">Accum GP %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snaps.map((r) => (
                      <tr key={r.year}>
                        <td>{r.year}</td>
                        <td className="tabular">{fmtUsd(r.start_nav)}</td>
                        <td className="tabular">{fmtUsd(r.end_nav)}</td>
                        <td className={`tabular ${pctClass(r.gross_profit)}`}>
                          {fmtUsd(r.gross_profit)}
                        </td>
                        <td className="tabular">{fmtUsd(r.hwm_threshold)}</td>
                        <td className="tabular">{fmtUsd(r.hurdle_amount)}</td>
                        <td className="tabular">
                          {(r.carry_earned || 0) > 0 ? fmtUsd(r.carry_earned) : '—'}
                        </td>
                        <td className="tabular">{fmtUsd(r.gp_equity_end)}</td>
                        <td className="tabular">
                          {r.accum_gp_pct != null
                            ? `${r.accum_gp_pct.toFixed(2)}%`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {wf?.per_lp && wf.per_lp.length > 0 && (
            <Panel
              title="Per-LP Allocation (After Carry)"
              badge={wf.per_lp.length}
              flush
            >
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>LP</th>
                      <th className="tabular">Commitment</th>
                      <th className="tabular">Share</th>
                      <th className="tabular">Carry Charge</th>
                      <th className="tabular">NAV After Carry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wf.per_lp.map((lp, i) => (
                      <tr key={i}>
                        <td className={styles.tk}>{lp.legal_name}</td>
                        <td className="tabular">{fmtUsd(lp.commitment)}</td>
                        <td className="tabular">
                          {lp.share_pct != null ? `${lp.share_pct.toFixed(2)}%` : '—'}
                        </td>
                        <td className="tabular neg">
                          {fmtUsd(lp.carry_charge || 0)}
                        </td>
                        <td className="tabular">
                          <strong>{fmtUsd(lp.nav_after_carry || 0)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
