import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './FinancialsPage.module.css'
import type { CoverageRow, PeriodType } from './financials/types'
import { CompanyDashboard } from './financials/CompanyDashboard'
import { ValueLineSheet } from './financials/ValueLineSheet'
import { FinancialsStore } from './financials/FinancialsStore'
import { HistoryScreen } from './financials/HistoryScreen'

export function FinancialsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlTk = (searchParams.get('ticker') || '').trim().toUpperCase()
  const [ticker, setTicker] = useState(urlTk)
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
    const cur = (searchParams.get('ticker') || '').trim().toUpperCase()
    if (cur !== t) setSearchParams({ ticker: t }, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const t = (searchParams.get('ticker') || '').trim().toUpperCase()
    if (t && t !== ticker) {
      setTicker(t)
      setReloadKey((k) => k + 1)
    }
    // URL is the source when it changes (Builder click, peek Financials).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ ticker?: string }>).detail
      const t = (d?.ticker || '').trim().toUpperCase()
      if (t) selectTicker(t)
    }
    window.addEventListener('dga-open-financials', onOpen)
    return () => window.removeEventListener('dga-open-financials', onOpen)
  }, [selectTicker])

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
            <strong>Postgres company_financials</strong> (EDGAR XBRL) + quotes.
            Coverage:{' '}
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
