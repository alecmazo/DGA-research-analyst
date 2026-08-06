import { useMemo, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPx, fmtUsd } from '@/lib/format'
import page from './page.module.css'
import styles from './OptionsPage.module.css'

type Strike = {
  strike?: number
  premium?: number
  expiration?: string
  dte?: number
  assignment_prob?: number
  static_return_annualized?: number
  yield_on_cash_annualized?: number
}

type WheelRow = {
  ok?: boolean
  ticker?: string
  held?: boolean
  shares_held?: number
  fully_covered?: boolean
  spot?: number
  iv_hv_ratio?: number
  covered_calls?: { weekly?: Strike; monthly?: Strike; quarterly?: Strike }
  cash_secured_puts?: { weekly?: Strike; monthly?: Strike; quarterly?: Strike }
}

function sortHeldFirst(rows: WheelRow[], side: 'cc' | 'csp') {
  return [...rows].sort((a, b) => {
    const ga = a.held ? (a.fully_covered && side === 'cc' ? 1 : 0) : 2
    const gb = b.held ? (b.fully_covered && side === 'cc' ? 1 : 0) : 2
    if (ga !== gb) return ga - gb
    return (b.shares_held || 0) - (a.shares_held || 0)
  })
}

function StrikeCell({
  s,
  side,
  shares,
}: {
  s?: Strike
  side: 'cc' | 'csp'
  shares?: number
}) {
  if (!s) return <td className={styles.empty}>—</td>
  const yld =
    side === 'cc' ? s.static_return_annualized : s.yield_on_cash_annualized
  const yldPct = yld != null ? `${(yld * 100).toFixed(0)}%` : '—'
  const ct = shares && shares >= 100 ? Math.floor(shares / 100) : 0
  const income =
    side === 'cc' && ct > 0 && s.premium != null ? ct * s.premium * 100 : null
  return (
    <td className={styles.cell}>
      <div className={styles.cellMain}>
        ${s.strike} · {s.expiration?.slice(5) || `${s.dte}d`}
      </div>
      <div className={styles.cellSub}>
        ${s.premium} · {yldPct} ann · Δ{s.assignment_prob}
      </div>
      {income != null && (
        <div className={styles.income}>
          You can write: {fmtUsd(income)} · {ct} ct
        </div>
      )}
    </td>
  )
}

export function OptionsPage() {
  const [delta, setDelta] = useState(0.3)
  const [status, setStatus] = useState('Idle — scan portfolio for wheel setups')
  const [busy, setBusy] = useState(false)
  const [cc, setCc] = useState<WheelRow[]>([])
  const [csp, setCsp] = useState<WheelRow[]>([])
  const [totals, setTotals] = useState({ w: 0, m: 0, q: 0 })

  const scan = async () => {
    setBusy(true)
    setStatus('Queuing scan…')
    setCc([])
    setCsp([])
    try {
      const j = await api<{ job_id?: string; universe?: string[] }>(
        '/api/options/scan',
        { method: 'POST', body: JSON.stringify({ delta_max: delta }) },
      )
      if (!j.job_id) throw new Error('No job id')
      setStatus(`Scanning ${j.universe?.length ?? '…'} names…`)
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const st = await api<{
          status?: string
          label?: string
          error?: string
          result?: {
            covered_calls?: WheelRow[]
            cash_secured_puts?: WheelRow[]
          }
        }>(`/api/options/scan/${j.job_id}`)
        if (st.label) setStatus(st.label)
        if (st.status === 'done') {
          const ccr = sortHeldFirst(st.result?.covered_calls || [], 'cc')
          const cspr = sortHeldFirst(st.result?.cash_secured_puts || [], 'csp')
          setCc(ccr)
          setCsp(cspr)
          const tot = { w: 0, m: 0, q: 0 }
          for (const r of ccr) {
            if (!r.held || !r.shares_held || r.shares_held < 100) continue
            const ct = Math.floor(r.shares_held / 100)
            const buckets = r.covered_calls || {}
            if (buckets.weekly?.premium) tot.w += ct * buckets.weekly.premium * 100
            if (buckets.monthly?.premium) tot.m += ct * buckets.monthly.premium * 100
            if (buckets.quarterly?.premium) tot.q += ct * buckets.quarterly.premium * 100
          }
          setTotals(tot)
          setStatus(st.label || 'Scan complete')
          break
        }
        if (st.status === 'error') throw new Error(st.error || st.label || 'Scan failed')
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setBusy(false)
    }
  }

  const heldCc = useMemo(() => cc.filter((r) => r.held).length, [cc])

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Income · wheel strategy</p>
          <h1 className={page.h1}>Options Wheel</h1>
          <p className={page.sub}>
            Covered calls on holdings · CSPs across watchlist. Held names first; premium sized to
            shares you own.
          </p>
        </div>
        <div className={page.heroActions}>
          <label className={styles.delta}>
            Max Δ
            <input
              type="number"
              min={0.05}
              max={0.95}
              step={0.05}
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value) || 0.3)}
            />
          </label>
          <Button variant="primary" onClick={() => void scan()} disabled={busy}>
            {busy ? 'Scanning…' : 'Scan portfolio'}
          </Button>
        </div>
      </header>

      <div className={styles.kpiRow}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Held CC · weekly</div>
          <div className={`${styles.kpiVal} pos`}>{fmtUsd(totals.w)}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Held CC · monthly</div>
          <div className={`${styles.kpiVal} pos`}>{fmtUsd(totals.m)}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Held CC · quarterly</div>
          <div className={`${styles.kpiVal} pos`}>{fmtUsd(totals.q)}</div>
        </div>
      </div>

      <div className={styles.status}>{status}</div>

      <Panel title="Covered calls" badge={heldCc ? `${heldCc} held · ${cc.length}` : cc.length}>
        {!cc.length ? (
          <Empty title="No scan yet" sub="Run Scan portfolio — held names surface first." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="tabular">Spot</th>
                  <th className="tabular">IV/HV</th>
                  <th>Weekly</th>
                  <th>Monthly</th>
                  <th>Quarterly</th>
                </tr>
              </thead>
              <tbody>
                {cc.map((r) => (
                  <tr key={r.ticker} className={r.held ? styles.held : undefined}>
                    <td>
                      <span className={styles.tk}>{r.ticker}</span>
                      {r.held && <span className={styles.badge}>Held</span>}
                      {r.shares_held != null && r.shares_held > 0 && (
                        <span className={styles.shares}>
                          {r.shares_held.toLocaleString()} sh
                          {r.shares_held >= 100
                            ? ` · ${Math.floor(r.shares_held / 100)} ct`
                            : ''}
                        </span>
                      )}
                    </td>
                    <td className="tabular">{fmtPx(r.spot)}</td>
                    <td className="tabular">
                      {r.iv_hv_ratio != null ? r.iv_hv_ratio.toFixed(2) : '—'}
                    </td>
                    <StrikeCell s={r.covered_calls?.weekly} side="cc" shares={r.shares_held} />
                    <StrikeCell s={r.covered_calls?.monthly} side="cc" shares={r.shares_held} />
                    <StrikeCell s={r.covered_calls?.quarterly} side="cc" shares={r.shares_held} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Cash-secured puts" badge={csp.length}>
        {!csp.length ? (
          <Empty title="No CSP rows" sub="After a scan, held names appear first." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="tabular">Spot</th>
                  <th>Weekly</th>
                  <th>Monthly</th>
                  <th>Quarterly</th>
                </tr>
              </thead>
              <tbody>
                {csp.slice(0, 40).map((r) => (
                  <tr key={r.ticker} className={r.held ? styles.held : undefined}>
                    <td>
                      <span className={styles.tk}>{r.ticker}</span>
                      {r.held && <span className={styles.badge}>Held</span>}
                    </td>
                    <td className="tabular">{fmtPx(r.spot)}</td>
                    <StrikeCell s={r.cash_secured_puts?.weekly} side="csp" />
                    <StrikeCell s={r.cash_secured_puts?.monthly} side="csp" />
                    <StrikeCell s={r.cash_secured_puts?.quarterly} side="csp" />
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
