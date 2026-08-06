import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './FinancialsPage.module.css'
import type { CoverageRow, PeriodType } from './financials/types'
import { CompanyDashboard } from './financials/CompanyDashboard'
import { ValueLineSheet } from './financials/ValueLineSheet'
import { FinancialsStore } from './financials/FinancialsStore'
import { HistoryScreen } from './financials/HistoryScreen'

export function FinancialsPage() {
  const [ticker, setTicker] = useState('')
  const [period, setPeriod] = useState<PeriodType>('annual')
  const [coverage, setCoverage] = useState<CoverageRow[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  const loadCoverage = useCallback(async () => {
    try {
      const d = await api<{ coverage?: CoverageRow[] }>('/api/financials/coverage')
      setCoverage(Array.isArray(d.coverage) ? d.coverage : [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadCoverage()
  }, [loadCoverage])

  const selectTicker = useCallback((tk: string) => {
    const t = tk.trim().toUpperCase()
    if (!t) return
    setTicker(t)
    setReloadKey((k) => k + 1)
  }, [])

  // When dashboard views a name, keep parent ticker in sync without double-fetch
  // (CompanyDashboard already loads; parent only needs id for sheet/history).
  const onViewed = useCallback((tk: string) => {
    const t = tk.trim().toUpperCase()
    if (!t) return
    setTicker(t)
  }, [])

  return (
    <div className={`${page.page} ${styles.shell}`}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research · SEC store</p>
          <h1 className={page.h1}>Financials</h1>
          <p className={page.sub}>
            Full PM desk: company dashboard (DGA Score &amp; Value, ranks, peers,
            TTM), Value Line sheet, SEC store pull/settings, company history, and
            cross-name screen. Data from{' '}
            <strong>Postgres company_financials</strong> (EDGAR XBRL) + free
            quotes — no LLM. Coverage:{' '}
            {coverage.length ? (
              <strong>{coverage.length.toLocaleString()}</strong>
            ) : (
              '—'
            )}{' '}
            tickers.
          </p>
        </div>
      </header>

      <CompanyDashboard
        ticker={ticker}
        setTicker={setTicker}
        period={period}
        setPeriod={setPeriod}
        coverage={coverage}
        onViewed={onViewed}
        reloadKey={reloadKey}
      />

      <ValueLineSheet ticker={ticker} onSelectTicker={selectTicker} />

      <FinancialsStore
        coverage={coverage}
        onCoverageChange={() => void loadCoverage()}
        onSelectTicker={selectTicker}
      />

      <HistoryScreen ticker={ticker} onSelectTicker={selectTicker} />
    </div>
  )
}
