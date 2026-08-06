import { useEffect, useMemo, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPct, fmtPx, fmtUsd, pctClass } from '@/lib/format'
import page from './page.module.css'
import styles from './split.module.css'

type Position = {
  symbol?: string
  name?: string
  quantity?: number
  price?: number
  market_value?: number
  cost_basis?: number
  cost_basis_per_unit?: number
  asset_class?: string
}

type Account = {
  account_id: string
  account_name?: string
  brokerage?: string
  account_mask?: string
  total_value?: number
  positions?: Position[]
  last_synced_at?: string
  hidden?: boolean
}

export function PositionsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const d = await api<{ accounts?: Account[] }>('/api/snaptrade/accounts')
        if (!alive) return
        const list = (d.accounts || []).filter((a) => !a.hidden)
        setAccounts(list)
        if (list[0]) setActive(list[0].account_id)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to load accounts')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const acct = accounts.find((a) => a.account_id === active) || null
  const positions = useMemo(() => {
    const rows = [...(acct?.positions || [])]
    rows.sort((a, b) => (b.market_value || 0) - (a.market_value || 0))
    return rows
  }, [acct])

  const total = accounts.reduce((s, a) => s + (a.total_value || 0), 0)

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Brokerage</p>
          <h1 className={page.h1}>Positions</h1>
          <p className={page.sub}>
            SnapTrade multi-account holdings · {accounts.length} accounts ·{' '}
            <strong className="tabular">{fmtUsd(total)}</strong> combined.
          </p>
        </div>
      </header>
      {err && <div className={page.bannerErr}>{err}</div>}
      {loading ? (
        <Spinner label="Loading SnapTrade accounts…" />
      ) : (
        <div className={styles.split}>
          <aside className={styles.side}>
            <Panel title="Accounts" badge={accounts.length} flush>
              <button
                type="button"
                className={`${styles.sideItem} ${!active ? styles.sideActive : ''}`}
                onClick={() => setActive(null)}
              >
                <div className={styles.sideTitle}>All accounts</div>
                <div className={`${styles.sideVal} tabular`}>{fmtUsd(total)}</div>
              </button>
              {accounts.map((a) => (
                <button
                  key={a.account_id}
                  type="button"
                  className={`${styles.sideItem} ${active === a.account_id ? styles.sideActive : ''}`}
                  onClick={() => setActive(a.account_id)}
                >
                  <div className={styles.sideTitle}>{a.account_name || a.account_id.slice(0, 8)}</div>
                  <div className={styles.sideSub}>
                    {a.brokerage}
                    {a.account_mask ? ` ···${a.account_mask}` : ''}
                  </div>
                  <div className={`${styles.sideVal} tabular`}>{fmtUsd(a.total_value)}</div>
                </button>
              ))}
            </Panel>
          </aside>
          <div className={styles.main}>
            <Panel
              title={acct?.account_name || 'All positions'}
              badge={positions.length || (acct ? 0 : 'mixed')}
              action={
                <span className={styles.meta}>
                  {acct?.last_synced_at
                    ? `Synced ${new Date(acct.last_synced_at).toLocaleString()}`
                    : 'Select an account'}
                </span>
              }
              flush
            >
              {!acct ? (
                <Empty
                  title="Select an account"
                  sub="Choose a brokerage account on the left to view holdings."
                />
              ) : !positions.length ? (
                <Empty title="No positions" sub="This account has no holdings right now." />
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Name</th>
                        <th className="tabular">Qty</th>
                        <th className="tabular">Price</th>
                        <th className="tabular">Mkt value</th>
                        <th className="tabular">Cost</th>
                        <th className="tabular">P&amp;L %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p, i) => {
                        const cost = p.cost_basis || 0
                        const mv = p.market_value || 0
                        const pnl =
                          cost > 0 ? ((mv - cost) / cost) * 100 : null
                        return (
                          <tr key={`${p.symbol}-${i}`}>
                            <td className={styles.tk}>{p.symbol || '—'}</td>
                            <td className={styles.name}>{p.name || '—'}</td>
                            <td className="tabular">{p.quantity?.toLocaleString() ?? '—'}</td>
                            <td className="tabular">{fmtPx(p.price)}</td>
                            <td className="tabular">{fmtUsd(mv)}</td>
                            <td className="tabular">{fmtUsd(cost)}</td>
                            <td className={`tabular ${pctClass(pnl)}`}>{fmtPct(pnl)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
