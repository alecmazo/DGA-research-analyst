import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SupportFab } from '@/components/support/SupportFab'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import {
  pollAgenticJob,
  researchPdfDownload,
  researchPdfEmail,
  type AgenticJob,
  type AgenticResult,
} from '@/lib/agentic'
import { relativeTime } from '@/lib/format'
import { renderMd } from '@/lib/md'
import styles from './ReportPage.module.css'
import extra from './ResearchAnswerPage.module.css'

export type ResearchKind = 'analyst' | 'strategist'

export type ResearchSeed = {
  question?: string
  title?: string
  fund_name?: string
  tickers?: string
  answer?: string
  model?: string
  cost_usd?: number
  verification?: AgenticResult['verification']
  generated_at?: string
}

type ReviewPayload = ResearchSeed & {
  id?: string
  answer?: string
  tool_calls?: AgenticResult['tool_calls']
}

const WIN_FEATURES =
  'width=1040,height=900,menubar=no,toolbar=no,location=no,status=no'

function seedKey(kind: ResearchKind, id: string) {
  return `dga.research.${kind}.${id}`
}

export function writeResearchSeed(kind: ResearchKind, id: string, seed: ResearchSeed) {
  try {
    sessionStorage.setItem(seedKey(kind, id), JSON.stringify(seed))
  } catch {
    /* ignore */
  }
}

function readResearchSeed(kind: ResearchKind, id: string): ResearchSeed | null {
  try {
    const raw = sessionStorage.getItem(seedKey(kind, id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ResearchSeed
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function openResearchWindow(
  kind: ResearchKind,
  id: string,
  seed?: ResearchSeed,
): Window | null {
  const kid = (id || '').trim()
  if (!kid) return null
  if (seed) writeResearchSeed(kind, kid, seed)
  const url = `/gp/research?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(kid)}`
  const name = `dga-research-${kind}-${kid}`
  const win = window.open(url, name, WIN_FEATURES)
  if (!win) return null
  try {
    win.focus()
  } catch {
    /* ignore */
  }
  return win
}

/** Open on the Analyze / Run click (user gesture) so the popup is not blocked. */
export function openPendingResearchWindow(kind: ResearchKind, hint?: string): Window | null {
  const q = hint ? `&q=${encodeURIComponent(hint.replace(/\s+/g, ' ').slice(0, 180))}` : ''
  const url = `/gp/research?kind=${encodeURIComponent(kind)}&pending=1${q}`
  const name = `dga-research-${kind}-live`
  const win = window.open(url, name, WIN_FEATURES)
  if (!win) return null
  try {
    win.focus()
  } catch {
    /* ignore */
  }
  return win
}

export function navigateResearchWindow(
  win: Window | null,
  kind: ResearchKind,
  id: string,
  seed?: ResearchSeed,
): Window | null {
  const kid = (id || '').trim()
  if (!kid) return win
  if (seed) writeResearchSeed(kind, kid, seed)
  const url = `/gp/research?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(kid)}`
  if (win && !win.closed) {
    try {
      win.location.href = url
      win.focus()
      return win
    } catch {
      /* fall through */
    }
  }
  return openResearchWindow(kind, kid, seed)
}

function kindLabel(kind: ResearchKind) {
  return kind === 'strategist' ? 'Portfolio Strategist' : 'Analyst'
}

function providerFromModel(model?: string): string {
  const m = (model || '').toLowerCase()
  if (m.includes('grok')) return 'grok'
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('kimi')) return 'kimi'
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet')) return 'claude'
  return 'claude'
}

function asVerification(v: unknown): AgenticResult['verification'] | undefined {
  if (!v) return undefined
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as AgenticResult['verification']
    } catch {
      return undefined
    }
  }
  if (typeof v === 'object') return v as AgenticResult['verification']
  return undefined
}

export function ResearchAnswerPage() {
  const [params] = useSearchParams()
  const kind: ResearchKind = params.get('kind') === 'strategist' ? 'strategist' : 'analyst'
  const id = (params.get('id') || '').trim()
  const pending = params.get('pending') === '1'
  const qHint = (params.get('q') || '').trim()

  const [review, setReview] = useState<ReviewPayload | null>(null)
  const [job, setJob] = useState<AgenticJob | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAct, setBusyAct] = useState(false)

  const heading = kindLabel(kind)

  useEffect(() => {
    const bit =
      review?.fund_name ||
      (review?.question || qHint || '').replace(/\s+/g, ' ').slice(0, 48)
    document.title = bit ? `${bit} · ${heading} · DGA` : `${heading} · DGA`
  }, [heading, review?.fund_name, review?.question, qHint])

  useEffect(() => {
    if (!id) {
      setLoading(true)
      setErr(pending ? null : 'Missing analysis id')
      if (!pending) setLoading(false)
      return
    }

    let alive = true
    ;(async () => {
      setLoading(true)
      setErr(null)

      const seeded = readResearchSeed(kind, id)
      if (seeded && alive) {
        setReview((prev) => ({ ...seeded, ...prev }))
      }

      const reviewPath =
        kind === 'strategist'
          ? `/api/research/strategist/reviews/${encodeURIComponent(id)}`
          : `/api/research/analyst/reviews/${encodeURIComponent(id)}`

      const applyReview = (rv: ReviewPayload) => {
        setReview({
          ...rv,
          verification: asVerification(rv.verification),
        })
      }

      try {
        const d = await api<{ ok?: boolean; review?: ReviewPayload }>(reviewPath)
        if (!alive) return
        if (d.review?.answer) {
          applyReview(d.review)
          setJob(null)
          setLoading(false)
          return
        }
      } catch {
        /* still running, or persist lag — poll the job */
      }

      try {
        const j0 = await api<AgenticJob>(`/api/research/agentic/${encodeURIComponent(id)}`)
        if (!alive) return
        setJob(j0)
        if (j0.status === 'done' && j0.result?.answer) {
          applyReview({ ...seeded, ...j0.result, id })
        } else if (j0.status === 'error') {
          throw new Error(j0.label || j0.error || 'Analysis failed')
        } else {
          const res = await pollAgenticJob(id, (j, ms) => {
            if (!alive) return
            setJob(j)
            setElapsed(ms)
          })
          if (!alive) return
          applyReview({ ...seeded, ...res, id })
        }
      } catch (e) {
        if (!alive) return
        setErr(e instanceof Error ? e.message : 'Failed to load analysis')
      }

      // Prefer persisted row (question / fund metadata) once the writer commits.
      try {
        const d2 = await api<{ review?: ReviewPayload }>(reviewPath)
        if (alive && d2.review) applyReview(d2.review)
      } catch {
        /* keep job result */
      }

      if (alive) {
        setJob(null)
        setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [kind, id, pending])

  const question = review?.question || qHint
  const answer = review?.answer || ''
  const html = useMemo(() => (answer ? renderMd(answer) : ''), [answer])
  const model = review?.model || ''
  const shownProv = providerFromModel(model)
  const verification = asVerification(review?.verification)
  const secs = Math.round(elapsed / 1000)
  const tools = (job?.tool_calls || []).slice(-10)
  const waiting = Boolean((pending && !id) || (id && loading && !answer))

  const pdfPayload = () => ({
    title: kind === 'strategist' ? 'Investment Committee Review' : 'Analyst',
    question: question || '',
    answer_html: html,
    stamp: review?.generated_at
      ? new Date(review.generated_at).toLocaleString()
      : undefined,
    kind,
    model: model || undefined,
    fund_name: review?.fund_name,
    tickers: review?.tickers,
    cost_usd: review?.cost_usd,
    verification,
    filename:
      kind === 'strategist'
        ? 'IC-Review_' +
          String(review?.fund_name || 'Portfolio').replace(/[^A-Za-z0-9]+/g, '_') +
          '.pdf'
        : undefined,
  })

  const exportPdf = async () => {
    if (!answer) return
    setBusyAct(true)
    try {
      await researchPdfDownload(pdfPayload())
    } catch (e) {
      alert('PDF failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setBusyAct(false)
    }
  }

  const emailPdf = async () => {
    if (!answer) return
    const def = getCachedUser()?.email || ''
    const to = window.prompt('Email this PDF to:', def)
    if (!to) return
    setBusyAct(true)
    try {
      const d = await researchPdfEmail({
        ...pdfPayload(),
        to,
      })
      if (!d.ok) throw new Error(d.detail || 'Send failed')
      alert('✉ Sent to ' + to)
    } catch (e) {
      alert('Email failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setBusyAct(false)
    }
  }

  const draftMemo = async () => {
    if (!answer) return
    if (verification?.verdict === 'flags' && (verification.flags || []).length) {
      if (
        !window.confirm(
          `⚠ Verification flagged ${verification.flags!.length} claim(s). Draft memo anyway?`,
        )
      )
        return
    }
    const suggested =
      kind === 'strategist'
        ? review?.fund_name
          ? `${review.fund_name} — Strategy Review`
          : 'Portfolio Strategy Review'
        : (question || 'Research Memo').slice(0, 70)
    const title = window.prompt('Memo title:', suggested)
    if (title === null) return
    setBusyAct(true)
    try {
      const d = await api<{ ok?: boolean; detail?: string; error?: string }>(
        '/api/memos/from-analysis',
        {
          method: 'POST',
          body: JSON.stringify({
            question:
              kind === 'strategist'
                ? 'Portfolio strategy review: ' + (review?.fund_name || question || 'book')
                : question,
            answer,
            title: (title || '').trim(),
          }),
        },
      )
      if (!d.ok) throw new Error(d.detail || d.error || 'Failed')
      alert('✓ Memo saved — open the Memos tab to assign & email.')
    } catch (e) {
      alert('Memo draft failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setBusyAct(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.title}>
          <strong>{heading}</strong>
          {model && (
            <span className={styles.prov} data-p={shownProv}>
              {shownProv.toUpperCase()}
            </span>
          )}
          {review?.generated_at && (
            <span className={styles.meta}>{relativeTime(review.generated_at)}</span>
          )}
          {review?.cost_usd != null && (
            <span className={styles.meta}>${Number(review.cost_usd).toFixed(3)}</span>
          )}
          {model && <span className={styles.meta}>{model}</span>}
        </div>
        <div className={styles.actions}>
          {answer && (
            <>
              <Button size="sm" disabled={busyAct} onClick={() => void exportPdf()}>
                ⬇ PDF
              </Button>
              <Button size="sm" disabled={busyAct} onClick={() => void emailPdf()}>
                ✉ Email
              </Button>
              <Button size="sm" disabled={busyAct} onClick={() => void draftMemo()}>
                📄 Draft memo
              </Button>
            </>
          )}
          <button type="button" className={styles.close} onClick={() => window.close()}>
            Close
          </button>
        </div>
      </header>

      {(review?.fund_name || review?.tickers || question) && (
        <div className={extra.question}>
          {review?.fund_name && <div className={extra.fund}>{review.fund_name}</div>}
          {review?.tickers && <div className={extra.tickers}>{review.tickers}</div>}
          {question && <div className={extra.qText}>{question}</div>}
        </div>
      )}

      {waiting && (
        <div className={extra.progress} role="status">
          <div className={extra.progressHead}>
            <span className={extra.spinDot} />
            <span>
              {job?.label ||
                (pending && !id ? 'Starting…' : 'Working…')}
            </span>
            <span className={extra.progressMeta}>
              {job?.steps != null ? `${job.steps} steps` : ''}
              {job?.cost_usd != null ? ` · $${Number(job.cost_usd).toFixed(3)}` : ''}
              {secs ? ` · ${secs}s` : ''}
            </span>
          </div>
          {tools.map((tc, i) => (
            <div key={i} className={extra.toolLine}>
              🔧 <strong>{tc.tool}</strong>{' '}
              <code>{tc.input ? JSON.stringify(tc.input).slice(0, 60) : ''}</code>
            </div>
          ))}
        </div>
      )}

      <div className={styles.body}>
        {err && <div className={styles.err}>{err}</div>}
        {!err && html && (
          <article className={styles.md} dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {!err && !waiting && !html && (
          <div className={styles.empty}>No answer text in this review.</div>
        )}

        {verification?.verdict === 'clean' && (
          <div className={extra.verifyOk}>
            ✓ Verification pass: every numeric claim is backed by a tool call.
          </div>
        )}
        {verification?.verdict === 'flags' && (
          <div className={extra.verifyWarn}>
            <strong>
              ⚠ Verification flagged {(verification.flags || []).length} claim(s):
            </strong>
            <ul>
              {(verification.flags || []).map((f, i) => (
                <li key={i}>
                  <strong>{f.issue || 'flag'}:</strong> {f.claim || ''}
                  {f.note ? ` — ${f.note}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <SupportFab />
    </div>
  )
}
