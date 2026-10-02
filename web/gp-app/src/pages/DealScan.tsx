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
  ignored?: boolean
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

const FIELD_LABELS: Record<string, string> = {
  cash_per_share: 'Cash per share',
  exchange_ratio: 'Shares per share',
  exchange_stock: 'Stock received',
  cvr: 'Contingent value right',
  collar: 'Collar',
  election: 'Cash or stock election',
  proration: 'Proration',
  expected_close: 'Expected close',
  outside_date: 'Outside date',
  announce_date: 'Announced',
  termination_fee: 'Termination fee',
  vote_date: 'Shareholder vote',
}

const GENERIC_BUYER = /^(the company|company|merger sub(?:sidiary)?|the buyer|buyer|the acquirer|acquirer|the purchaser|purchaser)$/i

function fieldLabel(name: string) {
  if (FIELD_LABELS[name]) return FIELD_LABELS[name]
  return name.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function dollars(value?: string) {
  const text = (value || '').trim()
  if (!text) return ''
  if (text.startsWith('$')) return text
  if (text.startsWith('-')) return `-$${text.slice(1)}`
  return `$${text}`
}

function tickersFromName(name?: string) {
  const text = (name || '').replace(/\s+/g, ' ')
  const match = text.match(/\(([A-Z]{1,6}(?:\s*,\s*[A-Z]{1,6})*)/i)
  if (!match) return []
  return match[1].split(',').map((part) => part.trim().toUpperCase()).filter((part) => /^[A-Z]{2,6}$/.test(part))
}

function spokenCompany(name?: string) {
  let text = (name || '').replace(/\s+/g, ' ').trim()
  text = text.replace(/\s*\([^)]*$/, '').trim()
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(/\s*\((?:CIK\s+\d+|[A-Z]{1,6}(?:\s*,\s*[A-Z]{1,6})*)\)\s*$/i, '').trim()
    if (next === text) break
    text = next
  }
  return text
}

function currentValue(row: Candidate, name: string) {
  const field = (row.fields || []).find((item) => item.field_name === name && item.is_current !== false)
  if (!field || field.value == null || field.value === '') return ''
  return String(field.value)
}

function offerSentence(row: Candidate) {
  const terms = (row.offer_terms || '').trim()
  if (terms) {
    return terms
      .replace(/\$([0-9][0-9,]*(?:\.[0-9]+)?)\s+cash/gi, '$$$1 cash per share')
      .replace(/([0-9]+(?:\.[0-9]+)?)\s+shares\b/gi, '$1 shares per share')
      .replace(/\s\+\s/g, ' plus ')
  }
  const parts: string[] = []
  const cash = currentValue(row, 'cash_per_share').replace(/^\$/, '')
  const ratio = currentValue(row, 'exchange_ratio')
  if (cash) parts.push(`${dollars(cash)} cash per share`)
  if (ratio) parts.push(`${ratio} shares per share`)
  return parts.join(' plus ')
}

function buyerPhrase(row: Candidate) {
  const name = spokenCompany(row.acquirer_name)
  const ticker = (row.acquirer_ticker || '').toUpperCase()
  const usableTicker = /^[A-Z]{1,5}$/.test(ticker) ? ticker : ''
  if (!name || GENERIC_BUYER.test(name) || /^merger sub\b/i.test(name)) {
    return usableTicker
  }
  if (usableTicker && !name.toUpperCase().includes(usableTicker)) return `${name} (${usableTicker})`
  return name
}

function subjectOf(row: Candidate) {
  const name = spokenCompany(row.target_name)
  const listed = tickersFromName(row.target_name)
  const stored = (row.target_ticker || '').toUpperCase()
  const ticker = listed.length ? (listed.includes(stored) ? stored : listed[0]) : stored
  if (name && ticker && !name.toUpperCase().includes(ticker)) return `${name} (${ticker})`
  return name || ticker || 'This company'
}

function lastSale(row: Candidate) {
  const price = dollars(row.current_price)
  if (!price) return ''
  const listed = tickersFromName(row.target_name)
  const stored = (row.target_ticker || '').toUpperCase()
  if (listed.length && !listed.includes(stored)) return ''
  return price
}

function flagNames(row: Candidate) {
  return new Set((row.fields || []).filter((field) => field.is_current !== false).map((field) => field.field_name))
}

export type OfferFilter = 'all' | 'cash' | 'mixed'

/** Cash only, cash plus stock, stock only, or not enough terms to say. */
export function offerKind(row: Candidate): 'cash' | 'mixed' | 'stock' | 'other' {
  const stored = (row.consideration_type || '').trim().toLowerCase()
  if (stored === 'cash' || stored === 'mixed' || stored === 'stock') return stored
  const terms = (row.offer_terms || '').toLowerCase()
  const fields = (row.fields || []).filter((field) => field.is_current !== false)
  const hasCash = /\$[0-9]/.test(terms) || /\bcash\b/.test(terms)
    || fields.some((field) => field.field_name === 'cash_per_share' && field.value != null && field.value !== '')
  const hasStock = /\bshares?\b/.test(terms)
    || fields.some((field) => field.field_name === 'exchange_ratio' && field.value != null && field.value !== '')
  if (hasCash && hasStock) return 'mixed'
  if (hasCash) return 'cash'
  if (hasStock) return 'stock'
  return 'other'
}

function dealLine(row: Candidate) {
  const who = subjectOf(row)
  const offer = offerSentence(row)
  const buyer = buyerPhrase(row)
  const bits: string[] = []
  if (offer) bits.push(`${who} is offered ${offer}${buyer ? ` by ${buyer}` : ''}.`)
  else if (buyer) bits.push(`${who}: no cash or share price was extracted. Buyer: ${buyer}.`)
  else bits.push(`${who}: no cash or share price was extracted.`)
  const sale = lastSale(row)
  if (sale) bits.push(`Last sale ${sale}.`)
  const flags = flagNames(row)
  if (flags.has('cvr') && offer) bits.push('A contingent value right is also included.')
  if (row.needs_manual_terms && offer) {
    const why: string[] = []
    if (flags.has('collar')) why.push('a collar')
    if (flags.has('election')) why.push('a cash or stock election')
    if (flags.has('proration')) why.push('proration')
    bits.push(why.length
      ? `The spread was not computed because of ${why.join(', ')}.`
      : 'The spread was not computed because the terms need a manual check.')
  } else if (!row.needs_manual_terms && (row.gross_spread || row.gross_spread_pct)) {
    const spread = [dollars(row.gross_spread), row.gross_spread_pct || ''].filter(Boolean).join(' / ')
    bits.push(`Spread ${spread}.`)
    if (row.annualized_pct) bits.push(`Annualized ${row.annualized_pct}.`)
  }
  return bits.join(' ')
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
  const [showIgnored, setShowIgnored] = useState(false)
  const [offerFilter, setOfferFilter] = useState<OfferFilter>('all')
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
      if (path === 'open-analysis') {
        const next = data.path || ''
        if (!next) throw new Error('The analysis page did not open')
        navigate(next.includes('?') ? `${next}&local=1` : `${next}?local=1`)
      } else await load()
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

  const running = run?.status === 'running'
  const shown = candidates.filter((row) => offerFilter === 'all' || offerKind(row) === offerFilter)

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
        <p className={styles.muted}>
          Click a deal for the terms. Hide removes it from this list. Analyze runs on the local model on this computer and does not call Grok or Claude. Nothing is added until you click Analyze or Save on the desk.
        </p>
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
        <div className={styles.toolbar}>
          <label>
            Show
            <select
              aria-label="Offer type"
              value={offerFilter}
              onChange={(event) => setOfferFilter(event.target.value as OfferFilter)}
            >
              <option value="all">All offers</option>
              <option value="cash">Cash only</option>
              <option value="mixed">Cash and stock</option>
            </select>
          </label>
          <span className={styles.muted}>
            {shown.length} of {candidates.length} shown
          </span>
        </div>
        {!candidates.length && <p>No candidates yet. A scan does not add a deal by itself.</p>}
        {candidates.length > 0 && !shown.length && (
          <p>No {offerFilter === 'cash' ? 'cash-only' : 'cash-and-stock'} offers in this list. Choose All offers to see the other rows.</p>
        )}
        <ul className={styles.dealList}>
          {shown.map((row) => {
            const open = openId === row.id
            const line = dealLine(row)
            const listed = tickersFromName(row.target_name)
            const stored = (row.target_ticker || '').toUpperCase()
            const priceHidden = Boolean(dollars(row.current_price) && listed.length && !listed.includes(stored))
            const buyer = buyerPhrase(row)
            const genericBuyer = !buyer && GENERIC_BUYER.test(spokenCompany(row.acquirer_name))
            return (
              <li key={row.id} className={styles.dealRow}>
                <div className={styles.dealTop}>
                  <label className={styles.hideBox}>
                    <input
                      type="checkbox"
                      aria-label={`Hide ${subjectOf(row)}`}
                      checked={!!row.ignored}
                      disabled={!!row.ignored || busy === row.id}
                      onChange={() => { if (!row.ignored) void ignore(row) }}
                    />
                    Hide
                  </label>
                  <button
                    type="button"
                    className={styles.dealHit}
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? '' : row.id)}
                  >
                    <span className={styles.dealLine}>{line}</span>
                  </button>
                </div>
                {open && (
                  <div className={styles.dealDetail}>
                    <p className={styles.meta}>
                      Announced {row.announce_date || '—'}
                      {' · '}Expected close {row.expected_close || '—'}
                      {' · '}Status {row.status || '—'}
                      {row.hsr ? ` · HSR ${row.hsr}` : ''}
                      {row.vote_date ? ` · Vote ${row.vote_date}` : ''}
                      {row.confidence != null ? ` · Confidence ${row.confidence}` : ''}
                    </p>
                    {priceHidden && (
                      <p className={styles.meta}>
                        Last sale is hidden. The stored ticker {stored} is not one of the tickers on the filing name ({listed.join(', ')}).
                      </p>
                    )}
                    {genericBuyer && row.acquirer_name && (
                      <p className={styles.meta}>
                        The filing names the buyer as “{row.acquirer_name.trim()}”, which is not a specific acquirer.
                      </p>
                    )}
                    {(row.sources || []).some((source) => source.url) && (
                      <p className={styles.meta}>
                        {(row.sources || []).filter((source) => source.url).map((source, index) => (
                          <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">{source.name || 'Source'}</a>
                        ))}
                      </p>
                    )}
                    <ul className={styles.rows}>
                      {(row.fields || []).map((field, index) => (
                        <li key={`${field.field_name}-${index}`}>
                          <div>
                            <strong>{fieldLabel(field.field_name)}</strong>
                            <span className={styles.value}>
                              {String(field.value ?? '—')}{field.is_current === false ? ' (alternate)' : ''}
                            </span>
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
                      {!row.fields?.length && <li>No extracted fields.</li>}
                    </ul>
                    {row.target_cik && (
                      <p className={styles.meta}>
                        <a href={cikHref(row.target_cik)} target="_blank" rel="noreferrer">Filing company {row.target_cik}</a>
                      </p>
                    )}
                    <div className={styles.toolbar}>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!!busy}
                        onClick={() => void write(row, 'open-analysis')}
                      >
                        {busy === row.id ? 'Opening…' : 'Analyze on this Mac (free)'}
                      </Button>
                      <Button size="sm" disabled={!!busy} onClick={() => void write(row, 'add')}>
                        Save on the desk
                      </Button>
                    </div>
                    <p className={styles.muted}>
                      Analyze uses the local model. It does not call Grok or Claude. Deep dive stays a separate choice on the analysis page.
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Panel>
    </>
  )
}
