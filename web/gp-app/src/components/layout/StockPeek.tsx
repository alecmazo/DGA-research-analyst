import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import { openReportWindow } from '@/pages/ReportPage'
import styles from './StockPeek.module.css'

export type StockInfo = {
  ticker?: string
  free?: boolean
  quote?: {
    price?: number | null
    pct_change?: number | null
    prev_close?: number | null
    realized_vol?: number | null
    as_of?: string | null
    live?: boolean
  }
  meta?: {
    name?: string
    sector?: string
    industry?: string
  }
  range52w?: {
    high?: number | null
    low?: number | null
    off_high_pct?: number | null
    ytd_pct?: number | null
    one_year_pct?: number | null
  }
  derived?: {
    market_cap?: number | null
    pe?: number | null
    fcf_yield_pct?: number | null
    net_cash?: number | null
    debt_to_equity?: number | null
  }
  financials?: {
    entity_name?: string
    fy?: number | string
    revenue?: number | null
    net_income?: number | null
    ebitda?: number | null
    gross_margin?: number | null
    operating_margin?: number | null
    net_margin?: number | null
    diluted_eps?: number | null
    free_cash_flow?: number | null
  }
  saved_report?: {
    exists?: boolean
    rating?: string | null
    price_target?: number | null
    generated_at?: string | null
  }
}

function compact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const abs = Math.abs(n)
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function signedPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return fmtPct(v)
}

function Stat({ label, value }: { label: string; value: string | null }) {
  if (!value || value === '—') return null
  return (
    <div className={styles.stat}>
      <div className={styles.statLbl}>{label}</div>
      <div className={styles.statVal}>{value}</div>
    </div>
  )
}

/** Dispatch so Desk can prefill Analyze without coupling. */
export function focusAnalyzeTicker(ticker: string, autoRun = false) {
  const tk = ticker.trim().toUpperCase()
  if (!tk) return
  try {
    window.dispatchEvent(
      new CustomEvent('dga-focus-analyze', { detail: { ticker: tk, autoRun } }),
    )
  } catch {
    /* ignore */
  }
}

type Props = {
  ticker: string
  onClose: () => void
}

export function StockPeek({ ticker, onClose }: Props) {
  const navigate = useNavigate()
  const tk = ticker.trim().toUpperCase()
  const [data, setData] = useState<StockInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [wlBusy, setWlBusy] = useState(false)
  const [wlDone, setWlDone] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const d = await api<StockInfo>(`/api/stock-info/${encodeURIComponent(tk)}`)
        if (alive) setData(d)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Could not load snapshot')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [tk])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = data?.quote || {}
  const m = data?.meta || {}
  const w = data?.range52w || {}
  const dv = data?.derived || {}
  const fin = data?.financials || {}
  const name = m.name || fin.entity_name || tk
  const chips = [m.sector, m.industry].filter(Boolean).join(' · ')
  const sr = data?.saved_report
  const pct = q.pct_change
  const fy = fin.fy ? ` FY${String(fin.fy).slice(-2)}` : ''

  const addWatchlist = async () => {
    setWlBusy(true)
    try {
      await api('/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({ ticker: tk }),
      })
      setWlDone(true)
    } catch {
      setWlDone(false)
    } finally {
      setWlBusy(false)
    }
  }

  const runAi = () => {
    onClose()
    navigate('/')
    // Defer so Desk mounts / is active before it listens
    window.setTimeout(() => focusAnalyzeTicker(tk, false), 50)
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`${tk} snapshot`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.head}>
          <span className={styles.tk}>{tk}</span>
          {q.price != null && (
            <span className={styles.price}>
              {fmtPx(q.price)}{' '}
              {pct != null && (
                <span
                  className={
                    pctClass(pct) === 'pos'
                      ? styles.up
                      : pctClass(pct) === 'neg'
                        ? styles.dn
                        : ''
                  }
                >
                  {fmtPct(pct)}
                </span>
              )}
            </span>
          )}
          <div className={styles.headActions}>
            <Button size="sm" disabled={wlBusy || wlDone} onClick={() => void addWatchlist()}>
              {wlDone ? '✓ On watchlist' : wlBusy ? '…' : '+ Watchlist'}
            </Button>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {loading && <div className={styles.loading}>↻ Loading snapshot…</div>}
          {err && !loading && <div className={styles.error}>Could not load {tk}: {err}</div>}
          {!loading && !err && data && (
            <>
              <div className={styles.nameRow}>
                <span className={styles.name}>{name}</span>
                {chips && <span className={styles.chip}>{chips}</span>}
              </div>
              <div className={styles.grid}>
                <Stat label="52w High" value={w.high != null ? fmtPx(w.high) : null} />
                <Stat label="52w Low" value={w.low != null ? fmtPx(w.low) : null} />
                <Stat label="Off High" value={signedPct(w.off_high_pct)} />
                <Stat label="YTD" value={signedPct(w.ytd_pct)} />
                <Stat label="1Y" value={signedPct(w.one_year_pct)} />
                <Stat
                  label="Realized Vol"
                  value={q.realized_vol != null ? `${Number(q.realized_vol).toFixed(1)}%` : null}
                />
                <Stat label="Mkt Cap" value={compact(dv.market_cap)} />
                <Stat label="P/E" value={dv.pe != null ? Number(dv.pe).toFixed(1) : null} />
                <Stat
                  label="FCF Yield"
                  value={
                    dv.fcf_yield_pct != null ? `${Number(dv.fcf_yield_pct).toFixed(2)}%` : null
                  }
                />
                <Stat label="Net Cash" value={compact(dv.net_cash)} />
                <Stat
                  label="Debt/Equity"
                  value={
                    dv.debt_to_equity != null ? Number(dv.debt_to_equity).toFixed(2) : null
                  }
                />
                <Stat label={`Revenue${fy}`} value={compact(fin.revenue)} />
                <Stat label={`Net Income${fy}`} value={compact(fin.net_income)} />
                <Stat label={`EBITDA${fy}`} value={compact(fin.ebitda)} />
                <Stat
                  label="Gross Margin"
                  value={
                    fin.gross_margin != null
                      ? `${(Number(fin.gross_margin) * 100).toFixed(1)}%`
                      : null
                  }
                />
                <Stat
                  label="Op Margin"
                  value={
                    fin.operating_margin != null
                      ? `${(Number(fin.operating_margin) * 100).toFixed(1)}%`
                      : null
                  }
                />
                <Stat
                  label="Net Margin"
                  value={
                    fin.net_margin != null
                      ? `${(Number(fin.net_margin) * 100).toFixed(1)}%`
                      : null
                  }
                />
                <Stat
                  label="Diluted EPS"
                  value={
                    fin.diluted_eps != null ? `$${Number(fin.diluted_eps).toFixed(2)}` : null
                  }
                />
                <Stat label={`FCF${fy}`} value={compact(fin.free_cash_flow)} />
              </div>
              {!data.quote?.price && !m.name && (
                <p className={styles.muted}>
                  No stored data for {tk} yet — market-data store syncs on demand.
                </p>
              )}
            </>
          )}
        </div>

        <div className={styles.foot}>
          <span className={styles.footHint}>
            Yahoo / local store. Run analysis if you want a full report.
          </span>
          {sr?.exists && (
            <Button
              size="sm"
              onClick={() => {
                openReportWindow(tk, 'grok')
              }}
            >
              📄 Open report
              {sr.rating ? ` · ${sr.rating}` : ''}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={runAi}>
            ⚡ Run AI analysis
          </Button>
        </div>
      </div>
    </div>
  )
}
