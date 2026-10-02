import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './MergerArbPage.module.css'
import { DealScan } from './DealScan'

type Deal = {
  id: string
  target_ticker?: string
  target_name?: string
  acquirer_ticker?: string
  acquirer_name?: string
  status?: string
  sample?: boolean
}

type SensitivityRow = {
  downside?: string
  close?: string
  implied_probability?: number | null
  annualized?: number | null
  annualized_simple?: number | null
}

type Row = {
  id: string
  label: string
  display: string
  value?: unknown
  source_name: string
  source_url: string
  locator?: string
  pulled_at_pt: string
  as_of_pt: string
  dot: 'green' | 'amber' | 'red'
  unverified: boolean
  notes?: string
}

type Card = { id: string; title: string; rows: Row[]; blocks: { title: string; rows: Row[] }[] }

type View = {
  ok?: boolean
  deal_id?: string
  version?: number
  model?: string
  as_of_pt?: string
  badge?: string
  sections?: Card[]
  flags?: { id: string; kind: string; detail: string }[]
  stage1_notes?: { text: string; field_ids: string[] }[]
  refresh?: { id: string; status: string; detail?: string }[]
  done?: { complete?: boolean; failed?: string[] }
  versions?: { version: number; stage: string; model: string; created_at_pt: string; diff: { id: string; before: unknown; after: unknown }[] }[]
  cut_warning?: string
  deal?: Deal
  deals?: Deal[]
  empty?: boolean
  answer?: string
  answer_note?: string
  citations?: string[]
  escalate?: boolean
}

function Dot({ dot }: { dot: Row['dot'] }) {
  return <span className={styles.dot} data-dot={dot} title={dot} />
}

function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

function Sensitivity({ value }: { value: unknown }) {
  if (!Array.isArray(value) || !value.length) return null
  const table = value as SensitivityRow[]
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Downside</th>
          <th>Close</th>
          <th>Implied probability</th>
          <th>Annualized</th>
          <th>Simple</th>
        </tr>
      </thead>
      <tbody>
        {table.map((item, index) => (
          <tr key={`${item.downside}-${item.close}-${index}`}>
            <td>{item.downside}</td>
            <td>{item.close}</td>
            <td>{pct(item.implied_probability)}</td>
            <td>{pct(item.annualized)}</td>
            <td>{pct(item.annualized_simple)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SourceNote({ row }: { row: Row }) {
  const bits: { key: string; node: ReactNode }[] = []
  if (row.source_url) {
    bits.push({
      key: 'source',
      node: <a href={row.source_url} target="_blank" rel="noreferrer">{row.source_name || 'Source'}</a>,
    })
  } else if (row.source_name) {
    bits.push({ key: 'source', node: row.source_name })
  }
  if (row.locator) bits.push({ key: 'locator', node: row.locator })
  if (row.pulled_at_pt) bits.push({ key: 'pulled', node: `pulled ${row.pulled_at_pt}` })
  if (row.as_of_pt) bits.push({ key: 'asof', node: `as of ${row.as_of_pt}` })
  if (row.notes) bits.push({ key: 'notes', node: row.notes })
  if (!bits.length) return null
  return (
    <details className={styles.factMore}>
      <summary>Source</summary>
      <span className={styles.meta}>
        {bits.map((bit, index) => (
          <span key={bit.key}>{index ? ' · ' : ''}{bit.node}</span>
        ))}
      </span>
    </details>
  )
}

function CompactFacts({ rows, onConfirm }: { rows: Row[]; onConfirm: (id: string) => void }) {
  if (!rows.length) return <p className={styles.muted}>Nothing stored.</p>
  const sensitivity = rows.find((row) => row.id === 'spread.sensitivity')
  const facts = rows.filter((row) => row.id !== 'spread.sensitivity')
  return (
    <>
      <ul className={styles.factGrid}>
        {facts.map((row) => (
          <li key={row.id} className={styles.fact}>
            <Dot dot={row.dot} />
            <span className={styles.factLabel}>{row.label}</span>
            <span className={styles.factValue}>{row.display}</span>
            {row.unverified && (
              <Button size="sm" variant="secondary" onClick={() => onConfirm(row.id)}>
                Confirm
              </Button>
            )}
            <SourceNote row={row} />
          </li>
        ))}
      </ul>
      {sensitivity ? <Sensitivity value={sensitivity.value} /> : null}
    </>
  )
}

function Rows({ rows, onConfirm }: { rows: Row[]; onConfirm: (id: string) => void }) {
  if (!rows.length) return <p className={styles.muted}>Nothing stored.</p>
  return (
    <ul className={styles.rows}>
      {rows.map((row) => (
        <li key={row.id}>
          <Dot dot={row.dot} />
          <div>
            <strong>{row.label}</strong>
            <span className={styles.value}>{row.display}</span>
            <span className={styles.meta}>
              {row.source_url ? (
                <a href={row.source_url} target="_blank" rel="noreferrer">{row.source_name || 'Source'}</a>
              ) : (
                row.source_name || 'No source'
              )}
              {row.locator ? ` · ${row.locator}` : ''}
              {row.pulled_at_pt ? ` · pulled ${row.pulled_at_pt}` : ''}
              {row.as_of_pt ? ` · as of ${row.as_of_pt}` : ''}
            </span>
            {row.id === 'spread.sensitivity' ? <Sensitivity value={row.value} /> : null}
            {row.notes ? <span className={styles.meta}>{row.notes}</span> : null}
            {row.unverified && (
              <Button size="sm" variant="secondary" onClick={() => onConfirm(row.id)}>
                Confirm this value
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function MergerArbPage() {
  const { dealId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const localOnce = useRef('')
  const [deals, setDeals] = useState<Deal[]>([])
  const [view, setView] = useState<View | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [provider, setProvider] = useState<'grok' | 'claude'>('grok')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [answerNote, setAnswerNote] = useState('')
  const [citations, setCitations] = useState<string[]>([])
  const [escalate, setEscalate] = useState(false)
  const [form, setForm] = useState({ target_ticker: '', acquirer_ticker: '', target_name: '', acquirer_name: '' })

  const loadDeals = useCallback(async () => {
    const data = await api<{ deals?: Deal[] }>('/api/merger-arb/deals')
    setDeals(data.deals || [])
  }, [])

  const loadView = useCallback(async (id: string) => {
    const data = await api<View>(`/api/merger-arb/analysis/${encodeURIComponent(id)}`)
    setView(data)
    setDeals(data.deals || [])
  }, [])

  useEffect(() => {
    setErr('')
    if (!dealId) {
      setView(null)
      loadDeals().catch((e) => setErr(e instanceof Error ? e.message : 'Could not load deals'))
      return
    }
    loadView(dealId).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load the analysis'))
  }, [dealId, loadDeals, loadView])

  const createDeal = async () => {
    setBusy('deal')
    setErr('')
    try {
      const data = await api<{ deal: Deal }>('/api/merger-arb/deals', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      navigate(`/merger-arb/analysis/${data.deal.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add that deal')
    } finally {
      setBusy('')
    }
  }

  const run = async (path: string, body: unknown, label: string) => {
    if (!dealId) return
    setBusy(label)
    setErr('')
    try {
      const data = await api<View>(path, { method: 'POST', body: JSON.stringify(body) })
      if (data.sections) setView(data)
      if (typeof data.answer === 'string') {
        setAnswer(data.answer)
        setEscalate(Boolean(data.escalate))
        setAnswerNote(data.answer_note || '')
        setCitations(data.citations || [])
      }
      await loadView(dealId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That step failed')
    } finally {
      setBusy('')
    }
  }

  useEffect(() => {
    if (!dealId || !view || view.empty) return
    if (params.get('local') !== '1') return
    if (localOnce.current === dealId) return
    localOnce.current = dealId
    setParams({}, { replace: true })
    void run(`/api/merger-arb/analysis/${encodeURIComponent(dealId)}/refresh`, {}, 'refresh')
  }, [dealId, view, params, setParams, run])

  const confirm = (fieldId: string) => {
    if (!dealId) return
    void run(`/api/merger-arb/analysis/${encodeURIComponent(dealId)}/confirm`, { field_id: fieldId }, 'confirm')
  }

  const exportPacket = async (format: 'md' | 'json') => {
    if (!dealId) return
    setBusy('export')
    setErr('')
    try {
      const data = await api<{ body?: string; filename?: string }>(
        `/api/merger-arb/analysis/${encodeURIComponent(dealId)}/export?format=${format}`,
      )
      const blob = new Blob([data.body || ''], { type: format === 'json' ? 'application/json' : 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = data.filename || `merger-arb.${format === 'json' ? 'json' : 'md'}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research</p>
          <h1 className={page.h1}>Merger arb analysis</h1>
          <p className={page.sub}>
            Deep dive on a cloud model you pick. Refresh and follow-up stay on the local model.
          </p>
        </div>
      </header>
      {err && <p className={styles.err}>{err}</p>}

      {!dealId && (
        <>
          <DealScan />
          <Panel title="Deals">
            <ul className={styles.deals}>
              {deals.map((deal) => (
                <li key={deal.id}>
                  <Link to={`/merger-arb/analysis/${deal.id}`}>
                    {deal.target_ticker} / {deal.acquirer_ticker}
                  </Link>
                  <span>{deal.target_name} · {deal.status}{deal.sample ? ' · sample' : ''}</span>
                </li>
              ))}
              {!deals.length && <li>No deals yet.</li>}
            </ul>
          </Panel>
          <Panel title="Add a deal">
            <div className={styles.form}>
              <input aria-label="Target ticker" placeholder="Target ticker" value={form.target_ticker} onChange={(e) => setForm({ ...form, target_ticker: e.target.value })} />
              <input aria-label="Acquirer ticker" placeholder="Acquirer ticker" value={form.acquirer_ticker} onChange={(e) => setForm({ ...form, acquirer_ticker: e.target.value })} />
              <input aria-label="Target name" placeholder="Target name" value={form.target_name} onChange={(e) => setForm({ ...form, target_name: e.target.value })} />
              <input aria-label="Acquirer name" placeholder="Acquirer name" value={form.acquirer_name} onChange={(e) => setForm({ ...form, acquirer_name: e.target.value })} />
              <Button variant="primary" size="sm" disabled={busy === 'deal'} onClick={() => void createDeal()}>
                Add
              </Button>
            </div>
          </Panel>
        </>
      )}

      {dealId && view && (
        <>
          <Panel
            title={`${view.deal?.target_ticker || dealId} / ${view.deal?.acquirer_ticker || ''}`}
            badge={view.badge}
          >
            <div className={styles.toolbar}>
              <label>
                Deal
                <select
                  aria-label="Deal"
                  value={dealId}
                  onChange={(e) => navigate(`/merger-arb/analysis/${e.target.value}`)}
                >
                  {(view.deals || deals).map((deal) => (
                    <option key={deal.id} value={deal.id}>
                      {deal.target_ticker} / {deal.acquirer_ticker}
                    </option>
                  ))}
                </select>
              </label>
              <span>Version {view.version ?? '—'} · {view.model} · as of {view.as_of_pt || '—'}</span>
              <label>
                Deep dive model
                <select aria-label="Deep dive model" value={provider} onChange={(e) => setProvider(e.target.value as 'grok' | 'claude')}>
                  <option value="grok">Grok</option>
                  <option value="claude">Claude</option>
                </select>
              </label>
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void run(`/api/merger-arb/analysis/${dealId}/deep-dive`, { provider }, 'deep')}>
                {busy === 'deep' ? 'Running…' : `Run Deep Dive (${provider === 'grok' ? 'Grok' : 'Claude'})`}
              </Button>
              <Button size="sm" disabled={!!busy || !!view.empty} onClick={() => void run(`/api/merger-arb/analysis/${dealId}/refresh`, {}, 'refresh')}>
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh with Local Model (free)'}
              </Button>
              <Button size="sm" disabled={!!busy || !!view.empty} onClick={() => void exportPacket('md')}>Export Markdown</Button>
              <Button size="sm" disabled={!!busy || !!view.empty} onClick={() => void exportPacket('json')}>Export JSON</Button>
            </div>
            <p className={styles.muted}>
              Deep dive runs only when you click it, on {provider === 'grok' ? 'Grok' : 'Claude'}. Refresh never switches to a paid model.
            </p>
            {view.cut_warning && <p className={styles.warn}>{view.cut_warning}</p>}
            {view.empty && <p>No packet yet. Run Deep Dive to create version 1. Nothing runs until you click.</p>}
          </Panel>

          {!view.empty && (view.sections || []).map((card) => (
            <Panel key={card.id} title={card.title}>
              {card.id === 'overview' || card.id === 'spread' ? (
                <CompactFacts rows={card.rows} onConfirm={confirm} />
              ) : (
                <Rows rows={card.rows} onConfirm={confirm} />
              )}
              {card.blocks.map((block) => (
                <div key={block.title}>
                  <h3 className={styles.blockTitle}>{block.title}</h3>
                  <Rows rows={block.rows} onConfirm={confirm} />
                </div>
              ))}
            </Panel>
          ))}

          {!view.empty && (
          <>
          <Panel title="Refresh">
            {view.done?.complete ? <p>Refresh complete</p> : null}
            {view.done?.failed?.length ? (
              <ul>{view.done.failed.map((item) => <li key={item}>{item}</li>)}</ul>
            ) : null}
            <ul className={styles.rows}>
              {(view.refresh || []).map((item) => (
                <li key={item.id}><span>{item.status}</span><span>{item.id}{item.detail ? ` · ${item.detail}` : ''}</span></li>
              ))}
              {!view.refresh?.length && <li>No refresh yet.</li>}
            </ul>
          </Panel>

          <Panel title="Flags">
            <ul>
              {(view.flags || []).map((flag, index) => (
                <li key={`${flag.id}-${index}`}><strong>{flag.kind}</strong> · {flag.id} · {flag.detail}</li>
              ))}
              {!view.flags?.length && <li>None.</li>}
            </ul>
          </Panel>

          <Panel title="Ask a follow-up">
            <textarea
              aria-label="Follow-up"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="Ask from this packet only"
            />
            <Button
              size="sm"
              variant="primary"
              disabled={!!busy || question.trim().length < 4}
              onClick={() => void run(`/api/merger-arb/analysis/${dealId}/ask`, { question }, 'ask')}
            >
              Ask a follow-up
            </Button>
            {answer && <p>{answer}</p>}
            {citations.length > 0 && <p className={styles.meta}>Cites {citations.join(', ')}</p>}
            {answerNote && <p className={styles.warn}>{answerNote}</p>}
            {escalate && (
              <Button size="sm" variant="secondary" onClick={() => void run(`/api/merger-arb/analysis/${dealId}/deep-dive`, { provider }, 'deep')}>
                Escalate to Deep Dive
              </Button>
            )}
          </Panel>

          <Panel title="Version history">
            <ul>
              {(view.versions || []).map((item) => (
                <li key={`${item.version}-${item.stage}`}>
                  <strong>v{item.version}</strong> · {item.stage} · {item.model} · {item.created_at_pt}
                  {item.diff?.length ? (
                    <ul>
                      {item.diff.map((change) => (
                        <li key={change.id}>{change.id}: {String(change.before)} → {String(change.after)}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>

          {view.stage1_notes?.length ? (
            <Panel title="Deep dive notes">
              <ul>
                {view.stage1_notes.map((note) => (
                  <li key={note.text}>{note.text} ({(note.field_ids || []).join(', ')})</li>
                ))}
              </ul>
            </Panel>
          ) : null}
          </>
          )}
        </>
      )}
    </div>
  )
}
