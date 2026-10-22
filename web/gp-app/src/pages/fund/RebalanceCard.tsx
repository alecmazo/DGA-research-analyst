import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { loadEngine, pollAgenticJob, type AgenticResult } from '@/lib/agentic'
import {
  navigateResearchWindow,
  openPendingResearchWindow,
  openResearchWindow,
  writeResearchSeed,
} from '@/lib/openResearch'
import styles from './fund.module.css'

const ENGINE_KEY = 'dga.strategist.engine.v2'

type ReviewRef = {
  id: string
  fund_id?: string | null
  fund_name?: string
  tickers?: string
  generated_at?: string
  model?: string
}

type CommitteeRow = {
  ticker?: string
  current_pct?: number
  suggested_pct?: number
  action?: string
  why?: string
  downside?: string
}

type CommitteePayload = {
  ok?: boolean
  source?: string
  job_id?: string
  review_id?: string | null
  status?: string
  fund_name?: string
  run_at?: string
  rows?: CommitteeRow[]
  reviews?: ReviewRef[]
  detail?: string
  error?: string
  result?: AgenticResult & { suggestions?: CommitteeRow[] }
}

type Props = {
  fundId: string
  fundName?: string
}

function actionLabel(action?: string) {
  if (action === 'add') return 'Add'
  if (action === 'trim') return 'Trim'
  return 'Hold'
}

function stamp(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ')
  return d.toLocaleString()
}

export function RebalanceCard({ fundId, fundName }: Props) {
  const [rows, setRows] = useState<CommitteeRow[]>([])
  const [reviews, setReviews] = useState<ReviewRef[]>([])
  const [runAt, setRunAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [saved, archive] = await Promise.all([
      api<CommitteePayload>(
        `/api/v2/gp/fund/${encodeURIComponent(fundId)}/rebalance`,
      ).catch(() => null),
      api<{ reviews?: ReviewRef[] }>(
        `/api/research/strategist/reviews?fund_id=${encodeURIComponent(fundId)}`,
      ).catch(() => ({ reviews: [] as ReviewRef[] })),
    ])
    const committee = saved?.source === 'committee' ? saved : null
    if (committee?.rows) setRows(committee.rows)
    else setRows([])
    setRunAt(committee?.run_at || null)
    const byId = new Map<string, ReviewRef>()
    for (const rv of committee?.reviews || []) {
      if (rv?.id) byId.set(rv.id, rv)
    }
    for (const rv of archive.reviews || []) {
      if (rv?.id && rv.fund_id === fundId) byId.set(rv.id, rv)
    }
    const list = [...byId.values()].sort((a, b) =>
      (b.generated_at || '').localeCompare(a.generated_at || ''),
    )
    setReviews(list)
  }, [fundId])

  useEffect(() => {
    void load()
  }, [load])

  const openReview = (id: string) => {
    const opened = openResearchWindow('strategist', id, {
      title: 'Investment Committee Review',
      fund_name: fundName,
    })
    if (!opened) setErr('Allow windows for this site, then open the report again.')
    else setErr(null)
  }

  const run = async () => {
    const engine = loadEngine(ENGINE_KEY, 'grok')
    const hint = fundName || 'this book'
    const win = openPendingResearchWindow('strategist', hint, engine)
    setBusy(true)
    setErr(null)
    setStatus('Starting the committee review…')
    let startedId: string | null = null
    try {
      const started = await api<CommitteePayload>(
        `/api/v2/gp/fund/${encodeURIComponent(fundId)}/rebalance`,
        {
          method: 'POST',
          body: JSON.stringify({ llm_provider: engine }),
        },
      )
      if (!started.ok || started.source !== 'committee' || !started.job_id) {
        throw new Error(
          started.detail ||
            started.error ||
            'Committee review did not start on this server.',
        )
      }
      startedId = started.job_id
      const name = started.fund_name || fundName || hint
      navigateResearchWindow(win, 'strategist', started.job_id, {
        title: 'Investment Committee Review',
        fund_name: name,
        question: name,
      })
      if (started.status === 'done' && started.rows) {
        setRows(started.rows)
        setRunAt(new Date().toISOString())
      } else {
        const res = await pollAgenticJob(
          started.job_id,
          (j) => setStatus(j.label || 'Committee review running…'),
          { maxMs: 24 * 60 * 1000, intervalMs: 1400 },
        )
        const suggestions = (res as { suggestions?: CommitteeRow[] }).suggestions
        if (suggestions?.length) setRows(suggestions)
        const seed = {
          title: 'Investment Committee Review',
          fund_name: name,
          answer: res.answer,
          model: res.model,
          cost_usd: res.cost_usd,
          verification: res.verification,
        }
        writeResearchSeed('strategist', started.job_id, seed)
        if (!win || win.closed) openResearchWindow('strategist', started.job_id, seed)
      }
      setStatus(null)
      await load()
    } catch (e) {
      if (!startedId && win && !win.closed) {
        try {
          win.close()
        } catch {
          /* ignore */
        }
      }
      setStatus(null)
      setErr(e instanceof Error ? e.message : 'Committee review failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Rebalance Suggestions"
      collapsible
      badge={rows.length || undefined}
      action={
        <button
          type="button"
          className={styles.runRebalance}
          disabled={busy}
          onClick={() => void run()}
        >
          <span className={styles.runGlyph} aria-hidden />
          {busy ? 'Running' : 'Run'}
        </button>
      }
      flush
    >
      <div className={styles.rebBody}>
        {!rows.length ? (
          <div className={styles.pad}>
            <p className={styles.hint}>
              Run opens a full investment-committee review of this book.
              Suggested weights follow each saved thesis, with a smaller size
              where the outcome is binary or the thesis is not on file.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.rebMeta}>
              Committee sizing
              {runAt ? <span className={styles.hint}> · {stamp(runAt)}</span> : null}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Action</th>
                    <th className="tabular">Weight</th>
                    <th>Why</th>
                    <th>Downside</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ticker}>
                      <td className={styles.tk}>{row.ticker}</td>
                      <td>{actionLabel(row.action)}</td>
                      <td className={`tabular ${styles.nowrap}`}>
                        {(row.current_pct || 0).toFixed(1)}% →{' '}
                        <strong>{(row.suggested_pct || 0).toFixed(1)}%</strong>
                      </td>
                      <td className={styles.why}>{row.why || '—'}</td>
                      <td className={styles.why}>{row.downside || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {status && <p className={styles.rebStatus}>{status}</p>}
        {err && <p className={styles.rebErr}>{err}</p>}
        <div className={styles.revBlock}>
          <div className={styles.revHead}>
            Committee reports ({reviews.length})
          </div>
          {!reviews.length ? (
            <p className={styles.hint}>
              The full committee report for this book is saved here after a run.
            </p>
          ) : (
            reviews.map((rv) => (
              <div key={rv.id} className={styles.revRow}>
                <div>
                  <div className={styles.revTitle}>{rv.fund_name || fundName || 'Portfolio'}</div>
                  <div className={styles.revMeta}>
                    {(rv.tickers || '').split(',').slice(0, 6).join(', ')}
                    {stamp(rv.generated_at) ? ` · ${stamp(rv.generated_at)}` : ''}
                  </div>
                </div>
                <Button size="sm" onClick={() => openReview(rv.id)}>
                  Open
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </Panel>
  )
}
