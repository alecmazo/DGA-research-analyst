import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import styles from './MergerArbPage.module.css'

type ScoreComponent = {
  score?: number | null
  weight?: number
  contribution?: number | null
  available?: boolean
  input?: Record<string, unknown>
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

type Detail = {
  deal?: Deal
  terms?: Record<string, unknown>
  metrics?: Record<string, unknown>
  score?: {
    score?: number | null
    score_band?: string
    coverage?: number
    components?: Record<string, ScoreComponent>
    p_house?: number
    house_source?: string
  }
  fields?: Field[]
  regulatory?: { regulator?: string; stage?: string; filed_on?: string; deadline?: string }[]
  events?: { kind?: string; expected_on?: string; actual_on?: string }[]
  spread_history?: { d?: string; gross_pct?: number; implied_p?: number }[]
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
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    setErr('')
    api<Detail>(`/api/merger-arb/deals/${encodeURIComponent(dealId)}`)
      .then(setDetail)
      .catch((error) => setErr(error instanceof Error ? error.message : 'Could not load the deal'))
  }, [dealId])

  const patchStage = async (stage: string) => {
    setBusy('stage')
    try {
      await api(`/api/merger-arb/deals/${encodeURIComponent(dealId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      })
      const next = await api<Detail>(`/api/merger-arb/deals/${encodeURIComponent(dealId)}`)
      setDetail(next)
      onChanged?.()
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Could not update stage')
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
      <label className={styles.stagePick}>
        Stage
        <select
          aria-label="Stage"
          value={deal?.stage || 'screen'}
          disabled={busy === 'stage'}
          onChange={(event) => void patchStage(event.target.value)}
        >
          {STAGES.map((stage) => (
            <option key={stage} value={stage}>{stage}</option>
          ))}
        </select>
      </label>
      <div className={styles.strip}>
        <div><span>Offer</span><strong>{money(deal?.offer_value)}</strong></div>
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
          {score.house_source === 'override' ? ' · house P override' : ''}
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
    </aside>
  )
}
