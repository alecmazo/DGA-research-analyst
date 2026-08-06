import { useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './OptionsPage.module.css'

export function OptionsPage() {
  const [delta, setDelta] = useState(0.3)
  const [status, setStatus] = useState('Idle — scan portfolio for wheel setups')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  const scan = async () => {
    setBusy(true)
    setStatus('Queuing scan…')
    setResult(null)
    try {
      const j = await api<{ ok?: boolean; job_id?: string; universe?: string[] }>(
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
          result?: Record<string, unknown>
        }>(`/api/options/scan/${j.job_id}`)
        if (st.label) setStatus(st.label)
        if (st.status === 'done') {
          setResult(st.result || null)
          setStatus(st.label || 'Scan complete')
          break
        }
        if (st.status === 'error') {
          throw new Error(st.error || st.label || 'Scan failed')
        }
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setBusy(false)
    }
  }

  const cc = (result?.covered_calls as unknown[]) || []
  const csp = (result?.cash_secured_puts as unknown[]) || []

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Income · wheel strategy</p>
          <h1 className={page.h1}>Options Wheel</h1>
          <p className={page.sub}>
            Covered calls on holdings · cash-secured puts across watchlist and reports.
            Held names first; premium sized to shares you own.
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

      <div className={styles.status}>{status}</div>

      <div className={styles.grid}>
        <Panel title="Covered calls" badge={`${cc.length} rows`}>
          <p className={styles.hint}>
            Held shares first · writeable premium from floor(shares/100) contracts.
          </p>
          <pre className={styles.pre}>
            {cc.length
              ? JSON.stringify(
                  cc.slice(0, 12).map((r) => {
                    const row = r as {
                      ticker?: string
                      held?: boolean
                      shares_held?: number
                      spot?: number
                    }
                    return {
                      ticker: row.ticker,
                      held: row.held,
                      shares: row.shares_held,
                      spot: row.spot,
                    }
                  }),
                  null,
                  2,
                )
              : 'Run a scan to populate covered-call candidates.'}
          </pre>
        </Panel>
        <Panel title="Cash-secured puts" badge={`${csp.length} rows`}>
          <p className={styles.hint}>Held names first · then watchlist / reports.</p>
          <pre className={styles.pre}>
            {csp.length
              ? JSON.stringify(
                  csp.slice(0, 12).map((r) => {
                    const row = r as { ticker?: string; held?: boolean; spot?: number }
                    return { ticker: row.ticker, held: row.held, spot: row.spot }
                  }),
                  null,
                  2,
                )
              : 'Run a scan to populate CSP candidates.'}
          </pre>
        </Panel>
      </div>
    </div>
  )
}
