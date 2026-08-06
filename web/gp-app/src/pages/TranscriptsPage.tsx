import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './list.module.css'

type Coverage = {
  ok?: boolean
  freshness_summary?: Record<string, number>
  source_summary?: Record<string, number>
  needs_topup_count?: number
  universe?: number
  note?: string
  coverage?: { ticker?: string; status?: string; age_days?: number }[]
}

export function TranscriptsPage() {
  const [data, setData] = useState<Coverage | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const d = await api<Coverage>('/api/transcripts/calls/coverage')
        if (alive) setData(d)
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

  const fresh = data?.freshness_summary || {}

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research</p>
          <h1 className={page.h1}>Transcripts</h1>
          <p className={page.sub}>Earnings-call index coverage and freshness across the universe.</p>
        </div>
      </header>
      {err && <div className={page.bannerErr}>{err}</div>}
      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className={styles.kpiRow}>
            {Object.entries(fresh).map(([k, v]) => (
              <div key={k} className={styles.kpi}>
                <div className={styles.kpiLabel}>{k}</div>
                <div className={styles.kpiVal}>{v}</div>
              </div>
            ))}
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Needs top-up</div>
              <div className={styles.kpiVal}>{data?.needs_topup_count ?? '—'}</div>
            </div>
          </div>
          <Panel title="Call index" badge={data?.universe ?? '—'}>
            {data?.note && <p className={styles.note}>{data.note}</p>}
            {Array.isArray(data?.coverage) && data!.coverage!.length > 0 ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Status</th>
                      <th className="tabular">Age (d)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.coverage!.slice(0, 80).map((c, i) => (
                      <tr key={`${c.ticker}-${i}`}>
                        <td className={styles.tk}>{c.ticker}</td>
                        <td>{c.status || '—'}</td>
                        <td className="tabular">{c.age_days ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Coverage map loaded" sub="Open legacy for sync / backfill controls if needed." />
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
