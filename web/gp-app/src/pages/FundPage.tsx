import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPct, fmtUsd, pctClass } from '@/lib/format'
import page from './page.module.css'
import styles from './split.module.css'

type Fund = {
  id: string
  name?: string
  short_name?: string
  status?: string
  nav?: number
  market_nav?: number
  gain_pct?: number
  ytd_pct?: number | null
  lp_count?: number
  position_count?: number
  inception_date?: string
}

type FundDetail = {
  fund_id?: string
  fund_name?: string
  nav?: number
  market_nav?: number
  ytd_pct?: number | null
  lp_count?: number
  lps?: { name?: string; committed?: number; ownership_pct?: number }[]
  nav_as_of?: string
  mgmt_fee_pct?: number
  carry_pct?: number
  hurdle_pct?: number
}

export function FundPage() {
  const [funds, setFunds] = useState<Fund[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [detail, setDetail] = useState<FundDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await api<Fund[]>('/api/fund/list')
        if (!alive) return
        const arr = Array.isArray(list) ? list : []
        setFunds(arr)
        if (arr[0]) setActive(arr[0].id)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to load funds')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!active) {
      setDetail(null)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const d = await api<FundDetail>(`/api/v2/gp/fund/${active}/detail`)
        if (alive) setDetail(d)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Detail failed')
      }
    })()
    return () => {
      alive = false
    }
  }, [active])

  const selected = funds.find((f) => f.id === active)

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Firm ops</p>
          <h1 className={page.h1}>Fund</h1>
          <p className={page.sub}>NAV, LP ownership, and fund settings — live from the fund store.</p>
        </div>
      </header>
      {err && <div className={page.bannerErr}>{err}</div>}
      {loading ? (
        <Spinner />
      ) : (
        <div className={styles.split}>
          <aside className={styles.side}>
            <Panel title="Funds" badge={funds.length} flush>
              {funds.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`${styles.sideItem} ${active === f.id ? styles.sideActive : ''}`}
                  onClick={() => setActive(f.id)}
                >
                  <div className={styles.sideTitle}>{f.short_name || f.name}</div>
                  <div className={styles.sideSub}>{f.name}</div>
                  <div className={`${styles.sideVal} tabular`}>{fmtUsd(f.market_nav ?? f.nav)}</div>
                </button>
              ))}
            </Panel>
          </aside>
          <div className={styles.main}>
            {!selected ? (
              <Empty title="No funds" sub="Create a fund from the legacy terminal if the list is empty." />
            ) : (
              <>
                <div className={styles.kpiRow}>
                  <div className={styles.kpi}>
                    <div className={styles.kpiLabel}>Market NAV</div>
                    <div className={`${styles.kpiVal} tabular`}>
                      {fmtUsd(detail?.market_nav ?? selected.market_nav ?? selected.nav)}
                    </div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kpiLabel}>Gain</div>
                    <div className={`${styles.kpiVal} tabular ${pctClass(selected.gain_pct)}`}>
                      {fmtPct(selected.gain_pct)}
                    </div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kpiLabel}>YTD</div>
                    <div className={`${styles.kpiVal} tabular ${pctClass(detail?.ytd_pct ?? selected.ytd_pct)}`}>
                      {fmtPct(detail?.ytd_pct ?? selected.ytd_pct)}
                    </div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kpiLabel}>LPs</div>
                    <div className={styles.kpiVal}>{detail?.lp_count ?? selected.lp_count ?? '—'}</div>
                  </div>
                </div>
                <Panel title={selected.name || 'Fund detail'} badge={selected.status}>
                  <div className={page.placeholder}>
                    <p>
                      Inception {selected.inception_date || '—'} · Positions{' '}
                      {selected.position_count ?? '—'} · Carry{' '}
                      {detail?.carry_pct != null ? `${(detail.carry_pct * 100).toFixed(0)}%` : '—'} ·
                      Hurdle{' '}
                      {detail?.hurdle_pct != null ? `${(detail.hurdle_pct * 100).toFixed(0)}%` : '—'}
                    </p>
                    {detail?.lps && detail.lps.length > 0 ? (
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>LP</th>
                              <th className="tabular">Committed</th>
                              <th className="tabular">Ownership</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.lps.map((lp, i) => (
                              <tr key={i}>
                                <td>{lp.name || '—'}</td>
                                <td className="tabular">{fmtUsd(lp.committed)}</td>
                                <td className="tabular">
                                  {lp.ownership_pct != null
                                    ? `${Number(lp.ownership_pct).toFixed(2)}%`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className={styles.meta}>No LP rows in detail payload.</p>
                    )}
                  </div>
                </Panel>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
