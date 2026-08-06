import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { api, type Quote, type ReportDetail } from '@/lib/api'
import { fmtPct, fmtPx, pctClass, relativeTime } from '@/lib/format'
import { renderMd, reportMarkdown } from '@/lib/md'
import styles from './deskWidgets.module.css'

type Props = {
  ticker: string
  provider?: string
  onClose: () => void
}

export function ReportModal({ ticker, provider = 'grok', onClose }: Props) {
  const [data, setData] = useState<ReportDetail | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
        if (!alive) return
        setErr(e instanceof Error ? e.message : 'Failed to load report')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [ticker, provider])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const md = reportMarkdown(data)
  const html = useMemo(() => (md ? renderMd(md) : ''), [md])
  const pct = quote?.pct ?? quote?.pct_change ?? null
  const shownProvider = (data?.provider || provider).toLowerCase()

  return (
    <div
      className={styles.modalOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div className={styles.modal} role="dialog" aria-label={`${ticker} report`}>
        <header className={styles.modalHead}>
          <div className={styles.modalTitle}>
            <strong>{ticker}</strong>
            <span className={styles.provBadge} data-p={shownProvider}>
              {shownProvider.toUpperCase()}
            </span>
            {(data?.generated_at || data?.report_date) && (
              <span className={styles.metaDim}>
                {relativeTime(data.generated_at || data.report_date)}
              </span>
            )}
          </div>
          <div className={styles.modalActions}>
            {data?.gamma_url && (
              <a
                href={data.gamma_url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.linkBtn}
              >
                GAMMA
              </a>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              ✕
            </Button>
          </div>
        </header>

        <div className={styles.modalMetrics}>
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
                ? `$${Number(data.price_target) >= 100
                    ? Number(data.price_target).toFixed(0)
                    : Number(data.price_target).toFixed(2)}`
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

        <div className={styles.modalBody}>
          {loading && <div className={styles.ideaEmpty}>Loading report…</div>}
          {err && <div className={styles.bannerErr}>{err}</div>}
          {!loading && !err && html && (
            <article
              className={styles.reportMd}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {!loading && !err && !html && (
            <div className={styles.ideaEmpty}>
              Report loaded but has no text content.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
