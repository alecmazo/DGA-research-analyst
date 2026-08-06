import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import {
  AGENT_ENGINES,
  engLabel,
  loadEngine,
  pollAgenticJob,
  researchPdfDownload,
  researchPdfEmail,
  saveEngine,
  type AgentEngine,
  type AgenticJob,
  type AgenticResult,
} from '@/lib/agentic'
import { renderMd } from '@/lib/md'
import styles from './deskWidgets.module.css'

const ENGINE_KEY = 'dga.agentic.engine.v1'

const EXAMPLES = [
  'Which of my covered names moved most today and why?',
  'Summarize the bull vs bear case on NVDA from our reports.',
  'Any fresh catalysts across my coverage this week?',
  'Compare the ANAT IRA and taxable accounts and suggest how to optimize the IRA.',
]

const RETIREE_PRESET = `Analyze the [ANAT IRA] account for Anatoly, a 69-year-old retiree living off this portfolio. Call list_portfolios then get_portfolio_holdings to pull the actual positions, weights, sectors, and unrealized P&L — don't guess.

Diagnose it for a retiree in the withdrawal phase, with numbers: (1) concentration risk — any oversized position or sector and the drawdown that mix could take; (2) how much sits in high-volatility names; (3) current dividend income, plus where covered calls / cash-secured puts could add income (use scan_wheel on the larger liquid holdings); (4) cross-check the biggest holdings against my saved research price targets and flag anything well above target to trim.

Then propose a target sector sleeve suited to a 69-year-old whose priorities are, in order: capital preservation and limiting max drawdown, durable income to fund ~4%/yr withdrawals, then beating the S&P 500 on a risk-adjusted basis. Favor quality dividend-payers and defensives, cap any single sector, and keep liquidity for withdrawals. This is an IRA, so rebalancing taxes don't matter, but RMDs begin at age 73.

End with the sleeve block at this account's real market value so I can push it to the Builder.`

type ReviewRow = {
  id: string
  question?: string
  model?: string
  generated_at?: string
  cost_usd?: number
}

type Props = { bare?: boolean }

export function AnalystCard({ bare = false }: Props) {
  const [engine, setEngine] = useState<AgentEngine>(() => loadEngine(ENGINE_KEY, 'claude'))
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [progress, setProgress] = useState<AgenticJob | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<AgenticResult | null>(null)
  const [lastQ, setLastQ] = useState('')
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)

  const pickEngine = (e: AgentEngine) => {
    setEngine(e)
    saveEngine(ENGINE_KEY, e)
  }

  const loadReviews = useCallback(async () => {
    try {
      const d = await api<{ reviews?: ReviewRow[] }>(
        '/api/research/analyst/reviews?source=analyst',
      )
      setReviews(d.reviews || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  const run = async () => {
    const q = question.trim()
    if (q.length < 4) {
      setErr('Ask a real question.')
      return
    }
    setErr(null)
    setResult(null)
    setLastQ(q)
    setBusy(true)
    setProgress({ status: 'running', label: `Starting · ${engLabel(engine)}…`, steps: 0 })
    setElapsed(0)
    try {
      const d0 = await api<{ ok?: boolean; job_id?: string; error?: string }>(
        '/api/research/agentic',
        {
          method: 'POST',
          body: JSON.stringify({ question: q, llm_provider: engine, source: 'analyst' }),
        },
      )
      if (!d0.ok || !d0.job_id) throw new Error(d0.error || 'Failed to start')
      const res = await pollAgenticJob(d0.job_id, (j, ms) => {
        setProgress(j)
        setElapsed(ms)
      })
      setResult(res)
      setProgress(null)
      window.setTimeout(() => void loadReviews(), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Analyst failed')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  const openReview = async (id: string) => {
    try {
      const d = await api<{ ok?: boolean; review?: AgenticResult & { question?: string } }>(
        `/api/research/analyst/reviews/${encodeURIComponent(id)}`,
      )
      if (!d.review) throw new Error('not found')
      setLastQ(d.review.question || '')
      setResult(d.review)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open analysis')
    }
  }

  const deleteReview = async (id: string) => {
    if (!window.confirm('Delete this saved analysis?')) return
    try {
      await api(`/api/research/analyst/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
      void loadReviews()
    } catch {
      /* ignore */
    }
  }

  const answerHtml = result?.answer ? renderMd(result.answer) : ''

  const exportPdf = async () => {
    if (!result?.answer) return
    try {
      await researchPdfDownload({
        title: 'Analyst',
        question: lastQ,
        answer_html: answerHtml,
      })
    } catch (e) {
      alert('PDF failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const emailPdf = async () => {
    if (!result?.answer) return
    const def = getCachedUser()?.email || ''
    const to = window.prompt('Email this PDF to (LP or yourself):', def)
    if (!to) return
    try {
      const d = await researchPdfEmail({
        title: 'Analyst',
        question: lastQ,
        answer_html: answerHtml,
        to,
      })
      if (!d.ok) throw new Error(d.detail || 'Send failed')
      alert('✉ Sent to ' + to)
    } catch (e) {
      alert('Email failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const draftMemo = async () => {
    if (!result?.answer) return
    const v = result.verification
    if (v?.verdict === 'flags' && (v.flags || []).length) {
      if (
        !window.confirm(
          `⚠ Verification flagged ${v.flags!.length} claim(s). Draft memo for LPs anyway?`,
        )
      )
        return
    }
    const title = window.prompt('Memo title:', (lastQ || 'Research Memo').slice(0, 70))
    if (title === null) return
    try {
      const d = await api<{ ok?: boolean; detail?: string; error?: string }>(
        '/api/memos/from-analysis',
        {
          method: 'POST',
          body: JSON.stringify({
            question: lastQ,
            answer: result.answer,
            title: (title || '').trim(),
          }),
        },
      )
      if (!d.ok) throw new Error(d.detail || d.error || 'Failed')
      alert('✓ Memo saved — open the Memos tab to assign & email.')
    } catch (e) {
      alert('Memo draft failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const applyRetiree = () => {
    setQuestion(RETIREE_PRESET)
    window.setTimeout(() => {
      const el = taRef.current
      if (!el) return
      el.focus()
      const token = '[ANAT IRA]'
      const i = RETIREE_PRESET.indexOf(token)
      if (i >= 0) {
        try {
          el.setSelectionRange(i, i + token.length)
        } catch {
          /* ignore */
        }
      }
    }, 30)
  }

  const secs = Math.round(elapsed / 1000)
  const tools = (progress?.tool_calls || result?.tool_calls || []).slice(-10)

  return (
    <div className={`${styles.agentBody} ${bare ? styles.heroBare : ''}`}>
      <p className={styles.agentHint}>
        Multi-step research over live quotes, saved reports, news, and your books.
        <strong> ~$0.05–0.30</strong> by engine.
      </p>

      <div className={styles.agentToolbar}>
        <span className={styles.metaLabel}>Engine</span>
        <span className={styles.seg} role="group" aria-label="Analyst engine">
          {AGENT_ENGINES.map((e) => (
            <button
              key={e.id}
              type="button"
              title={e.title}
              className={`${styles.segBtn} ${engine === e.id ? styles.segActive : ''}`}
              onClick={() => pickEngine(e.id)}
              disabled={busy}
            >
              {e.label}
            </button>
          ))}
        </span>
        <span className={styles.engineTag}>{engLabel(engine)}</span>
        <span className={styles.costHint}>Multi-step · ~$0.05–0.30</span>
      </div>

      <div className={styles.compose}>
        <textarea
          ref={taRef}
          className={styles.composeTa}
          rows={3}
          placeholder="Ask a research question — e.g. Compare NVDA and AMD on valuation and catalysts using our saved reports."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void run()}>
          {busy ? `⏳ ${engLabel(engine)}…` : 'Analyze'}
        </Button>
      </div>

      <div className={styles.chips}>
        <button type="button" className={styles.presetPrimary} onClick={applyRetiree} disabled={busy}>
          Retiree portfolio build
        </button>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className={styles.chip}
            disabled={busy}
            onClick={() => {
              setQuestion(ex)
              taRef.current?.focus()
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {err && <div className={styles.err}>❌ {err}</div>}

      {progress && !result && (
        <div className={styles.progress}>
          <div className={styles.progressHead}>
            <span className={styles.spinDot} />
            <span className={styles.progressLabel}>{progress.label || 'Working…'}</span>
            <span className={styles.progressMeta}>
              {progress.steps || 0} steps
              {progress.cost_usd != null ? ` · $${Number(progress.cost_usd).toFixed(3)}` : ''}
              {secs ? ` · ${secs}s` : ''}
            </span>
          </div>
          {tools.length > 0 && (
            <div>
              {tools.map((tc, i) => (
                <div key={i} className={styles.toolLine}>
                  🔧 <strong>{tc.tool}</strong>{' '}
                  <code>
                    {tc.input ? JSON.stringify(tc.input).slice(0, 50) : ''}
                  </code>
                </div>
              ))}
            </div>
          )}
          {secs > 180 && (
            <div className={styles.muted} style={{ marginTop: 8, fontStyle: 'italic' }}>
              Heavy multi-step analysis — still working…
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={styles.result}>
          <div
            className={styles.md}
            dangerouslySetInnerHTML={{ __html: answerHtml }}
          />
          {result.verification?.verdict === 'clean' && (
            <div className={styles.verifyOk}>
              ✓ Verification pass: every numeric claim is backed by a tool call.
            </div>
          )}
          {result.verification?.verdict === 'flags' && (
            <div className={styles.verifyWarn}>
              <strong>
                ⚠ Verification flagged {(result.verification.flags || []).length} claim(s):
              </strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {(result.verification.flags || []).map((f, i) => (
                  <li key={i}>
                    <strong>{f.issue || 'flag'}:</strong> {f.claim || ''}
                    {f.note ? ` — ${f.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className={styles.resultActions}>
            <Button size="sm" onClick={() => void exportPdf()}>
              ⬇ PDF
            </Button>
            <Button size="sm" onClick={() => void emailPdf()}>
              ✉ Email
            </Button>
            <Button size="sm" onClick={() => void draftMemo()}>
              📄 Draft memo from this
            </Button>
            <span className={styles.resultCost}>
              {result.cost_usd != null ? `$${Number(result.cost_usd).toFixed(3)}` : ''}
              {result.model ? ` · ${result.model}` : ''}
            </span>
          </div>
        </div>
      )}

      <div className={styles.reviews}>
        <div className={styles.reviewsHead}>
          <span className={styles.metaLabel}>Saved analyses</span>
          <span className={styles.reviewsHint}>Re-open or print to PDF</span>
          <Button size="sm" onClick={() => void loadReviews()}>
            ↻
          </Button>
        </div>
        {!reviews.length ? (
          <div className={styles.muted}>No saved analyses yet — run one above.</div>
        ) : (
          reviews.map((rv) => (
            <div key={rv.id} className={styles.revRow}>
              <div className={styles.revTitle}>
                <div className={styles.revQ}>
                  {(rv.question || '(no question)').replace(/\s+/g, ' ').slice(0, 90)}
                </div>
                <div className={styles.revMeta}>
                  {(rv.generated_at || '').slice(0, 16).replace('T', ' ')}
                  {rv.model ? ` · ${rv.model}` : ''}
                </div>
              </div>
              <Button size="sm" onClick={() => void openReview(rv.id)}>
                View
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void deleteReview(rv.id)}
              >
                ✕
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
