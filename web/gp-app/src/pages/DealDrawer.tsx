import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from './MergerArbPage.module.css'

type ScoreComponent = {
  score?: number | null
  weight?: number
  contribution?: number | null
  available?: boolean
}

type Deal = {
  id: string
  target_ticker?: string
  target_name?: string
  acquirer_ticker?: string
  acquirer_name?: string
  stage?: string
  deal_type?: string
  score?: number | null
  score_band?: string
  offer_value?: number | null
  stated_cash?: number | null
  stated_ratio?: number | null
  target_price?: number | null
  gross_pct?: number | null
  ann_pct?: number | null
  downside_pct?: number | null
  implied_p?: number | null
  days_to_close?: number | null
  needs_manual_terms?: boolean
  acquirer_price_sensitive?: boolean
  metrics?: Record<string, unknown>
}

type Field = {
  field_name?: string
  value?: unknown
  source_name?: string
  source_url?: string
  is_current?: boolean
  conflict?: boolean
}

type AnalysisRow = {
  id: string
  label: string
  display: string
  value?: unknown
  unverified?: boolean
}

type AnalysisView = {
  empty?: boolean
  sections?: { id: string; rows: AnalysisRow[]; blocks: { rows: AnalysisRow[] }[] }[]
  stage1_notes?: { text: string; field_ids: string[] }[]
  versions?: { version: number; stage: string; model: string; created_at_pt: string; diff: { id: string; before: unknown; after: unknown }[] }[]
  answer?: string
  answer_note?: string
  citations?: string[]
  escalate?: boolean
}

type Detail = {
  deal?: Deal
  terms?: Record<string, unknown>
  metrics?: Record<string, unknown>
  score?: {
    score?: number | null
    score_band?: string
    coverage?: number
    components?: Record<string, ScoreComponent>
    house_source?: string
  }
  fields?: Field[]
  regulatory?: { regulator?: string; stage?: string; filed_on?: string }[]
  events?: { kind?: string; expected_on?: string; actual_on?: string }[]
  spread_history?: { d?: string; gross_pct?: number }[]
  filings?: { title?: string; url?: string; source_name?: string }[]
}

const STAGES = ['screen', 'watch', 'active', 'closed', 'broken', 'ignored']
const SCORE_ORDER = ['return', 'risk_reward', 'edge', 'regulatory', 'financing', 'timeline', 'quality', 'optionality']
const SCORE_LABEL: Record<string, string> = {
  return: 'Return',
  risk_reward: 'Risk / reward',
  edge: 'Edge vs implied P',
  regulatory: 'Regulatory',
  financing: 'Financing',
  timeline: 'Timeline',
  quality: 'Deal quality',
  optionality: 'Optionality',
}

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function pct(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return '—'
  const shown = Math.abs(value) <= 1.5 ? value * 100 : value
  return `${shown.toFixed(digits)}%`
}

function signed(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  const shown = Math.abs(value) <= 1.5 ? value * 100 : value
  const prefix = shown > 0 ? '+' : ''
  return `${prefix}${shown.toFixed(1)}%`
}

function analysisRows(view: AnalysisView | null, sectionId: string): AnalysisRow[] {
  const card = (view?.sections || []).find((item) => item.id === sectionId)
  if (!card) return []
  const blocks = card.blocks || []
  return [...(card.rows || []), ...blocks.flatMap((block) => block.rows || [])]
}

function Sensitivity({ value }: { value: unknown }) {
  if (!Array.isArray(value) || !value.length) return null
  const table = value as { downside?: string; close?: string; implied_probability?: number | null; annualized?: number | null }[]
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Downside</th>
          <th>Close</th>
          <th>Implied P</th>
          <th>Ann.</th>
        </tr>
      </thead>
      <tbody>
        {table.map((item, index) => (
          <tr key={`${item.downside}-${item.close}-${index}`}>
            <td>{item.downside}</td>
            <td>{item.close}</td>
            <td>{pct(item.implied_probability, 1)}</td>
            <td>{pct(item.annualized, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DealDrawer({
  dealId,
  onClose,
  onChanged,
}: {
  dealId: string
  onClose: () => void
  onChanged?: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [provider, setProvider] = useState<'grok' | 'claude'>('grok')
  const [question, setQuestion] = useState('')

  const load = useCallback(async () => {
    const [dealBody, analysisBody] = await Promise.all([
      api<Detail>(`/api/merger-arb/deals/${encodeURIComponent(dealId)}`),
      api<AnalysisView>(`/api/merger-arb/analysis/${encodeURIComponent(dealId)}`).catch(() => ({ empty: true } as AnalysisView)),
    ])
    return { dealBody, analysisBody }
  }, [dealId])

  useEffect(() => {
    let cancelled = false
    setErr('')
    setQuestion('')
    load()
      .then((data) => {
        if (cancelled) return
        setDetail(data.dealBody)
        setAnalysis(data.analysisBody)
        setErr('')
      })
      .catch((error) => {
        if (!cancelled) setErr(error instanceof Error ? error.message : 'Could not load the deal')
      })
    return () => {
      cancelled = true
    }
  }, [dealId, load])

  const patchStage = async (stage: string) => {
    setBusy('stage')
    try {
      await api(`/api/merger-arb/deals/${encodeURIComponent(dealId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      })
      const data = await load()
      setDetail(data.dealBody)
      setAnalysis(data.analysisBody)
      onChanged?.()
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not update stage')
    } finally {
      setBusy('')
    }
  }

  const run = async (path: string, body: unknown, label: string) => {
    setBusy(label)
    setErr('')
    try {
      const data = await api<AnalysisView>(path, { method: 'POST', body: JSON.stringify(body) })
      setAnalysis(data)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'That step failed')
    } finally {
      setBusy('')
    }
  }

  const confirm = (fieldId: string) => {
    void run(`/api/merger-arb/analysis/${encodeURIComponent(dealId)}/confirm`, { field_id: fieldId }, 'confirm')
  }

  const exportPacket = async (format: 'md' | 'json') => {
    setBusy('export')
    try {
      const data = await api<{ body?: string; filename?: string }>(
        `/api/merger-arb/analysis/${encodeURIComponent(dealId)}/export?format=${format}`,
      )
      const blob = new Blob([data.body || ''], { type: format === 'json' ? 'application/json' : 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = data.filename || `merger-arb.${format}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setBusy('')
    }
  }

  const deal = detail?.deal
  const metrics = detail?.metrics || deal?.metrics || {}
  const score = detail?.score || {}
  const components = score.components || {}
  const history = detail?.spread_history || []
  const points = history.map((row) => Number(row.gross_pct) || 0)
  const min = Math.min(...points, 0)
  const max = Math.max(...points, 0.01)
  const path = points.map((value, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 120
    const y = 28 - ((value - min) / (max - min || 1)) * 24
    return `${x},${y}`
  }).join(' ')
  const sensitivity = analysisRows(analysis, 'spread').find((row) => row.id === 'spread.sensitivity')
  const unverified = (analysis?.sections || []).flatMap((card) => [
    ...(card.rows || []),
    ...(card.blocks || []).flatMap((block) => block.rows || []),
  ]).filter((row) => row.unverified)

  return (
    <aside className={styles.side} aria-label="Deal terms">
      <header className={styles.sideHead}>
        <div>
          <p className={styles.sideKicker}>
            {(deal?.deal_type || 'deal').replace('_', ' ')} · {(deal?.stage || 'screen')}
            {deal?.score_band ? ` · ${deal.score_band} ${deal.score ?? ''}` : ''}
          </p>
          <h2>
            {deal?.target_ticker || dealId}
            <span> / {deal?.acquirer_ticker || deal?.acquirer_name || '—'}</span>
          </h2>
          <p className={styles.muted}>
            {deal?.target_name} ← {deal?.acquirer_name}
            {deal?.acquirer_price_sensitive ? ' · acquirer-price sensitive' : ''}
            {deal?.needs_manual_terms ? ' · terms needed' : ''}
          </p>
        </div>
        <Button size="sm" onClick={onClose}>Close</Button>
      </header>
      {err && <p className={styles.err}>{err}</p>}
      <div className={styles.toolbar}>
        <label className={styles.chip}>
          Stage
          <select aria-label="Stage" value={deal?.stage || 'screen'} disabled={busy === 'stage'} onChange={(event) => void patchStage(event.target.value)}>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>{stage}</option>
            ))}
          </select>
        </label>
        <label className={styles.chip}>
          Deep dive
          <select aria-label="Deep dive model" value={provider} onChange={(event) => setProvider(event.target.value as 'grok' | 'claude')}>
            <option value="grok">Grok</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void run(`/api/merger-arb/analysis/${encodeURIComponent(dealId)}/deep-dive`, { provider }, 'deep')}>
          {busy === 'deep' ? 'Running…' : 'Deep dive'}
        </Button>
        <Button size="sm" disabled={!!busy || !!analysis?.empty} onClick={() => void run(`/api/merger-arb/analysis/${encodeURIComponent(dealId)}/refresh`, {}, 'refresh')}>
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh (local)'}
        </Button>
        <Button size="sm" disabled={!!busy || !!analysis?.empty} onClick={() => void exportPacket('md')}>MD</Button>
        <Button size="sm" disabled={!!busy || !!analysis?.empty} onClick={() => void exportPacket('json')}>JSON</Button>
      </div>
      <p className={styles.muted}>Deep dive runs only when you click it, on {provider === 'grok' ? 'Grok' : 'Claude'}. Refresh stays on the local model.</p>
      <div className={styles.strip}>
        <div><span>Offer</span><strong>{deal?.offer_value != null ? money(deal.offer_value) : deal?.stated_cash != null ? money(deal.stated_cash) : deal?.stated_ratio != null ? `${deal.stated_ratio}×` : '—'}</strong></div>
        <div><span>Price</span><strong>{money(deal?.target_price)}</strong></div>
        <div><span>Gross</span><strong>{pct(deal?.gross_pct)}</strong></div>
        <div><span>Net ann.</span><strong>{pct(deal?.ann_pct)}</strong></div>
        <div><span>Downside</span><strong className={styles.neg}>{signed(deal?.downside_pct)}</strong></div>
        <div><span>Impl. P</span><strong>{pct(deal?.implied_p, 0)}</strong></div>
        <div><span>Days</span><strong>{deal?.days_to_close ?? '—'}</strong></div>
        <div>
          <span>vs T-bill</span>
          <strong>{metrics.excess_ann_pct != null ? signed(Number(metrics.excess_ann_pct)) : '—'}</strong>
        </div>
      </div>
      <section>
        <h3>Scorecard</h3>
        <p className={styles.muted}>
          {score.score ?? 'NR'} · {score.score_band || 'NR'} · coverage {Math.round((score.coverage || 0) * 100)}%
        </p>
        <ul className={styles.scoreList}>
          {SCORE_ORDER.map((name) => {
            const row = components[name] || {}
            const width = Math.max(0, Math.min(100, Number(row.score) || 0))
            return (
              <li key={name}>
                <span>{SCORE_LABEL[name] || name}</span>
                <i style={{ width: `${width}%` }} />
                <em>{row.available === false ? '—' : row.score ?? '—'}</em>
                <small>×{row.weight ?? 0}</small>
              </li>
            )
          })}
        </ul>
      </section>
      <section>
        <h3>Terms</h3>
        <dl className={styles.terms}>
          {Object.entries(detail?.terms || {}).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/_/g, ' ')}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
          {!Object.keys(detail?.terms || {}).length && <p className={styles.muted}>No terms stored.</p>}
        </dl>
      </section>
      {unverified.length > 0 && (
        <section>
          <h3>Confirm</h3>
          <ul className={styles.rows}>
            {unverified.map((row) => (
              <li key={row.id}>
                <strong>{row.label}</strong>
                <span className={styles.meta}>{row.display}</span>
                <Button size="sm" onClick={() => confirm(row.id)}>Confirm</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Regulatory</h3>
        <ul className={styles.rows}>
          {(detail?.regulatory || []).map((row) => (
            <li key={row.regulator}>
              <strong>{row.regulator}</strong>
              <span className={styles.meta}>{row.stage || '—'} {row.filed_on ? `· filed ${row.filed_on}` : ''}</span>
            </li>
          ))}
          {!detail?.regulatory?.length && <li className={styles.muted}>None stored.</li>}
        </ul>
      </section>
      <section>
        <h3>Timeline</h3>
        <ul className={styles.rows}>
          {(detail?.events || []).map((row, index) => (
            <li key={`${row.kind}-${index}`}>
              <strong>{row.kind}</strong>
              <span className={styles.meta}>{row.actual_on || row.expected_on || '—'}</span>
            </li>
          ))}
          {!detail?.events?.length && <li className={styles.muted}>No events yet.</li>}
        </ul>
      </section>
      <section>
        <h3>Spread history</h3>
        {points.length > 1 ? (
          <svg viewBox="0 0 120 32" className={styles.spark} aria-hidden>
            <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={path} />
          </svg>
        ) : (
          <p className={styles.muted}>Not enough daily snapshots.</p>
        )}
      </section>
      {sensitivity && (
        <section>
          <h3>Sensitivity</h3>
          <Sensitivity value={sensitivity.value} />
        </section>
      )}
      <section>
        <h3>Filings</h3>
        <ul className={styles.rows}>
          {(detail?.filings || []).map((row) => (
            <li key={row.url}>
              {row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.source_name || row.title || 'Filing'}</a> : (row.title || '—')}
            </li>
          ))}
          {!detail?.filings?.length && <li className={styles.muted}>None linked.</li>}
        </ul>
      </section>
      <section>
        <h3>Sources</h3>
        <ul className={styles.rows}>
          {(detail?.fields || []).filter((field) => field.is_current !== false).map((field, index) => (
            <li key={`${field.field_name}-${index}`}>
              <strong>{field.field_name}</strong>
              <span className={styles.meta}>
                {String(field.value ?? '—')}
                {field.conflict ? ' · conflict' : ''}
                {field.source_url ? (
                  <> · <a href={field.source_url} target="_blank" rel="noreferrer">{field.source_name || 'Source'}</a></>
                ) : field.source_name ? ` · ${field.source_name}` : ''}
              </span>
            </li>
          ))}
          {!detail?.fields?.length && <li className={styles.muted}>No field sources.</li>}
        </ul>
      </section>
      <section>
        <h3>Ask</h3>
        <textarea
          aria-label="Follow-up"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          placeholder="Ask from this packet only"
        />
        <Button size="sm" variant="primary" disabled={!!busy || question.trim().length < 4 || !!analysis?.empty} onClick={() => void run(`/api/merger-arb/analysis/${encodeURIComponent(dealId)}/ask`, { question }, 'ask')}>
          Ask
        </Button>
        {analysis?.answer && <p>{analysis.answer}</p>}
        {analysis?.citations?.length ? <p className={styles.meta}>Cites {analysis.citations.join(', ')}</p> : null}
        {analysis?.answer_note && <p className={styles.warn}>{analysis.answer_note}</p>}
        {analysis?.escalate && (
          <Button size="sm" onClick={() => void run(`/api/merger-arb/analysis/${encodeURIComponent(dealId)}/deep-dive`, { provider }, 'deep')}>
            Escalate to deep dive
          </Button>
        )}
      </section>
      {analysis?.stage1_notes?.length ? (
        <section>
          <h3>Deep dive notes</h3>
          <ul className={styles.rows}>
            {analysis.stage1_notes.map((note) => (
              <li key={note.text}>{note.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3>Versions</h3>
        <ul className={styles.rows}>
          {(analysis?.versions || []).map((item) => (
            <li key={`${item.version}-${item.stage}`}>
              <strong>v{item.version}</strong>
              <span className={styles.meta}>{item.stage} · {item.model} · {item.created_at_pt}</span>
            </li>
          ))}
          {!analysis?.versions?.length && <li className={styles.muted}>No packet versions.</li>}
        </ul>
      </section>
    </aside>
  )
}
