import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPct, fmtPx, pctClass, relativeTime } from '@/lib/format'
import page from './page.module.css'
import styles from './split.module.css'

type Report = {
  ticker?: string
  rating?: string
  price_target?: number
  upside_pct?: number
  current_price?: number
  pct_change?: number
  providers?: string[]
  generated_at?: string
  gamma_url?: string
  has_docx?: boolean
  has_pptx?: boolean
}

export function MemosPage() {
  const [rows, setRows] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const d = await api<Report[] | { reports?: Report[] }>('/api/reports')
        const list = Array.isArray(d) ? d : d.reports || []
        if (alive) setRows(list)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Firm ops</p>
          <h1 className={page.h1}>Memos & reports</h1>
          <p className={page.sub}>Saved multi-engine analyses with targets and upside.</p>
        </div>
      </header>
      {err && <div className={page.bannerErr}>{err}</div>}
      <Panel title="Saved reports" badge={rows.length} flush>
        {loading ? (
          <Spinner />
        ) : !rows.length ? (
          <Empty title="No reports" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Rating</th>
                  <th className="tabular">Price</th>
                  <th className="tabular">Day %</th>
                  <th className="tabular">Target</th>
                  <th className="tabular">Upside</th>
                  <th>Engines</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ticker}-${i}`}>
                    <td className={styles.tk}>{r.ticker}</td>
                    <td>{r.rating || '—'}</td>
                    <td className="tabular">{fmtPx(r.current_price)}</td>
                    <td className={`tabular ${pctClass(r.pct_change)}`}>
                      {fmtPct(r.pct_change)}
                    </td>
                    <td className="tabular">{fmtPx(r.price_target)}</td>
                    <td className={`tabular ${pctClass(r.upside_pct)}`}>
                      {fmtPct(r.upside_pct)}
                    </td>
                    <td className={styles.meta}>
                      {(r.providers || []).join(', ') || '—'}
                    </td>
                    <td className={styles.meta}>{relativeTime(r.generated_at)}</td>
                    <td>
                      {r.gamma_url && (
                        <a href={r.gamma_url} target="_blank" rel="noreferrer">
                          Deck
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
