import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from './MergerArbPage.module.css'

type SourceRow = {
  name: string
  label?: string
  status?: string
  count?: number
  elapsed_ms?: number
  error?: string
  detail?: string
}

type Run = {
  id?: string
  status?: string
  sources?: SourceRow[]
  error?: string
  counts?: { new_records?: number; candidates?: number }
}

export type ScanAlert = {
  id: string
  desk_deal_id?: string
  alert_type?: string
  certainty?: string
  source_url?: string
  evidence?: string
  pulled_at_pt?: string
}

type Latest = {
  last_scan_pt?: string
  alerts?: ScanAlert[]
  run?: Run | null
}

type Props = {
  onScanned?: () => void
}

export function ScanTools({ onScanned }: Props) {
  const [open, setOpen] = useState<'scan' | 'alerts' | ''>('')
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental')
  const [days, setDays] = useState(120)
  const [run, setRun] = useState<Run | null>(null)
  const [alerts, setAlerts] = useState<ScanAlert[]>([])
  const [lastScan, setLastScan] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const data = await api<Latest>('/api/merger-arb/scan/latest')
    setAlerts(data.alerts || [])
    setLastScan(data.last_scan_pt || '')
    if (data.run?.status === 'running') setRun(data.run)
    else if (data.run) setRun(data.run)
  }, [])

  useEffect(() => {
    load().catch((error) => setErr(error instanceof Error ? error.message : 'Could not load the last scan'))
  }, [load])

  useEffect(() => {
    if (!run?.id || run.status !== 'running') return undefined
    const timer = window.setInterval(() => {
      api<{ run: Run }>(`/api/merger-arb/scan/${encodeURIComponent(run.id || '')}`)
        .then((data) => {
          setRun(data.run)
          if (data.run?.status && data.run.status !== 'running') {
            load().catch(() => undefined)
            onScanned?.()
          }
        })
        .catch((error) => setErr(error instanceof Error ? error.message : 'The scan status failed'))
    }, 1500)
    return () => window.clearInterval(timer)
  }, [run?.id, run?.status, load, onScanned])

  const start = async () => {
    setBusy('scan')
    setErr('')
    try {
      const data = await api<{ run_id: string }>('/api/merger-arb/scan', {
        method: 'POST',
        body: JSON.stringify({ mode, since_days: mode === 'full' ? days : undefined }),
      })
      setRun({ id: data.run_id, status: 'running', sources: [] })
      setOpen('scan')
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not start the scan')
    } finally {
      setBusy('')
    }
  }

  const cancel = async () => {
    if (!run?.id) return
    setBusy('cancel')
    try {
      await api(`/api/merger-arb/scan/${encodeURIComponent(run.id)}/cancel`, { method: 'POST' })
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not cancel')
    } finally {
      setBusy('')
    }
  }

  const ack = async (alert: ScanAlert) => {
    await api(`/api/merger-arb/alerts/${encodeURIComponent(alert.id)}/acknowledge`, { method: 'POST' })
    await load()
  }

  const apply = async (alert: ScanAlert) => {
    setBusy(alert.id)
    try {
      await api(`/api/merger-arb/alerts/${encodeURIComponent(alert.id)}/apply`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      })
      await load()
      onScanned?.()
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'The alert was not applied')
    } finally {
      setBusy('')
    }
  }

  const running = run?.status === 'running'
  const unread = alerts.length

  return (
    <div className={styles.scanTools}>
      <div className={styles.popWrap}>
        <Button size="sm" disabled={!!busy} onClick={() => setOpen(open === 'scan' ? '' : 'scan')}>
          {running ? 'Scanning…' : 'Scan'}
        </Button>
        {open === 'scan' && (
          <div className={styles.popover} role="dialog" aria-label="Scan">
            <label>
              Window
              <select aria-label="Scan window" value={mode} onChange={(event) => setMode(event.target.value as 'incremental' | 'full')}>
                <option value="incremental">Incremental</option>
                <option value="full">Full lookback</option>
              </select>
            </label>
            {mode === 'full' && (
              <label>
                Days
                <input
                  aria-label="Lookback days"
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value) || 120)}
                />
              </label>
            )}
            <div className={styles.toolbar}>
              <Button variant="primary" size="sm" disabled={!!busy || running} onClick={() => void start()}>
                {running ? 'Scanning…' : 'Scan for deals'}
              </Button>
              {running && (
                <Button size="sm" disabled={busy === 'cancel'} onClick={() => void cancel()}>
                  Cancel
                </Button>
              )}
            </div>
            <p className={styles.muted}>Last scan: {lastScan || 'none'}</p>
            {err && <p className={styles.err}>{err}</p>}
            {run?.sources?.length ? (
              <ul className={styles.rows}>
                {run.sources.map((row) => (
                  <li key={row.name}>
                    <strong>{row.label || row.name}</strong>
                    <span className={styles.meta}>
                      {row.status || 'queued'}
                      {row.count ? ` · ${row.count}` : ''}
                      {row.error ? ` · ${row.error}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
      <div className={styles.popWrap}>
        <Button size="sm" onClick={() => setOpen(open === 'alerts' ? '' : 'alerts')}>
          Alerts{unread ? ` ${unread}` : ''}
        </Button>
        {open === 'alerts' && (
          <div className={styles.popover} role="dialog" aria-label="Alerts">
            {!alerts.length && <p className={styles.muted}>No status alerts.</p>}
            <ul className={styles.rows}>
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <div>
                    <strong>{alert.alert_type}</strong>
                    <span className={styles.meta}>
                      {alert.desk_deal_id} · {alert.certainty || 'reported'}
                      {alert.pulled_at_pt ? ` · ${alert.pulled_at_pt}` : ''}
                    </span>
                    {alert.evidence && <span className={styles.meta}>{alert.evidence}</span>}
                    {alert.source_url && (
                      <a href={alert.source_url} target="_blank" rel="noreferrer">Source</a>
                    )}
                    <div className={styles.toolbar}>
                      <Button size="sm" onClick={() => void ack(alert)}>Acknowledge</Button>
                      <Button size="sm" variant="primary" disabled={busy === alert.id} onClick={() => void apply(alert)}>
                        Apply update
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
