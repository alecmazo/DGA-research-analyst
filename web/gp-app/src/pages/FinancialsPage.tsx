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

  return (
    <div className={`${page.page} ${styles.shell}`}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research</p>
          <h1 className={page.h1}>Financials</h1>
          <p className={page.sub}>
            PM desk for any covered name: TTM multiples, peer comps, margin/ROIC
            trends, DGA Score &amp; Value. Numbers from{' '}
            <strong>SEC EDGAR XBRL</strong> + free market quotes — no LLM tokens.
            Store coverage{' '}
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
        onViewed={(tk) => setTicker(tk)}
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
