import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from './MergerArbPage.module.css'

type Field = {
  field_name: string
  value?: unknown
  raw?: string
  source_name?: string
  source_url?: string
  pulled_at_pt?: string
  method?: string
  evidence?: string
  conflict?: boolean
  is_current?: boolean
}

type SourceBadge = { name?: string; url?: string; form?: string }

type Candidate = {
  id: string
  target_ticker?: string
  target_name?: string
  target_cik?: string
  acquirer_ticker?: string
  acquirer_name?: string
  consideration_type?: string
  offer_terms?: string
  announce_date?: string
  expected_close?: string
  status?: string
  hsr?: string
  vote_date?: string
  current_price?: string
  offer_value?: string
  gross_spread?: string
  gross_spread_pct?: string
  annualized_pct?: string
  annualized_assumption?: string
  confidence?: number
  confidence_breakdown?: { points: number; reason: string }[]
  needs_manual_terms?: boolean
  sources?: SourceBadge[]
  fields?: Field[]
}

type Alert = {
  id: string
  desk_deal_id?: string
  alert_type?: string
  certainty?: string
  source_url?: string
  evidence?: string
  pulled_at_pt?: string
  details?: Record<string, unknown>
}

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

type Latest = {
  last_scan_pt?: string
  candidates?: Candidate[]
  alerts?: Alert[]
  run?: Run | null
}

function money(value?: string, manual?: boolean) {
  if (manual) return '—'
  if (!value) return '—'
  return value.startsWith('$') ? value : `$${value}`
}

function cikHref(cik?: string) {
  if (!cik) return ''
  return `https://www.sec.gov/edgar/browse/?CIK=${cik}`
}

export function DealScan() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental')
  const [days, setDays] = useState(120)
  const [run, setRun] = useState<Run | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [lastScan, setLastScan] = useState('')
  const [openId, setOpenId] = useState('')
  const [confirmId, setConfirmId] = useState('')
  const [showIgnored, setShowIgnored] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const query = showIgnored ? '?ignored=1' : ''
    const data = await api<Latest>(`/api/merger-arb/scan/latest${query}`)
    setCandidates(data.candidates || [])
    setAlerts(data.alerts || [])
    setLastScan(data.last_scan_pt || '')
    if (data.run?.status === 'running') setRun(data.run)
  }, [showIgnored])

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
          }
        })
        .catch((error) => setErr(error instanceof Error ? error.message : 'The scan status failed'))
    }, 1500)
    return () => window.clearInterval(timer)
  }, [run?.id, run?.status, load])

  const start = async () => {
    setBusy('scan')
    setErr('')
    try {
      const data = await api<{ run_id: string }>('/api/merger-arb/scan', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          since_days: mode === 'full' ? days : undefined,
        }),
      })
      setRun({ id: data.run_id, status: 'running', sources: [] })
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

  const write = async (candidate: Candidate, path: 'add' | 'open-analysis') => {
    setBusy(candidate.id)
    setErr('')
    try {
      const data = await api<{ path: string }>(`/api/merger-arb/candidates/${encodeURIComponent(candidate.id)}/${path}`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      })
      setConfirmId('')
      if (path === 'open-analysis') navigate(data.path)
      else await load()
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Nothing was written')
    } finally {
      setBusy('')
    }
  }

  const ignore = async (candidate: Candidate) => {
    setBusy(candidate.id)
    setErr('')
    try {
      await api(`/api/merger-arb/candidates/${encodeURIComponent(candidate.id)}/ignore`, {
        method: 'POST',
        body: JSON.stringify({ reason: '' }),
      })
      await load()
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not ignore that row')
    } finally {
      setBusy('')
    }
  }

  const ack = async (alert: Alert) => {
    await api(`/api/merger-arb/alerts/${encodeURIComponent(alert.id)}/acknowledge`, { method: 'POST' })
    await load()
  }

  const apply = async (alert: Alert) => {
    setBusy(alert.id)
    setErr('')
    try {
      await api(`/api/merger-arb/alerts/${encodeURIComponent(alert.id)}/apply`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      })
      await load()
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'The alert was not applied')
    } finally {
      setBusy('')
    }
  }

  const selected = candidates.find((row) => row.id === openId)
  const confirming = candidates.find((row) => row.id === confirmId)
  const running = run?.status === 'running'

  return (
    <>
      <Panel title="Scan for deals">
        <div className={styles.toolbar}>
          <label>
            Window
            <select aria-label="Scan window" value={mode} onChange={(event) => setMode(event.target.value as 'incremental' | 'full')}>
              <option value="incremental">Incremental (since last scan)</option>
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
          <Button variant="primary" size="sm" disabled={!!busy || running} onClick={() => void start()}>
            {running ? 'Scanning…' : 'Scan for deals'}
          </Button>
          {running && (
            <Button size="sm" disabled={busy === 'cancel'} onClick={() => void cancel()}>
              Cancel
            </Button>
          )}
          <span className={styles.muted}>
            Last scan: {lastScan || 'none'}
            {run?.counts?.candidates != null ? ` · ${run.counts.candidates} rows` : ''}
          </span>
          <label>
            <input type="checkbox" checked={showIgnored} onChange={(event) => setShowIgnored(event.target.checked)} />
            Show ignored
          </label>
        </div>
        <p className={styles.muted}>Nothing is added to the desk until you click Add or Open in analysis.</p>
        {err && <p className={styles.err}>{err}</p>}
        {run?.sources?.length ? (
          <ul className={styles.rows}>
            {run.sources.map((row) => (
              <li key={row.name}>
                <strong>{row.label || row.name}</strong>
                <span className={styles.meta}>
                  {row.status || 'queued'}
                  {row.count ? ` · ${row.count}` : ''}
                  {row.elapsed_ms ? ` · ${row.elapsed_ms} ms` : ''}
                  {row.detail ? ` · ${row.detail}` : ''}
                  {row.error ? ` · ${row.error}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {alerts.length > 0 && (
        <Panel title="Status alerts">
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
        </Panel>
      )}

      <Panel title="Scan results">
        <div className={styles.scanWrap}>
          <table className={styles.scanTable}>
            <thead>
              <tr>
                <th>Target</th>
                <th>Acquirer</th>
                <th>Terms</th>
                <th>Announced</th>
                <th>Close</th>
                <th>Status</th>
                <th>HSR</th>
                <th>Vote</th>
                <th>Price</th>
                <th>Offer</th>
                <th>Spread</th>
                <th>Annualized</th>
                <th>Confidence</th>
                <th>Sources</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map((row) => (
                <tr key={row.id} onClick={() => setOpenId(openId === row.id ? '' : row.id)}>
                  <td>
                    <strong>{row.target_ticker || '—'}</strong>
                    <span className={styles.meta}>{row.target_name}</span>
                    {row.target_cik && (
                      <a href={cikHref(row.target_cik)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                        {row.target_cik}
                      </a>
                    )}
                  </td>
                  <td>{row.acquirer_ticker || row.acquirer_name || '—'}</td>
                  <td>{row.offer_terms || row.consideration_type || '—'}</td>
                  <td>{row.announce_date || '—'}</td>
                  <td>{row.expected_close || '—'}</td>
                  <td>{row.status || '—'}</td>
                  <td>{row.hsr || '—'}</td>
                  <td>{row.vote_date || '—'}</td>
                  <td>{money(row.current_price)}</td>
                  <td>{money(row.offer_value, row.needs_manual_terms)}</td>
                  <td>{row.needs_manual_terms ? '—' : `${row.gross_spread ? '$' + row.gross_spread : '—'} / ${row.gross_spread_pct || '—'}`}</td>
                  <td title={row.annualized_assumption || ''}>{row.needs_manual_terms ? '—' : (row.annualized_pct || '—')}</td>
                  <td title={(row.confidence_breakdown || []).map((item) => `${item.points}: ${item.reason}`).join('\n')}>
                    {row.confidence ?? '—'}
                  </td>
                  <td>{(row.sources || []).map((source) => source.name).filter(Boolean).join(', ') || '—'}</td>
                  <td>
                    <div className={styles.toolbar} onClick={(event) => event.stopPropagation()}>
                      <Button size="sm" variant="primary" onClick={() => setConfirmId(row.id)}>Add</Button>
                      <Button size="sm" onClick={() => void ignore(row)}>Ignore</Button>
                      <Button size="sm" onClick={() => setConfirmId(row.id)}>Open</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!candidates.length && (
                <tr>
                  <td colSpan={15}>No candidates yet. A scan does not add a deal by itself.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selected && (
          <div className={styles.drawer}>
            <h3>Where these numbers came from</h3>
            <ul className={styles.rows}>
              {(selected.fields || []).map((field, index) => (
                <li key={`${field.field_name}-${index}`}>
                  <div>
                    <strong>{field.field_name}</strong>
                    <span className={styles.value}>{String(field.value ?? '—')}{field.is_current === false ? ' (alternate)' : ''}</span>
                    <span className={styles.meta}>
                      {field.source_url ? (
                        <a href={field.source_url} target="_blank" rel="noreferrer">{field.source_name || 'Source'}</a>
                      ) : (field.source_name || 'No source')}
                      {field.pulled_at_pt ? ` · pulled ${field.pulled_at_pt}` : ''}
                      {field.method ? ` · ${field.method}` : ''}
                      {field.conflict ? ' · conflict' : ''}
                    </span>
                    {field.evidence && <span className={styles.meta}>{field.evidence}</span>}
                    {field.raw && <span className={styles.meta}>{field.raw}</span>}
                  </div>
                </li>
              ))}
              {!selected.fields?.length && <li>No extracted fields.</li>}
            </ul>
          </div>
        )}
        {confirming && (
          <div className={styles.drawer}>
            <h3>Write {confirming.target_ticker || 'this candidate'} to the desk?</h3>
            <p className={styles.muted}>
              {confirming.needs_manual_terms
                ? 'Collar, election, or proration is flagged. The scan does not compute that spread. The analysis page still uses its own math after you add it.'
                : 'These are the fields that will be saved. Nothing is written until you confirm.'}
            </p>
            <ul>
              {(confirming.fields || []).filter((field) => field.is_current !== false).map((field) => (
                <li key={field.field_name}>
                  {field.field_name}: {String(field.value ?? '—')} · {field.source_name} · {field.pulled_at_pt || field.method}
                </li>
              ))}
            </ul>
            <div className={styles.toolbar}>
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void write(confirming, 'add')}>
                Add to desk
              </Button>
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void write(confirming, 'open-analysis')}>
                Open in analysis
              </Button>
              <Button size="sm" onClick={() => setConfirmId('')}>Cancel</Button>
            </div>
          </div>
        )}
      </Panel>
    </>
  )
}
