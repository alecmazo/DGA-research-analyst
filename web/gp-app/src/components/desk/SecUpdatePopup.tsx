import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import styles from './SecUpdatePopup.module.css'

type Updated = {
  ticker?: string
  form?: string
  filed?: string
  latest_period_end?: string
  fp?: string
  status?: string
  company?: string
  filing_url?: string
  rows_written?: number
}

type Notice = {
  id?: string
  kind?: string
  status?: string
  title?: string
  body?: string
  updated?: Updated[]
  updated_tickers?: string[]
  updated_count?: number
  scanned?: number
  done?: number
  total?: number
  window?: string
  cost?: { label?: string; note?: string }
  ts?: string
}

const LS_KEY = 'dga.fin.notice.dismissed'

export type SecFilingPick = {
  ticker: string
  form?: string
  filed?: string
  url?: string
}

export function SecUpdatePopup({
  onOpenTicker,
}: {
  onOpenTicker?: (tk: string, filing?: SecFilingPick) => void
}) {
  const [notice, setNotice] = useState<Notice | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<{ notice?: Notice | null }>('/api/financials/desk-notice')
      const n = d?.notice || null
      if (!n?.id) {
        setNotice(null)
        return
      }
      try {
        if (localStorage.getItem(LS_KEY) === n.id) {
          setNotice(null)
          return
        }
      } catch {
        /* ignore */
      }
      setNotice(n)
    } catch {
      /* desk still paints */
    }
  }, [])

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 1500)
    const t = window.setInterval(() => void load(), 120000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(t)
    }
  }, [load])

  if (!notice) return null

  const rows = (notice.updated || []).filter((u) => u && u.ticker)
  const status = (notice.status || '').toLowerCase()

  const dismiss = async () => {
    const id = notice.id || ''
    try {
      localStorage.setItem(LS_KEY, id)
    } catch {
      /* ignore */
    }
    setNotice(null)
    try {
      await api('/api/financials/desk-notice/dismiss', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="sec-upd-title">
      <div className={styles.card}>
        <div className={styles.kicker}>
          SEC financials · {notice.window || '11:00pm–6:00am PT'} · {notice.cost?.label || '$0 SEC'}
        </div>
        <h2 id="sec-upd-title" className={styles.title}>
          {notice.title || 'SEC update'}
        </h2>
        <p className={styles.body}>{notice.body}</p>
        {typeof notice.done === 'number' && typeof notice.total === 'number' && notice.total > 0 && (
          <div className={styles.progress}>
            {notice.done}/{notice.total}
            {status === 'paused' ? ' · paused until tonight' : ''}
            {status === 'scheduled' ? ' · queued' : ''}
          </div>
        )}
        {rows.length > 0 && (
          <div className={styles.chips}>
            {rows.slice(0, 40).map((u, i) => {
              const filed = String(u.filed || '').slice(0, 10)
              const form = u.form || u.fp || '10-K/10-Q'
              return (
              <button
                key={`${u.ticker}-${i}`}
                type="button"
                className={styles.chip}
                title={u.company || u.ticker}
                onClick={() =>
                  u.ticker &&
                  onOpenTicker?.(u.ticker, {
                    ticker: u.ticker,
                    form,
                    filed,
                    url: u.filing_url,
                  })
                }
              >
                {u.ticker}
                <span>
                  {' '}
                  · {form}
                  {filed ? ` filed ${filed}` : ''}
                </span>
              </button>
              )
            })}
          </div>
        )}
        <div className={styles.actions}>
          <Button size="sm" variant="primary" onClick={() => void dismiss()}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  )
}
