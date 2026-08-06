import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import type { HistoryRow, PeriodType, ScreenRow } from './types'
import { FIN_COLS, SCREEN_ORDERS } from './types'
import { finColFmt } from './format'
import { SparkCard } from './Sparkline'
import styles from '../FinancialsPage.module.css'

type Props = {
  ticker: string
  onSelectTicker: (tk: string) => void
}

export function HistoryScreen({ ticker, onSelectTicker }: Props) {
  const [histTk, setHistTk] = useState(ticker || '')
  const [histPeriod, setHistPeriod] = useState<PeriodType>('quarter')
  const [histRows, setHistRows] = useState<HistoryRow[]>([])
  const [histEntity, setHistEntity] = useState('')
  const [histMsg, setHistMsg] = useState('Pick a ticker to see its financial history.')
  const [histBusy, setHistBusy] = useState(false)

  const [scrPeriod, setScrPeriod] = useState<PeriodType>('quarter')
  const [scrOrder, setScrOrder] = useState<string>('revenue')
  const [scrRows, setScrRows] = useState<ScreenRow[]>([])
  const [scrMsg, setScrMsg] = useState('Run a screen across your covered names.')
  const [scrBusy, setScrBusy] = useState(false)

  // Prefill history box when dashboard ticker changes (user still hits View)
  useEffect(() => {
    if (ticker) setHistTk(ticker)
  }, [ticker])

  const viewHistory = async (tkOverride?: string) => {
    const tk = (tkOverride || histTk).trim().toUpperCase()
    if (!tk) {
      setHistMsg('Enter a ticker.')
      return
    }
    setHistTk(tk)
    setHistBusy(true)
    setHistMsg(`Loading ${tk}…`)
    try {
      const d = await api<{
        ok?: boolean
        error?: string
        rows?: HistoryRow[]
        entity_name?: string
      }>(
        `/api/financials/${encodeURIComponent(tk)}?period_type=${encodeURIComponent(histPeriod)}`,
      )
      if (d && d.ok === false) throw new Error(d.error || 'Failed')
      const rows = d.rows || []
      if (!rows.length) {
        setHistRows([])
        setHistMsg(
          `No ${histPeriod} data for ${tk}. Use “Pull SEC data” (or Custom ticker) first.`,
        )
        return
      }
      setHistEntity(d.entity_name || tk)
      setHistRows(rows)
      setHistMsg('')
    } catch (e) {
      setHistRows([])
      setHistMsg(`Failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setHistBusy(false)
    }
  }

  const runScreen = async () => {
    setScrBusy(true)
    setScrMsg('Running…')
    try {
      const d = await api<{ ok?: boolean; error?: string; rows?: ScreenRow[] }>(
        `/api/financials/screen?period_type=${encodeURIComponent(scrPeriod)}&order=${encodeURIComponent(scrOrder)}&desc=true`,
      )
      if (d && d.ok === false) throw new Error(d.error || 'Failed')
      const rows = d.rows || []
      if (!rows.length) {
        setScrRows([])
        setScrMsg('Nothing stored yet — use “Pull SEC data” first.')
        return
      }
      setScrRows(rows)
      setScrMsg('')
    } catch (e) {
      setScrRows([])
      setScrMsg(`Failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setScrBusy(false)
    }
  }

  const chrono = [...histRows].reverse()
  const series = (k: string) =>
    chrono.map((r) => {
      const v = r[k]
      return v == null || v === undefined ? null : Number(v)
    })

  return (
    <div className={styles.split}>
      <Panel title="📈 Company history">
        <div className={styles.storeRow}>
          <input
            className={styles.search}
            style={{ width: 130 }}
            value={histTk}
            onChange={(e) => setHistTk(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && void viewHistory()}
            placeholder="Ticker (e.g. INTC)"
            maxLength={8}
          />
          <select
            className={styles.select}
            value={histPeriod}
            onChange={(e) => setHistPeriod(e.target.value as PeriodType)}
          >
            <option value="quarter">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
          <Button
            variant="secondary"
            size="sm"
            disabled={histBusy}
            onClick={() => void viewHistory()}
          >
            View ▶
          </Button>
          {ticker && ticker !== histTk && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setHistTk(ticker)
                void viewHistory(ticker)
              }}
            >
              Use {ticker}
            </Button>
          )}
        </div>
        {histMsg && <div className={styles.mutedSm}>{histMsg}</div>}
        {histRows.length > 0 && (
          <>
            <div className={styles.mutedSm}>
              {histEntity} · {histRows.length} periods · $ in millions · *=derived
              Q4
            </div>
            <div className={styles.sparkRow}>
              <SparkCard label="Revenue" vals={series('revenue')} fmt={(v) => finColFmt('m', v)} />
              <SparkCard
                label="Net margin"
                vals={series('net_margin')}
                fmt={(v) => finColFmt('pct', v)}
              />
              <SparkCard
                label="Net income"
                vals={series('net_income')}
                fmt={(v) => finColFmt('m', v)}
              />
              <SparkCard
                label="Free cash flow"
                vals={series('free_cash_flow')}
                fmt={(v) => finColFmt('m', v)}
              />
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.tableDense}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>{histTk}</th>
                    {FIN_COLS.map((c) => (
                      <th key={c.k} className="tabular">
                        {c.l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {histRows.map((r, i) => {
                    const lbl = `${r.fy}${r.fp === 'FY' ? ' FY' : ` ${r.fp}`}${r.derived ? '*' : ''}`
                    return (
                      <tr key={i}>
                        <td
                          className={styles.tkSm}
                          title={`period end ${r.period_end || ''}`}
                        >
                          {lbl}
                        </td>
                        {FIN_COLS.map((c) => (
                          <td key={c.k} className="tabular">
                            {finColFmt(
                              c.kind,
                              r[c.k] as number | null | undefined,
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel title="🔎 Screen">
        <div className={styles.storeRow}>
          <select
            className={styles.select}
            value={scrPeriod}
            onChange={(e) => setScrPeriod(e.target.value as PeriodType)}
          >
            <option value="quarter">Latest quarter</option>
            <option value="annual">Latest FY</option>
          </select>
          <span className={styles.mutedSm}>sort by</span>
          <select
            className={styles.select}
            value={scrOrder}
            onChange={(e) => setScrOrder(e.target.value)}
          >
            {SCREEN_ORDERS.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            disabled={scrBusy}
            onClick={() => void runScreen()}
          >
            Run ▶
          </Button>
        </div>
        {scrMsg && <div className={styles.mutedSm}>{scrMsg}</div>}
        {scrRows.length > 0 && (
          <>
            <div className={styles.mutedSm}>
              {scrRows.length} names ·{' '}
              {scrPeriod === 'quarter' ? 'latest quarter' : 'latest FY'} · $ in
              millions
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.tableDense}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Name</th>
                    <th style={{ textAlign: 'left' }}>Period</th>
                    {FIN_COLS.map((c) => (
                      <th
                        key={c.k}
                        className="tabular"
                        style={
                          c.k === scrOrder
                            ? { color: 'var(--brand-600, #3E9AB8)' }
                            : undefined
                        }
                      >
                        {c.l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scrRows.map((r, i) => {
                    const lbl = `${r.fy}${r.fp === 'FY' ? ' FY' : ` ${r.fp}`}${r.derived ? '*' : ''}`
                    return (
                      <tr
                        key={`${r.ticker}-${i}`}
                        onClick={() => r.ticker && onSelectTicker(r.ticker)}
                        style={{ cursor: r.ticker ? 'pointer' : undefined }}
                      >
                        <td className={styles.tkSm}>{r.ticker}</td>
                        <td className={styles.mutedSm}>{lbl}</td>
                        {FIN_COLS.map((c) => (
                          <td
                            key={c.k}
                            className="tabular"
                            style={
                              c.k === scrOrder
                                ? {
                                    color: 'var(--brand-600, #3E9AB8)',
                                    fontWeight: 600,
                                  }
                                : undefined
                            }
                          >
                            {finColFmt(
                              c.kind,
                              r[c.k] as number | null | undefined,
                            )}
                          </td>
                        ))}
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
  )
}
