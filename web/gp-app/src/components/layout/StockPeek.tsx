import { useEffect, useState, type ReactNode } from 'react'
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
    ytd_status?: string | null
    ytd_label?: string | null
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

function compact(v: number | null | undefined): string | null {
  if (v == null || Number.isNaN(Number(v))) return null
  const n = Number(v)
  const abs = Math.abs(n)
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function signedPct(v: number | null | undefined): string | null {
  if (v == null || Number.isNaN(Number(v))) return null
  return fmtPct(v)
}

function marginPct(v: number | null | undefined): string | null {
  if (v == null || Number.isNaN(Number(v))) return null
  const n = Number(v)
  const pct = Math.abs(n) <= 1.5 ? n * 100 : n
  return `${pct.toFixed(1)}%`
}

function toneClass(v: number | null | undefined): string {
  const c = pctClass(v)
  if (c === 'pos') return styles.up
  if (c === 'neg') return styles.dn
  return ''
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string | null
  tone?: number | null
}) {
  if (!value) return null
  return (
    <div className={styles.row}>
      <span className={styles.rowLbl}>{label}</span>
      <span className={`${styles.rowVal} ${tone != null ? toneClass(tone) : ''}`}>
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children]
  if (!items.some(Boolean)) return null
  return (
    <section className={styles.section}>
      <h4 className={styles.secTitle}>{title}</h4>
      <div className={styles.rows}>{children}</div>
    </section>
  )
}

function RangeBar({
  low,
  high,
  last,
}: {
  low?: number | null
  high?: number | null
  last?: number | null
}) {
  if (low == null || high == null || high <= low) return null
  const px = last != null && last > 0 ? last : (low + high) / 2
  const pos = Math.max(0, Math.min(1, (px - low) / (high - low)))
  return (
    <div className={styles.range}>
      <div className={styles.rangeMeta}>
        <span>{fmtPx(low)}</span>
        <span className={styles.rangeCap}>52-week range</span>
        <span>{fmtPx(high)}</span>
      </div>
      <div className={styles.rangeTrack} aria-hidden>
        <div className={styles.rangeFill} style={{ width: `${pos * 100}%` }} />
        <div className={styles.rangeDot} style={{ left: `${pos * 100}%` }} />
      </div>
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
  alreadyOnWatchlist?: boolean
  /** Let the page under the dim receive hover/click (Builder boards). */
  passThrough?: boolean
}

export function StockPeek({
  ticker,
  onClose,
  alreadyOnWatchlist = false,
  passThrough = false,
}: Props) {
  const navigate = useNavigate()
  const tk = ticker.trim().toUpperCase()
  const [data, setData] = useState<StockInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [wlBusy, setWlBusy] = useState(false)
  const [wlDone, setWlDone] = useState(alreadyOnWatchlist)

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
  const sector = [m.sector, m.industry].filter(Boolean).join(' · ')
  const sr = data?.saved_report
  const pct = q.pct_change
  const fy = fin.fy ? `FY${String(fin.fy).slice(-2)}` : 'Operations'

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
    window.setTimeout(() => focusAnalyzeTicker(tk, false), 50)
  }

  const openFinancials = () => {
    onClose()
    navigate(`/financials?ticker=${encodeURIComponent(tk)}`)
  }

  return (
    <div
      className={`${styles.overlay} ${passThrough ? styles.overlayPass : ''}`}
      role="dialog"
      aria-modal={!passThrough}
      aria-label={`${tk} snapshot`}
      onClick={(e) => {
        if (!passThrough && e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.dialog}>
        <header className={styles.hero}>
          <div className={styles.heroLeft}>
            <div className={styles.tk}>{tk}</div>
            {name && name !== tk && <div className={styles.name}>{name}</div>}
            {sector && <div className={styles.sector}>{sector}</div>}
          </div>
          <div className={styles.heroRight}>
            {q.price != null && (
              <div className={styles.quote}>
                <span className={styles.px}>{fmtPx(q.price)}</span>
                {pct != null && (
                  <span className={`${styles.chg} ${toneClass(pct)}`}>{fmtPct(pct)}</span>
                )}
              </div>
            )}
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <div className={styles.body}>
          {loading && <div className={styles.loading}>Loading snapshot…</div>}
          {err && !loading && <div className={styles.error}>Could not load {tk}: {err}</div>}
          {!loading && !err && data && (
            <>
              <RangeBar low={w.low} high={w.high} last={q.price} />
              {w.off_high_pct != null && (
                <p className={styles.rangeNote}>
                  <span className={toneClass(w.off_high_pct)}>{fmtPct(w.off_high_pct)}</span>
                  {' '}from 52-week high
                </p>
              )}

              <Section title="Market">
                <Row
                  label={
                    w.ytd_status === 'ipo' || w.ytd_label === 'IPO'
                      ? 'Year to date · IPO'
                      : 'Year to date'
                  }
                  value={signedPct(w.ytd_pct)}
                  tone={w.ytd_pct}
                />
                <Row label="One year" value={signedPct(w.one_year_pct)} tone={w.one_year_pct} />
                <Row
                  label="Realized vol"
                  value={q.realized_vol != null ? `${Number(q.realized_vol).toFixed(1)}%` : null}
                />
                <Row label="Market cap" value={compact(dv.market_cap)} />
                <Row label="P/E" value={dv.pe != null ? Number(dv.pe).toFixed(1) : null} />
              </Section>

              <Section title="Capital">
                <Row
                  label="FCF yield"
                  value={
                    dv.fcf_yield_pct != null ? `${Number(dv.fcf_yield_pct).toFixed(2)}%` : null
                  }
                />
                <Row label="Net cash" value={compact(dv.net_cash)} />
                <Row
                  label="Debt / equity"
                  value={dv.debt_to_equity != null ? Number(dv.debt_to_equity).toFixed(2) : null}
                />
              </Section>

              <Section title={fy}>
                <Row label="Revenue" value={compact(fin.revenue)} />
                <Row label="Net income" value={compact(fin.net_income)} />
                <Row label="EBITDA" value={compact(fin.ebitda)} />
                <Row label="Gross margin" value={marginPct(fin.gross_margin)} />
                <Row label="Operating margin" value={marginPct(fin.operating_margin)} />
                <Row label="Net margin" value={marginPct(fin.net_margin)} />
                <Row
                  label="Diluted EPS"
                  value={fin.diluted_eps != null ? `$${Number(fin.diluted_eps).toFixed(2)}` : null}
                />
                <Row label="Free cash flow" value={compact(fin.free_cash_flow)} />
              </Section>

              {!data.quote?.price && !m.name && (
                <p className={styles.muted}>
                  No stored data for {tk} yet — the market-data store syncs on demand.
                </p>
              )}
            </>
          )}
        </div>

        <footer className={styles.foot}>
          <span className={styles.footHint}>
            <a
              href={`https://www.gurufocus.com/stock/${encodeURIComponent(tk)}/summary`}
              target="_blank"
              rel="noopener noreferrer"
            >
              GuruFocus
            </a>
          </span>
          {!alreadyOnWatchlist && (
            <Button size="sm" disabled={wlBusy || wlDone} onClick={() => void addWatchlist()}>
              {wlDone ? 'On watchlist' : wlBusy ? '…' : 'Add to watchlist'}
            </Button>
          )}
          {sr?.exists && (
            <Button
              size="sm"
              onClick={() => {
                openReportWindow(tk, 'grok')
              }}
            >
              Open report{sr.rating ? ` · ${sr.rating}` : ''}
            </Button>
          )}
          <Button size="sm" onClick={openFinancials}>
            Financials
          </Button>
          <Button size="sm" variant="primary" onClick={runAi}>
            Run analysis
          </Button>
        </footer>
      </div>
    </div>
  )
}
