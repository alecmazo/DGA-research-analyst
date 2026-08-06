import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Empty, Spinner } from '@/components/ui/Empty'
import {
  PortfolioChart,
  type ChartPeriod,
} from '@/components/charts/PortfolioChart'
import { api } from '@/lib/api'
import {
  fmtPct,
  fmtPx,
  fmtQty,
  fmtUsd,
  fmtUsdSigned,
  pctClass,
} from '@/lib/format'
import page from './page.module.css'
import styles from './PositionsPage.module.css'

type BookPosition = {
  symbol?: string
  name?: string
  fund_id?: string | null
  account_name?: string
  fund_name?: string
  total_qty?: number
  quantity?: number
  last_price?: number
  market_value?: number
  day_change_abs?: number | null
  day_change_pct?: number | null
  unrealized_gain?: number | null
  unrealized_gain_pct?: number | null
  avg_cost?: number | null
  cost_basis?: number | null
}

type BookResponse = {
  positions?: BookPosition[]
  total_market_value?: number
}

type SortCol =
  | 'symbol'
  | 'price'
  | 'day'
  | 'daypct'
  | 'total'
  | 'totalpct'
  | 'value'
  | 'pct'
  | 'qty'

const ORDER_KEY = '_dga_acct_order'

function loadAcctOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') as string[]
  } catch {
    return []
  }
}

function saveAcctOrder(arr: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(arr))
  } catch {
    /* ignore */
  }
}

function acctKey(p: BookPosition): string {
  return p.account_name || p.fund_name || 'Portfolio'
}

export function PositionsPage() {
  const [all, setAll] = useState<BookPosition[]>([])
  const [totalMV, setTotalMV] = useState(0)
  const [active, setActive] = useState<string>('__all__')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [period, setPeriod] = useState<ChartPeriod>('ytd')
  const [sortCol, setSortCol] = useState<SortCol>('value')
  const [sortDir, setSortDir] = useState<-1 | 1>(-1)
  const [acctOrder, setAcctOrder] = useState<string[]>(() => loadAcctOrder())
  const [asOf, setAsOf] = useState('')

  const load = useCallback(async () => {
    setErr(null)
    try {
      const data = await api<BookResponse>('/api/v2/lp/me/positions')
      const positions = [...(data.positions || [])].sort(
        (a, b) => (b.market_value || 0) - (a.market_value || 0),
      )
      setAll(positions)
      setTotalMV(data.total_market_value || 0)
      setAsOf(
        new Date().toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }) + ' PT',
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load positions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => {
      if (document.hidden) return
      void load()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [load])

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        positions: BookPosition[]
        navSum: number
        daySum: number
        dayValid: boolean
        fund_id: string | null
      }
    >()
    for (const p of all) {
      const k = acctKey(p)
      let g = map.get(k)
      if (!g) {
        g = {
          positions: [],
          navSum: 0,
          daySum: 0,
          dayValid: false,
          fund_id: p.fund_id || null,
        }
        map.set(k, g)
      }
      if (!g.fund_id && p.fund_id) g.fund_id = p.fund_id
      g.positions.push(p)
      if (p.market_value) g.navSum += p.market_value
      if (p.day_change_abs != null && p.total_qty != null) {
        g.daySum += p.day_change_abs * p.total_qty
        g.dayValid = true
      }
    }
    let order = [...map.keys()]
    if (acctOrder.length) {
      order.sort((a, b) => {
        let ia = acctOrder.indexOf(a)
        let ib = acctOrder.indexOf(b)
        if (ia < 0) ia = 9999
        if (ib < 0) ib = 9999
        return ia - ib
      })
    }
    return { map, order }
  }, [all, acctOrder])

  const rows = useMemo(() => {
    if (active === '__all__') return all
    return groups.map.get(active)?.positions || []
  }, [all, active, groups])

  const chartFundId =
    active === '__all__' ? null : groups.map.get(active)?.fund_id || null

  const stats = useMemo(() => {
    let dayChangeAbs = 0
    let validDay = false
    let totalUnreal = 0
    let hasUnreal = false
    let gainers = 0
    let losers = 0
    for (const p of rows) {
      if (p.day_change_abs != null && p.total_qty != null) {
        dayChangeAbs += p.day_change_abs * p.total_qty
        validDay = true
      }
      if (p.unrealized_gain != null) {
        totalUnreal += p.unrealized_gain
        hasUnreal = true
      }
      if ((p.day_change_pct || 0) > 0) gainers++
      if ((p.day_change_pct || 0) < 0) losers++
    }
    const totVal = rows.reduce((s, p) => s + (p.market_value || 0), 0)
    return {
      dayChangeAbs,
      validDay,
      totalUnreal,
      hasUnreal,
      gainers,
      losers,
      totVal,
      count: rows.length,
    }
  }, [rows])

  const sorted = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      if (sortCol === 'symbol') {
        return sortDir * ((a.symbol || '') < (b.symbol || '') ? 1 : -1)
      }
      let av = 0
      let bv = 0
      if (sortCol === 'price') {
        av = a.last_price || 0
        bv = b.last_price || 0
      } else if (sortCol === 'day') {
        av = (a.day_change_abs || 0) * (a.total_qty || a.quantity || 0)
        bv = (b.day_change_abs || 0) * (b.total_qty || b.quantity || 0)
      } else if (sortCol === 'daypct') {
        av = a.day_change_pct || 0
        bv = b.day_change_pct || 0
      } else if (sortCol === 'total') {
        av = a.unrealized_gain || 0
        bv = b.unrealized_gain || 0
      } else if (sortCol === 'totalpct') {
        av = a.unrealized_gain_pct || 0
        bv = b.unrealized_gain_pct || 0
      } else if (sortCol === 'value' || sortCol === 'pct') {
        av = a.market_value || 0
        bv = b.market_value || 0
      } else if (sortCol === 'qty') {
        av = a.total_qty || a.quantity || 0
        bv = b.total_qty || b.quantity || 0
      }
      return sortDir * (bv - av)
    })
    return list
  }, [rows, sortCol, sortDir])

  const onSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === -1 ? 1 : -1))
    else {
      setSortCol(col)
      setSortDir(-1)
    }
  }

  const moveAcct = (idx: number, dir: -1 | 1) => {
    const order = [...groups.order]
    const ni = idx + dir
    if (ni < 0 || ni >= order.length) return
    const tmp = order[idx]
    order[idx] = order[ni]
    order[ni] = tmp
    setAcctOrder(order)
    saveAcctOrder(order)
  }

  const title =
    active === '__all__' ? 'All Accounts' : active

  const dayPctAll =
    stats.validDay && stats.totVal > 0
      ? (stats.dayChangeAbs / (stats.totVal - stats.dayChangeAbs || 1)) * 100
      : null

  return (
    <div className={page.page}>
      {err && <div className={page.bannerErr}>{err}</div>}
      {loading && !all.length ? (
        <Spinner label="Loading book positions…" />
      ) : (
        <div className={styles.shell}>
          <aside className={styles.sidebar}>
            <div className={styles.sideHdr}>
              <div className={styles.sideTitle}>Accounts</div>
              <div className={styles.sideAsof}>{asOf ? `As of ${asOf}` : '—'}</div>
            </div>
            <button
              type="button"
              className={`${styles.sideSummary} ${active === '__all__' ? styles.sideActive : ''}`}
              onClick={() => setActive('__all__')}
            >
              <div className={styles.sideTotal}>{fmtUsd(totalMV)}</div>
              {stats.validDay && active === '__all__' && (
                <div className={`${styles.sideDay} ${pctClass(stats.dayChangeAbs)}`}>
                  {fmtUsdSigned(stats.dayChangeAbs)} (
                  {fmtPct(dayPctAll)}) today
                </div>
              )}
              <div className={styles.sideSub}>
                {all.length} positions · {groups.order.length} account
                {groups.order.length !== 1 ? 's' : ''}
              </div>
            </button>
            <div className={styles.acctList}>
              {groups.order.map((name, idx) => {
                const g = groups.map.get(name)!
                const pct =
                  g.dayValid && g.navSum > 0
                    ? (g.daySum / (g.navSum - g.daySum || 1)) * 100
                    : null
                return (
                  <div
                    key={name}
                    className={`${styles.acctItem} ${active === name ? styles.sideActive : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.acctBtn}
                      onClick={() => setActive(name)}
                    >
                      <div className={styles.acctRow}>
                        <div className={styles.acctName}>{name}</div>
                        <div className={styles.acctVal}>{fmtUsd(g.navSum)}</div>
                      </div>
                      <div className={styles.acctRow2}>
                        <div className={styles.acctSub}>
                          {g.positions.length} position
                          {g.positions.length !== 1 ? 's' : ''}
                        </div>
                        {g.dayValid && (
                          <div className={`${styles.acctDay} ${pctClass(g.daySum)}`}>
                            {fmtUsdSigned(g.daySum)} ({fmtPct(pct)})
                          </div>
                        )}
                      </div>
                    </button>
                    <div className={styles.sortBtns}>
                      <button
                        type="button"
                        disabled={idx === 0}
                        title="Move up"
                        onClick={() => moveAcct(idx, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={idx === groups.order.length - 1}
                        title="Move down"
                        onClick={() => moveAcct(idx, 1)}
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          <div className={styles.pane}>
            <header className={page.hero}>
              <div>
                <p className={page.kicker}>Book · live</p>
                <h1 className={page.h1}>{title}</h1>
                <p className={page.sub}>
                  Holdings across funds and managed accounts — day move, unrealized
                  P&amp;L, and weight.
                </p>
              </div>
              <div className={styles.periods}>
                {(['1m', 'ytd', '1y', '3y'] as ChartPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`${styles.periodBtn} ${period === p ? styles.periodOn : ''}`}
                    onClick={() => setPeriod(p)}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </header>

            <div className={styles.kpiStrip}>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Positions</div>
                <div className={styles.kpiVal}>{stats.count}</div>
                <div className={styles.kpiHint}>In selected book</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Up today</div>
                <div className={`${styles.kpiVal} pos`}>{stats.gainers}</div>
                <div className={styles.kpiHint}>Names green on day</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Down today</div>
                <div className={`${styles.kpiVal} neg`}>{stats.losers}</div>
                <div className={styles.kpiHint}>Names red on day</div>
              </div>
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Unrealized</div>
                <div
                  className={`${styles.kpiVal} ${pctClass(stats.hasUnreal ? stats.totalUnreal : null)}`}
                >
                  {stats.hasUnreal ? fmtUsdSigned(stats.totalUnreal) : '—'}
                </div>
                <div className={styles.kpiHint}>Open P&amp;L</div>
              </div>
            </div>

            <Panel title="Portfolio Chart" badge={period.toUpperCase()} flush>
              <div className={styles.chartPad}>
                <PortfolioChart period={period} fundId={chartFundId} height={180} />
              </div>
            </Panel>

            <Panel
              title="Holdings"
              badge={sorted.length}
              action={
                <span className={styles.meta}>
                  {fmtUsd(stats.totVal)} · auto-refresh 30s
                </span>
              }
              flush
            >
              {!sorted.length ? (
                <Empty title="No positions" sub="No holdings in this selection." />
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {(
                          [
                            ['symbol', 'Symbol'],
                            ['price', 'Last price'],
                            ['day', "Today's $"],
                            ['daypct', "Today's %"],
                            ['total', 'Total $'],
                            ['totalpct', 'Total %'],
                            ['value', 'Current value'],
                            ['pct', '% of acct'],
                            ['qty', 'Quantity'],
                          ] as [SortCol, string][]
                        ).map(([col, label]) => (
                          <th
                            key={col}
                            className={
                              sortCol === col
                                ? sortDir === -1
                                  ? styles.sortDesc
                                  : styles.sortAsc
                                : undefined
                            }
                            onClick={() => onSort(col)}
                          >
                            {label}
                          </th>
                        ))}
                        <th>Cost basis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p, i) => {
                        const qty = p.total_qty ?? p.quantity
                        const dayAbs =
                          p.day_change_abs != null && qty != null
                            ? p.day_change_abs * qty
                            : null
                        const wt =
                          p.market_value != null && stats.totVal > 0
                            ? (p.market_value / stats.totVal) * 100
                            : null
                        return (
                          <tr key={`${p.symbol}-${acctKey(p)}-${i}`}>
                            <td>
                              <div className={styles.tk}>{p.symbol || '—'}</div>
                              <div className={styles.co}>{p.name || p.symbol}</div>
                            </td>
                            <td className="tabular">
                              <div>{fmtPx(p.last_price)}</div>
                              {p.day_change_abs != null && (
                                <div className={`sub ${pctClass(p.day_change_abs)}`}>
                                  {p.day_change_abs >= 0 ? '+' : '−'}$
                                  {Math.abs(p.day_change_abs).toFixed(2)}/sh
                                </div>
                              )}
                            </td>
                            <td className={`tabular ${pctClass(dayAbs)}`}>
                              {fmtUsdSigned(dayAbs)}
                            </td>
                            <td className={`tabular ${pctClass(p.day_change_pct)}`}>
                              {fmtPct(p.day_change_pct)}
                            </td>
                            <td className={`tabular ${pctClass(p.unrealized_gain)}`}>
                              {fmtUsdSigned(p.unrealized_gain)}
                            </td>
                            <td
                              className={`tabular ${pctClass(p.unrealized_gain_pct)}`}
                            >
                              {fmtPct(p.unrealized_gain_pct)}
                            </td>
                            <td className="tabular">{fmtUsd(p.market_value)}</td>
                            <td className="tabular">
                              {wt != null ? `${wt.toFixed(2)}%` : '—'}
                            </td>
                            <td className="tabular">{fmtQty(qty)}</td>
                            <td className="tabular">
                              {p.avg_cost != null ? (
                                <>
                                  <div>${Number(p.avg_cost).toFixed(2)}/sh</div>
                                  {p.cost_basis != null && (
                                    <div className="sub">{fmtUsd(p.cost_basis)} total</div>
                                  )}
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      <tr className={styles.totalRow}>
                        <td>Account total</td>
                        <td />
                        <td className={`tabular ${pctClass(stats.dayChangeAbs)}`}>
                          {fmtUsdSigned(stats.dayChangeAbs)}
                        </td>
                        <td className={`tabular ${pctClass(dayPctAll)}`}>
                          {fmtPct(dayPctAll)}
                        </td>
                        <td
                          className={`tabular ${pctClass(
                            stats.hasUnreal ? stats.totalUnreal : null,
                          )}`}
                        >
                          {stats.hasUnreal ? fmtUsdSigned(stats.totalUnreal) : '—'}
                        </td>
                        <td />
                        <td className="tabular">
                          <strong>{fmtUsd(stats.totVal)}</strong>
                        </td>
                        <td className="tabular">100%</td>
                        <td />
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
