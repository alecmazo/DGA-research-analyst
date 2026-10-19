import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Empty } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './MergerArbPage.module.css'
import { ScanTools } from './DealScan'
import { DealDrawer } from './DealDrawer'

type Deal = {
  id: string
  target_ticker?: string
  target_name?: string
  acquirer_ticker?: string
  acquirer_name?: string
  status?: string
  sample?: boolean
  stage?: string
  deal_type?: string
  sector?: string
  offer_value?: number | null
  target_price?: number | null
  gross_pct?: number | null
  ann_pct?: number | null
  downside_pct?: number | null
  implied_p?: number | null
  expected_close?: string
  days_to_close?: number | null
  deal_value_usd?: number | null
  score?: number | null
  score_band?: string
  data_confidence?: number | null
  reg_flags?: string[]
  needs_manual_terms?: boolean
  acquirer_price_sensitive?: boolean
  hostile?: boolean
}

type ListResponse = {
  deals?: Deal[]
  total?: number
  facets?: Record<string, Record<string, number>>
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

const FILTER_KEYS = ['q', 'stage', 'type', 'sector', 'size', 'ann_min', 'band', 'regulatory', 'close', 'sort'] as const
const DEFAULT_STAGE = 'screen,watch,active'
const VIEWS = [
  { id: 'best', label: 'Best risk-adjusted', params: { stage: DEFAULT_STAGE, sort: '-score' } },
  { id: 'soon', label: 'Closing soon', params: { close: '30', sort: 'close' } },
  { id: 'reg', label: 'Regulatory watch', params: { regulatory: '2R,CFIUS' } },
  { id: 'new', label: 'New from scan', params: { stage: 'screen', sort: '-score' } },
]
const HIDDEN_KEY = 'merger-arb-hidden-cols'

function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

function pctShort(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'
  const shown = Math.abs(value) <= 1.5 ? value * 100 : value
  return `${shown.toFixed(digits)}%`
}

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function compact(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  return money(value)
}

function closeLabel(deal: Deal) {
  const day = (deal.expected_close || '').slice(5)
  if (!day && deal.days_to_close == null) return '—'
  const days = deal.days_to_close
  return `${day || '—'} · ${days == null ? '—' : `${days}d`}`
}

function bandClass(band?: string) {
  const key = (band || 'NR').toUpperCase()
  if (key === 'A') return styles.bandA
  if (key === 'B') return styles.bandB
  if (key === 'C') return styles.bandC
  if (key === 'D') return styles.bandD
  if (key === 'F') return styles.bandF
  return styles.bandNR
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

function Chip({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className={styles.chip}>
      {label}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

export function MergerArbPage() {
  const { dealId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const localOnce = useRef('')
  const [deals, setDeals] = useState<Deal[]>([])
  const [total, setTotal] = useState(0)
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
  const [addOpen, setAddOpen] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')
    } catch {
      return []
    }
  })

  const selectedId = params.get('deal') || ''
  const filterValue = (key: string, fallback = '') => params.get(key) || fallback

  const loadDeals = useCallback(async () => {
    const query = new URLSearchParams()
    FILTER_KEYS.forEach((key) => {
      const value = params.get(key)
      if (value) query.set(key, value)
    })
    if (!query.get('stage')) query.set('stage', DEFAULT_STAGE)
    if (!query.get('sort')) query.set('sort', '-score')
    const data = await api<ListResponse>(`/api/merger-arb/deals?${query.toString()}`)
    setDeals(data.deals || [])
    setTotal(data.total || (data.deals || []).length)
  }, [params])

  const loadView = useCallback(async (id: string) => {
    const data = await api<View>(`/api/merger-arb/analysis/${encodeURIComponent(id)}`)
    setView(data)
    setDeals(data.deals || [])
  }, [])

  useEffect(() => {
    setErr('')
    if (dealId) {
      loadView(dealId).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load the analysis'))
      return
    }
    setView(null)
    loadDeals().catch((e) => setErr(e instanceof Error ? e.message : 'Could not load deals'))
  }, [dealId, loadDeals, loadView])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedId) {
        const next = new URLSearchParams(params)
        next.delete('deal')
        setParams(next, { replace: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [params, selectedId, setParams])

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (!value) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const openDeal = (deal: Deal) => {
    const next = new URLSearchParams(params)
    next.set('deal', deal.id)
    setParams(next, { replace: true })
  }

  const createDeal = async () => {
    setBusy('deal')
    setErr('')
    try {
      const data = await api<{ deal: Deal }>('/api/merger-arb/deals', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setAddOpen(false)
      const next = new URLSearchParams(params)
      next.set('deal', data.deal.id)
      setParams(next)
      await loadDeals()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add that deal')
    } finally {
      setBusy('')
    }
  }

  const run = useCallback(async (path: string, body: unknown, label: string) => {
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
  }, [dealId, loadView])

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

  const loadWeights = async () => {
    const data = await api<{ config?: { weights?: Record<string, number> } }>('/api/merger-arb/score-config')
    setWeights(data.config?.weights || {})
    setWeightsOpen(true)
  }

  const saveWeights = async () => {
    setBusy('weights')
    try {
      await api('/api/merger-arb/score-config', { method: 'PUT', body: JSON.stringify({ weights }) })
      setWeightsOpen(false)
      await loadDeals()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Weights must sum to 100')
    } finally {
      setBusy('')
    }
  }

  const columns: DataColumn<Deal>[] = useMemo(() => [
    {
      id: 'score',
      label: 'Score',
      sort: 'score',
      numeric: true,
      render: (deal) => (
        <span className={`${styles.band} ${bandClass(deal.score_band)}`}>
          {deal.score_band || 'NR'} {deal.score ?? ''}
        </span>
      ),
    },
    {
      id: 'target',
      label: 'Target',
      sort: 'target',
      render: (deal) => (
        <span>
          <strong>{deal.target_ticker || deal.id}</strong>
          <span className={styles.metaInline}> {deal.target_name}</span>
          {deal.hostile ? <em className={styles.tag}>hostile</em> : null}
        </span>
      ),
    },
    {
      id: 'acquirer',
      label: 'Acquirer',
      sort: 'acquirer',
      render: (deal) => deal.acquirer_ticker || deal.acquirer_name || '—',
    },
    {
      id: 'type',
      label: 'Type',
      sort: 'type',
      render: (deal) => (
        <span>
          {deal.deal_type || '—'}
          {deal.needs_manual_terms ? <em className={styles.tag}>terms needed</em> : null}
        </span>
      ),
    },
    { id: 'offer', label: 'Offer', sort: 'offer', numeric: true, render: (deal) => (deal.needs_manual_terms ? '—' : money(deal.offer_value)) },
    { id: 'price', label: 'Price', sort: 'price', numeric: true, render: (deal) => money(deal.target_price) },
    { id: 'gross', label: 'Gross', sort: 'gross', numeric: true, render: (deal) => (deal.needs_manual_terms ? '—' : pctShort(deal.gross_pct)) },
    { id: 'ann', label: 'Ann.', sort: 'ann', numeric: true, render: (deal) => (deal.needs_manual_terms ? '—' : pctShort(deal.ann_pct)) },
    {
      id: 'down',
      label: 'Down',
      sort: 'down',
      numeric: true,
      render: (deal) => <span className={styles.neg}>{pctShort(deal.downside_pct, 1)}</span>,
    },
    { id: 'implied', label: 'Impl. P', sort: 'implied_p', numeric: true, render: (deal) => pctShort(deal.implied_p, 0) },
    { id: 'close', label: 'Exp. close', sort: 'close', render: (deal) => closeLabel(deal) },
    {
      id: 'regs',
      label: 'Regulators',
      hideable: true,
      render: (deal) => (
        <span className={styles.flags}>
          {(deal.reg_flags || []).map((flag) => <em key={flag} className={styles.flag}>{flag}</em>)}
        </span>
      ),
    },
    { id: 'value', label: 'Value', sort: 'value', numeric: true, render: (deal) => compact(deal.deal_value_usd) },
    { id: 'sector', label: 'Sector', sort: 'sector', render: (deal) => deal.sector || '—' },
    {
      id: 'data',
      label: 'Data',
      sort: 'confidence',
      render: (deal) => {
        const n = deal.data_confidence
        const tone = n == null ? 'gray' : n >= 70 ? 'green' : n >= 40 ? 'amber' : 'red'
        return <i className={styles.dot} data-dot={tone} title={n == null ? 'n/a' : String(n)} />
      },
    },
  ], [])

  return (
    <div className={page.page}>
      {!dealId && (
        <header className={page.hero}>
          <div>
            <p className={page.kicker}>DGA Capital</p>
            <h1 className={page.h1}>Merger arbitrage</h1>
            <p className={page.sub}>One row per deal. Score, filters, and a terms drawer.</p>
          </div>
        </header>
      )}
      {err && <p className={styles.err}>{err}</p>}

      {!dealId && (
        <div className={selectedId ? styles.deskOpen : styles.desk}>
          <div className={styles.main}>
            <div className={styles.filters}>
              <input
                aria-label="Search ticker or name"
                placeholder="Search ticker or name"
                value={filterValue('q')}
                onChange={(event) => setFilter('q', event.target.value)}
              />
              <Chip
                label="Stage"
                value={filterValue('stage', DEFAULT_STAGE)}
                onChange={(value) => setFilter('stage', value)}
                options={[
                  { value: DEFAULT_STAGE, label: 'Screen, Watch, Active' },
                  { value: 'screen', label: 'Screen' },
                  { value: 'watch', label: 'Watch' },
                  { value: 'active', label: 'Active' },
                  { value: 'closed', label: 'Closed' },
                  { value: 'broken', label: 'Broken' },
                  { value: 'ignored', label: 'Ignored' },
                ]}
              />
              <Chip
                label="Type"
                value={filterValue('type')}
                onChange={(value) => setFilter('type', value)}
                options={[
                  { value: '', label: 'All' },
                  { value: 'cash', label: 'Cash only' },
                  { value: 'stock', label: 'Stock' },
                  { value: 'mixed', label: 'Cash and stock' },
                  { value: 'collar', label: 'Collar' },
                  { value: 'election', label: 'Election' },
                ]}
              />
              <Chip
                label="Size"
                value={filterValue('size')}
                onChange={(value) => setFilter('size', value)}
                options={[
                  { value: '', label: 'All' },
                  { value: 'lt500', label: '< $500M' },
                  { value: '0.5-2', label: '$0.5–2B' },
                  { value: '2-10', label: '$2–10B' },
                  { value: 'gt10', label: '> $10B' },
                ]}
              />
              <Chip
                label="Band"
                value={filterValue('band')}
                onChange={(value) => setFilter('band', value)}
                options={[
                  { value: '', label: 'All' },
                  { value: 'A', label: 'A' },
                  { value: 'B', label: 'B' },
                  { value: 'C', label: 'C' },
                  { value: 'D', label: 'D' },
                  { value: 'F', label: 'F' },
                  { value: 'NR', label: 'NR' },
                ]}
              />
              <Chip
                label="Close"
                value={filterValue('close')}
                onChange={(value) => setFilter('close', value)}
                options={[
                  { value: '', label: 'Any' },
                  { value: '30', label: '≤ 30d' },
                  { value: '30-90', label: '30–90d' },
                  { value: '90-180', label: '90–180d' },
                  { value: '180', label: '> 180d' },
                  { value: 'past', label: 'Past due' },
                ]}
              />
              <Chip
                label="View"
                value=""
                onChange={(value) => {
                  const found = VIEWS.find((item) => item.id === value)
                  if (!found) return
                  const next = new URLSearchParams()
                  Object.entries(found.params).forEach(([key, item]) => next.set(key, item))
                  if (selectedId) next.set('deal', selectedId)
                  setParams(next)
                }}
                options={[{ value: '', label: 'Saved views' }, ...VIEWS.map((item) => ({ value: item.id, label: item.label }))]}
              />
              <div className={styles.actions}>
                <ScanTools onScanned={() => void loadDeals()} />
                <Button size="sm" onClick={() => void loadWeights()}>Weights</Button>
                <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>+ Deal</Button>
              </div>
            </div>
            <DataTable
              rows={deals}
              columns={columns}
              rowKey={(deal) => deal.id}
              sort={filterValue('sort', '-score')}
              onSort={(sort) => setFilter('sort', sort)}
              selectedId={selectedId}
              onSelect={openDeal}
              hidden={hidden}
              onHiddenChange={(ids) => {
                setHidden(ids)
                localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids))
              }}
              empty={<Empty title="No deals" sub="Scan or add a deal. Screen, Watch, and Active are shown by default." />}
              footer={<p className={styles.muted}>{total} shown · sorted by Score · click a row for terms · ↑/↓ to move, Esc to close</p>}
            />
          </div>
          {selectedId && (
            <DealDrawer
              dealId={selectedId}
              onClose={() => setFilter('deal', '')}
              onChanged={() => void loadDeals()}
            />
          )}
        </div>
      )}

      {addOpen && (
        <div className={styles.modal} role="dialog" aria-label="Add a deal">
          <div className={styles.modalCard}>
            <h2>Add a deal</h2>
            <div className={styles.form}>
              <input aria-label="Target ticker" placeholder="Target ticker" value={form.target_ticker} onChange={(e) => setForm({ ...form, target_ticker: e.target.value })} />
              <input aria-label="Acquirer ticker" placeholder="Acquirer ticker" value={form.acquirer_ticker} onChange={(e) => setForm({ ...form, acquirer_ticker: e.target.value })} />
              <input aria-label="Target name" placeholder="Target name" value={form.target_name} onChange={(e) => setForm({ ...form, target_name: e.target.value })} />
              <input aria-label="Acquirer name" placeholder="Acquirer name" value={form.acquirer_name} onChange={(e) => setForm({ ...form, acquirer_name: e.target.value })} />
            </div>
            <div className={styles.toolbar}>
              <Button variant="primary" size="sm" disabled={busy === 'deal'} onClick={() => void createDeal()}>Add</Button>
              <Button size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {weightsOpen && (
        <div className={styles.modal} role="dialog" aria-label="Score weights">
          <div className={styles.modalCard}>
            <h2>Score weights</h2>
            <p className={styles.muted}>Must sum to 100.</p>
            <div className={styles.form}>
              {Object.keys(weights).map((name) => (
                <label key={name} className={styles.chip}>
                  {name}
                  <input
                    aria-label={name}
                    type="number"
                    value={weights[name]}
                    onChange={(event) => setWeights({ ...weights, [name]: Number(event.target.value) })}
                  />
                </label>
              ))}
            </div>
            <div className={styles.toolbar}>
              <Button variant="primary" size="sm" disabled={busy === 'weights'} onClick={() => void saveWeights()}>Save</Button>
              <Button size="sm" onClick={() => setWeightsOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
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
