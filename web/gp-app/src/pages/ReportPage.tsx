import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SupportFab } from '@/components/support/SupportFab'
import { api, type Quote, type ReportDetail } from '@/lib/api'
import { fmtPct, fmtPx, pctClass, relativeTime } from '@/lib/format'
import styles from './ReportPage.module.css'

export function ReportPage() {
  const [params] = useSearchParams()
  const ticker = (params.get('ticker') || '').toUpperCase()
  const provider = (params.get('provider') || 'grok').toLowerCase()

  const [data, setData] = useState<ReportDetail | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = ticker
      ? `${ticker} · ${provider.toUpperCase()} report · DGA`
      : 'Report · DGA'
  }, [ticker, provider])

  useEffect(() => {
    if (!ticker) {
      setErr('Missing ticker')
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const [r, q] = await Promise.all([
          api<ReportDetail>(
            `/api/report/${encodeURIComponent(ticker)}?provider=${encodeURIComponent(provider)}`,
          ),
          api<Quote>(`/api/quote/${encodeURIComponent(ticker)}`).catch(() => null),
        ])
        if (!alive) return
        setData(r)
        setQuote(q)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to load report')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [ticker, provider])

  const md = data?.markdown || data?.content || ''
  const pct = quote?.pct ?? quote?.pct_change ?? null

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.title}>
          <strong>{ticker || '—'}</strong>
          <span className={styles.prov} data-p={provider}>
            {provider.toUpperCase()}
          </span>
          {(data?.generated_at || data?.report_date) && (
            <span className={styles.meta}>
              {relativeTime(data.generated_at || data.report_date)}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          {data?.gamma_url && (
            <a
              href={data.gamma_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.gamma}
            >
              GAMMA
            </a>
          )}
          <button type="button" className={styles.close} onClick={() => window.close()}>
            Close
          </button>
        </div>
      </header>

      <div className={styles.metrics}>
        <div>
          <span>Price</span>
          <strong>{fmtPx(quote?.price)}</strong>
        </div>
        <div>
          <span>Day</span>
          <strong className={pctClass(pct)}>{fmtPct(pct)}</strong>
        </div>
        <div>
          <span>Rating</span>
          <strong>{data?.rating || '—'}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>
            {data?.price_target != null
              ? `$${
                  Number(data.price_target) >= 100
                    ? Number(data.price_target).toFixed(0)
                    : Number(data.price_target).toFixed(2)
                }`
              : '—'}
          </strong>
        </div>
        <div>
          <span>Upside</span>
          <strong className={pctClass(data?.upside_pct)}>
            {fmtPct(data?.upside_pct)}
          </strong>
        </div>
      </div>

      <div className={styles.body}>
        {loading && <div className={styles.empty}>Loading report…</div>}
        {err && <div className={styles.err}>{err}</div>}
        {!loading && !err && md && <pre className={styles.md}>{md}</pre>}
        {!loading && !err && !md && (
          <div className={styles.empty}>No markdown content for this report.</div>
        )}
      </div>
      <SupportFab />
    </div>
  )
}

/** Open saved report in a real browser window (legacy behavior). */
export function openReportWindow(ticker: string, provider = 'grok') {
  const tk = ticker.trim().toUpperCase()
  if (!tk) return
  const pv = (provider || 'grok').toLowerCase()
  const url = `/gp/report?ticker=${encodeURIComponent(tk)}&provider=${encodeURIComponent(pv)}`
  const name = `dga-report-${tk}-${pv}`
  window.open(
    url,
    name,
    'noopener,noreferrer,width=1040,height=900,menubar=no,toolbar=no,location=no,status=no',
  )
}
