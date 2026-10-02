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

const TAPE: [string, string][] = [
  ['overview.offer_value', 'Offer'],
  ['overview.target_price', 'Price'],
  ['spread.gross_percent', 'Gross spread'],
  ['spread.annualized', 'Annualized'],
  ['spread.implied_probability', 'Probability'],
  ['overview.expected_close', 'Close'],
  ['downside.downside_percent', 'Downside'],
  ['upside.upside_percent', 'Upside'],
]

function sectionRows(sections: Card[] | undefined, id: string): Row[] {
  const card = (sections || []).find((item) => item.id === id)
  if (!card) return []
  return [...card.rows, ...card.blocks.flatMap((block) => block.rows)]
}

function findRow(sections: Card[] | undefined, id: string): Row | undefined {
  for (const card of sections || []) {
    const hit = [...card.rows, ...card.blocks.flatMap((block) => block.rows)].find((row) => row.id === id)
    if (hit) return hit
  }
  return undefined
}

function MemoTable({ rows, onConfirm }: { rows: Row[]; onConfirm: (id: string) => void }) {
  const facts = rows.filter((row) => row.id !== 'spread.sensitivity')
  const sensitivity = rows.find((row) => row.id === 'spread.sensitivity')
  if (!facts.length && !sensitivity) return <p className={styles.muted}>Nothing stored.</p>
  return (
    <>
      {facts.length > 0 && (
        <table className={styles.memoTable}>
          <tbody>
            {facts.map((row) => (
              <tr key={row.id}>
                <th>{row.label}</th>
                <td>
                  <span className={styles.memoVal}>{row.display}</span>
                  <i className={styles.pip} data-dot={row.dot} title={row.dot} />
                  {row.unverified && (
                    <Button size="sm" variant="secondary" onClick={() => onConfirm(row.id)}>Confirm</Button>
                  )}
                  <SourceNote row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sensitivity ? <Sensitivity value={sensitivity.value} /> : null}
    </>
  )
}

function BookSection({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2><span>{n}</span>{title}</h2>
      {children}
    </section>
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
      {!dealId && (
        <header className={page.hero}>
          <div>
            <p className={page.kicker}>DGA Capital</p>
            <h1 className={page.h1}>Merger arbitrage</h1>
            <p className={page.sub}>
              Situation memoranda. Spread, probability, and downside are computed in code.
            </p>
          </div>
        </header>
      )}
      {err && <p className={styles.err}>{err}</p>}

      {!dealId && (
        <>
          <DealScan />
          <Panel title="Pipeline">
            <table className={styles.pipe}>
              <thead>
                <tr><th>Target</th><th>Acquirer</th><th>Status</th></tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id}>
                    <td>
                      <Link to={`/merger-arb/analysis/${deal.id}`}>{deal.target_ticker || deal.id}</Link>
                      <span className={styles.meta}>{deal.target_name}</span>
                    </td>
                    <td>
                      {deal.acquirer_ticker || '—'}
                      <span className={styles.meta}>{deal.acquirer_name}</span>
                    </td>
                    <td>{deal.status || '—'}{deal.sample ? ' · sample' : ''}</td>
                  </tr>
                ))}
                {!deals.length && <tr><td colSpan={3}>No deals yet.</td></tr>}
              </tbody>
            </table>
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
        <article className={styles.book}>
          <header className={styles.mast}>
            <p className={styles.kicker}>DGA Capital · Merger arbitrage · Situation memorandum</p>
            <div className={styles.mastTop}>
              <h1>
                {view.deal?.target_name || view.deal?.target_ticker || dealId}
                <span> / {view.deal?.acquirer_name || view.deal?.acquirer_ticker || 'Acquirer'}</span>
              </h1>
              <p className={styles.badge}>{view.badge || 'No packet'}</p>
            </div>
            <p className={styles.mastMeta}>
              {view.deal?.target_ticker || dealId} / {view.deal?.acquirer_ticker || '—'}
              {' · '}Version {view.version ?? '—'}
              {' · '}{view.model || 'no model yet'}
              {' · '}as of {view.as_of_pt || '—'}
            </p>
          </header>
          <div className={styles.rule} />
          {!view.empty && (
            <div className={styles.tape}>
              {TAPE.map(([id, label]) => {
                const row = findRow(view.sections, id)
                return (
                  <div key={id} className={styles.tapeCell}>
                    <span>{label}</span>
                    <strong>{row?.display || '—'}</strong>
                  </div>
                )
              })}
            </div>
          )}
          <div className={styles.command}>
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
            <label>
              Deep dive
              <select aria-label="Deep dive model" value={provider} onChange={(e) => setProvider(e.target.value as 'grok' | 'claude')}>
                <option value="grok">Grok</option>
                <option value="claude">Claude</option>
              </select>
            </label>
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void run(`/api/merger-arb/analysis/${dealId}/deep-dive`, { provider }, 'deep')}>
              {busy === 'deep' ? 'Running…' : 'Run deep dive'}
            </Button>
            <Button size="sm" disabled={!!busy || !!view.empty} onClick={() => void run(`/api/merger-arb/analysis/${dealId}/refresh`, {}, 'refresh')}>
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh on local model'}
            </Button>
            <Button size="sm" disabled={!!busy || !!view.empty} onClick={() => void exportPacket('md')}>Export</Button>
            <Button size="sm" disabled={!!busy || !!view.empty} onClick={() => void exportPacket('json')}>JSON</Button>
            <Link className={styles.back} to="/merger-arb">Pipeline</Link>
          </div>
          <p className={styles.muted}>
            Deep dive runs only when you click it, on {provider === 'grok' ? 'Grok' : 'Claude'}. Refresh stays on the local model.
          </p>
          {view.cut_warning && <p className={styles.warn}>{view.cut_warning}</p>}
          {view.empty && <p className={styles.pad}>No packet yet. Run deep dive to write version 1. Nothing runs until you click.</p>}
          {!view.empty && (
            <div className={styles.body}>
              <div className={styles.split}>
                <BookSection n="01" title="Situation">
                  <MemoTable rows={sectionRows(view.sections, 'overview')} onConfirm={confirm} />
                </BookSection>
                <BookSection n="02" title="Consideration">
                  <MemoTable rows={sectionRows(view.sections, 'structure')} onConfirm={confirm} />
                </BookSection>
              </div>
              <BookSection n="03" title="Spread and implied probability">
                <MemoTable rows={sectionRows(view.sections, 'spread')} onConfirm={confirm} />
              </BookSection>
              <div className={styles.split3}>
                <BookSection n="04" title="Regulatory path">
                  <MemoTable rows={sectionRows(view.sections, 'regulatory')} onConfirm={confirm} />
                </BookSection>
                <BookSection n="05" title="Shareholder votes">
                  <MemoTable rows={sectionRows(view.sections, 'votes')} onConfirm={confirm} />
                </BookSection>
                <BookSection n="06" title="Catalysts">
                  <MemoTable rows={sectionRows(view.sections, 'catalysts')} onConfirm={confirm} />
                </BookSection>
              </div>
              <div className={styles.split}>
                <BookSection n="07" title="Downside if the deal breaks">
                  <MemoTable rows={sectionRows(view.sections, 'downside')} onConfirm={confirm} />
                </BookSection>
                <BookSection n="08" title="Upside on close">
                  <MemoTable rows={sectionRows(view.sections, 'upside')} onConfirm={confirm} />
                </BookSection>
              </div>
              <BookSection n="09" title="Sources, refresh, and flags">
                <div className={styles.split3}>
                  <div>
                    <h3 className={styles.subhead}>Sources</h3>
                    <MemoTable rows={sectionRows(view.sections, 'sources')} onConfirm={confirm} />
                  </div>
                  <div>
                    <h3 className={styles.subhead}>Refresh</h3>
                    {view.done?.complete ? <p className={styles.muted}>Refresh complete</p> : null}
                    <ul className={styles.log}>
                      {(view.done?.failed || []).map((item) => <li key={item}>{item}</li>)}
                      {(view.refresh || []).map((item) => (
                        <li key={item.id}>{item.status} · {item.id}{item.detail ? ` · ${item.detail}` : ''}</li>
                      ))}
                      {!view.refresh?.length && !view.done?.failed?.length && <li>No refresh yet.</li>}
                    </ul>
                  </div>
                  <div>
                    <h3 className={styles.subhead}>Flags</h3>
                    <ul className={styles.log}>
                      {(view.flags || []).map((flag, index) => (
                        <li key={`${flag.id}-${index}`}><strong>{flag.kind}</strong> · {flag.id}{flag.detail ? ` · ${flag.detail}` : ''}</li>
                      ))}
                      {!view.flags?.length && <li>None.</li>}
                    </ul>
                  </div>
                </div>
              </BookSection>
              {(view.sections || []).filter((card) => !['overview', 'spread', 'structure', 'regulatory', 'votes', 'catalysts', 'downside', 'upside', 'sources'].includes(card.id)).map((card) => (
                <BookSection key={card.id} n="—" title={card.title}>
                  <MemoTable rows={[...card.rows, ...card.blocks.flatMap((block) => block.rows)]} onConfirm={confirm} />
                </BookSection>
              ))}
              <BookSection n="10" title="Follow-up">
                <textarea
                  aria-label="Follow-up"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={2}
                  placeholder="Ask from this packet only"
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!!busy || question.trim().length < 4}
                  onClick={() => void run(`/api/merger-arb/analysis/${dealId}/ask`, { question }, 'ask')}
                >
                  Ask
                </Button>
                {answer && <p>{answer}</p>}
                {citations.length > 0 && <p className={styles.meta}>Cites {citations.join(', ')}</p>}
                {answerNote && <p className={styles.warn}>{answerNote}</p>}
                {escalate && (
                  <Button size="sm" variant="secondary" onClick={() => void run(`/api/merger-arb/analysis/${dealId}/deep-dive`, { provider }, 'deep')}>
                    Escalate to deep dive
                  </Button>
                )}
              </BookSection>
              <BookSection n="11" title="Version history">
                <ul className={styles.log}>
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
              </BookSection>
              {view.stage1_notes?.length ? (
                <BookSection n="12" title="Deep dive notes">
                  <ul className={styles.log}>
                    {view.stage1_notes.map((note) => (
                      <li key={note.text}>{note.text} ({(note.field_ids || []).join(', ')})</li>
                    ))}
                  </ul>
                </BookSection>
              ) : null}
            </div>
          )}
        </article>
      )}
    </div>
  )
}
