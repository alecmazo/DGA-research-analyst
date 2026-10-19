import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Empty } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './MergerArbPage.module.css'
import { ScanTools, type ScanAlert } from './DealScan'
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

const FILTER_KEYS = ['q', 'stage', 'type', 'sector', 'size', 'ann_min', 'band', 'regulatory', 'close', 'sort'] as const
const DEFAULT_STAGE = 'screen,watch,active'
const VIEWS = [
  { id: 'best', label: 'Best risk-adjusted', params: { stage: DEFAULT_STAGE, sort: '-score' } },
  { id: 'soon', label: 'Closing soon', params: { close: '30', sort: 'close' } },
  { id: 'reg', label: 'Regulatory watch', params: { regulatory: '2R,CFIUS' } },
  { id: 'new', label: 'New from scan', params: { stage: 'screen', sort: '-score' } },
]
const HIDDEN_KEY = 'merger-arb-hidden-cols'

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
  const [params, setParams] = useSearchParams()
  const [deals, setDeals] = useState<Deal[]>([])
  const [total, setTotal] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ target_ticker: '', acquirer_ticker: '', target_name: '', acquirer_name: '' })
  const [addOpen, setAddOpen] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [alertDealIds, setAlertDealIds] = useState<Set<string>>(new Set())
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

  const onAlerts = useCallback((alerts: ScanAlert[]) => {
    setAlertDealIds(new Set(alerts.map((row) => row.desk_deal_id || '').filter(Boolean)))
  }, [])

  useEffect(() => {
    setErr('')
    loadDeals().catch((e) => setErr(e instanceof Error ? e.message : 'Could not load deals'))
  }, [loadDeals])

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
          {alertDealIds.has(deal.id) ? <i className={styles.alertPip} title="Open alert" /> : null}
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
  ], [alertDealIds])

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>DGA Capital</p>
          <h1 className={page.h1}>Merger arbitrage</h1>
          <p className={page.sub}>One row per deal. Score, filters, and a terms drawer.</p>
        </div>
      </header>
      {err && <p className={styles.err}>{err}</p>}

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
              <ScanTools onScanned={() => void loadDeals()} onAlerts={onAlerts} />
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
    </div>
  )
}
