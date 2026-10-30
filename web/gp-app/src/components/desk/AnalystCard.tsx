import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { delayAfterWatchlist } from '@/lib/deskBoot'
import { getCachedUser } from '@/lib/auth'
import {
  AGENT_ENGINES,
  AgenticPendingError,
  engLabel,
  loadEngine,
  loadSavedAgenticReview,
  pollAgenticJob,
  researchPdfDownload,
  researchPdfEmail,
  saveEngine,
  type AgentEngine,
  type AgenticJob,
  type AgenticResult,
} from '@/lib/agentic'
import { formatRange, useCostCatalog } from '@/lib/llmCost'
import { useAnalysisScene } from '@/hooks/useAnalysisScene'
import { renderMd } from '@/lib/md'
import {
  navigateResearchWindow,
  openPendingResearchWindow,
  openResearchWindow,
  writeResearchSeed,
} from '@/lib/openResearch'
import styles from './deskWidgets.module.css'

const ENGINE_KEY = 'dga.agentic.engine.v2'

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

const MAX_SHOTS = 4
const MAX_EDGE = 1600
const MAX_DATA_URL = 1_400_000
const IMAGE_FALLBACK =
  'Break down the attached image. Read every number and label, and say what it implies.'

type Shot = { id: string; mime: string; data: string; preview: string }

function looksLikeImage(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    img.src = url
  })
}

async function fileToShot(file: File): Promise<Shot> {
  const img = await readImage(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height, 1))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read that image.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  let quality = 0.82
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > MAX_DATA_URL && quality > 0.45) {
    quality = Math.round((quality - 0.08) * 100) / 100
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > MAX_DATA_URL) {
    throw new Error('That image is still too large. Try a smaller picture.')
  }
  const comma = dataUrl.indexOf(',')
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mime: 'image/jpeg',
    data: dataUrl.slice(comma + 1),
    preview: dataUrl,
  }
}

type ReviewRow = {
  id: string
  question?: string
  model?: string
  generated_at?: string
  cost_usd?: number
}

type Props = { bare?: boolean }

export function AnalystCard({ bare = false }: Props) {
  const [engine, setEngine] = useState<AgentEngine>(() => loadEngine(ENGINE_KEY, 'grok'))
  const costs = useCostCatalog()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [progress, setProgress] = useState<AgenticJob | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<AgenticResult | null>(null)
  const [lastQ, setLastQ] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [dragOver, setDragOver] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const costLabel = useMemo(() => {
    const r = costs.agentic[engine]
    return formatRange(r, ' / run')
  }, [costs.agentic, engine])

  const costTitle = useMemo(() => {
    const r = costs.agentic[engine]
    return (
      `${engLabel(engine)} multi-step research estimate · $${r[0].toFixed(2)}–${r[1].toFixed(2)}. ` +
      'Updates when you switch engines (from live model pricing).'
    )
  }, [costs.agentic, engine])

  const pickEngine = (e: AgentEngine) => {
    if (busy) return
    flushSync(() => {
      setEngine(e)
      saveEngine(ENGINE_KEY, e)
      if (e !== 'deepseek') {
        setErr((cur) => (cur && cur.includes('DeepSeek') ? null : cur))
      }
    })
  }

  const addFiles = async (list: File[]) => {
    const images = list.filter(looksLikeImage)
    if (!images.length) {
      setErr('Attach a JPEG, PNG, WebP, or GIF.')
      return
    }
    const room = MAX_SHOTS - shots.length
    if (room <= 0) {
      setErr('Attach at most 4 images.')
      return
    }
    if (images.length > room) setErr('Attach at most 4 images.')
    else setErr(null)
    const next: Shot[] = []
    for (const file of images.slice(0, room)) {
      try {
        next.push(await fileToShot(file))
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not read that image.')
      }
    }
    if (next.length) setShots((cur) => [...cur, ...next].slice(0, MAX_SHOTS))
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
    return delayAfterWatchlist(1100, () => void loadReviews())
  }, [loadReviews])

  const run = async () => {
    const attached = shots
    if (attached.length && engine === 'deepseek') return
    const q = question.trim()
    if (q.length < 4 && !attached.length) {
      setErr('Ask a real question.')
      return
    }
    const sentQ = q.length >= 4 ? q : IMAGE_FALLBACK
    const shown = attached.length
      ? `${sentQ} [${attached.length} image${attached.length === 1 ? '' : 's'}]`
      : sentQ
    setErr(null)
    setResult(null)
    setLastQ(shown)
    setJobId(null)
    setBusy(true)
    setProgress({ status: 'running', label: `Starting · ${engLabel(engine)}…`, steps: 0 })
    setElapsed(0)
    // Open on the click so the finished answer is not popup-blocked.
    const win = openPendingResearchWindow('analyst', shown, engine)
    let startedId: string | null = null
    try {
      const d0 = await api<{ ok?: boolean; job_id?: string; error?: string }>(
        '/api/research/agentic',
        {
          method: 'POST',
          body: JSON.stringify({
            question: sentQ,
            llm_provider: engine,
            source: 'analyst',
            ...(attached.length
              ? { images: attached.map((s) => ({ mime: s.mime, data: s.data })) }
              : {}),
          }),
        },
      )
      if (!d0.ok || !d0.job_id) throw new Error(d0.error || 'Failed to start')
      startedId = d0.job_id
      setJobId(d0.job_id)
      setShots([])
      navigateResearchWindow(win, 'analyst', d0.job_id, {
        question: shown,
        title: attached.length ? `Analyst · ${attached.length} image${attached.length === 1 ? '' : 's'}` : 'Analyst',
      })
      let res: AgenticResult
      try {
        res = await pollAgenticJob(d0.job_id, (j, ms) => {
          setProgress(j)
          setElapsed(ms)
        })
      } catch (e) {
        if (e instanceof AgenticPendingError) {
          const saved = await loadSavedAgenticReview(d0.job_id)
          if (saved) {
            res = saved
          } else {
            setProgress({
              status: 'running',
              label: 'Still working — answer will open when ready.',
            })
            res = await pollAgenticJob(
              d0.job_id,
              (j, ms) => {
                setProgress(j)
                setElapsed(ms)
              },
              { maxMs: 12 * 60 * 1000, intervalMs: 2500 },
            )
          }
        } else {
          throw e
        }
      }
      setResult(res)
      setProgress(null)
      const seed = {
        question: shown,
        title: attached.length ? `Analyst · ${attached.length} image${attached.length === 1 ? '' : 's'}` : 'Analyst',
        answer: res.answer,
        model: res.model,
        cost_usd: res.cost_usd,
        verification: res.verification,
      }
      writeResearchSeed('analyst', d0.job_id, seed)
      if (!win || win.closed) openResearchWindow('analyst', d0.job_id, seed)
      window.setTimeout(() => void loadReviews(), 2000)
    } catch (e) {
      // Only close the placeholder if we never started a job.
      if (!startedId && win && !win.closed) {
        try {
          win.close()
        } catch {
          /* ignore */
        }
      }
      if (e instanceof AgenticPendingError) {
        setErr(e.message)
        window.setTimeout(() => void loadReviews(), 1500)
      } else {
        setErr(e instanceof Error ? e.message : 'Analyst failed')
      }
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  const openReview = (id: string) => {
    setJobId(id)
    const opened = openResearchWindow('analyst', id)
    if (!opened) setErr('Pop-up blocked — allow windows for this site, then click Open again.')
    else setErr(null)
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
        kind: 'analyst',
        model: result.model,
        cost_usd: result.cost_usd,
        verification: result.verification,
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
        kind: 'analyst',
        model: result.model,
        cost_usd: result.cost_usd,
        verification: result.verification,
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
  useAnalysisScene(
    'analyst',
    Boolean(progress && !result),
    progress?.label || 'Working…',
    [
      progress?.steps != null ? `${progress.steps} steps` : '',
      progress?.cost_usd != null ? `$${Number(progress.cost_usd).toFixed(3)}` : '',
      secs ? `${secs}s` : '',
    ]
      .filter(Boolean)
      .join(' · ') || undefined,
    engine,
  )

  return (
    <div className={`${styles.agentBody} ${bare ? styles.heroBare : ''}`}>
      <p className={styles.agentHint}>
        Multi-step research over live quotes, saved reports, news, and your books.
        Attach a chart and Grok or Claude will read it. The answer opens in a new window.
      </p>

      <div className={styles.agentToolbar}>
        <span className={styles.metaLabel}>Engine</span>
        <span className={styles.seg} role="group" aria-label="Analyst engine">
          {AGENT_ENGINES.map((e) => {
            const on = engine === e.id
            const er = costs.agentic[e.id]
            return (
            <button
              key={e.id}
              type="button"
              title={`${e.title} · est. $${er[0].toFixed(2)}–${er[1].toFixed(2)}`}
              className={`${styles.segBtn} ${on ? styles.segActive : ''}`}
              onPointerDown={(ev) => {
                if (ev.button !== 0 || busy) return
                ev.preventDefault()
                pickEngine(e.id)
              }}
              onClick={(ev) => {
                if (ev.detail === 0) pickEngine(e.id)
              }}
              disabled={busy}
              aria-pressed={on}
            >
              {e.label}
            </button>
            )
          })}
        </span>
        <span className={styles.engineTag}>{engLabel(engine)}</span>
        <span className={styles.costHint} title={costTitle} aria-live="polite">
          {costLabel}
        </span>
      </div>

      {engine === 'deepseek' && shots.length > 0 && (
        <div className={styles.err}>DeepSeek cannot read pictures. Pick Grok or Claude.</div>
      )}
      <div
        className={`${styles.compose} ${dragOver ? styles.composeDrag : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          dragDepth.current += 1
          setDragOver(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          dragDepth.current = 0
          setDragOver(false)
          if (busy) return
          void addFiles(Array.from(e.dataTransfer.files || []))
        }}
      >
        <div className={styles.composeMain}>
          {shots.length > 0 && (
            <div className={styles.shots}>
              {shots.map((shot) => (
                <div key={shot.id} className={styles.shot}>
                  <img src={shot.preview} alt="" />
                  <button
                    type="button"
                    className={styles.shotRemove}
                    aria-label="Remove image"
                    disabled={busy}
                    onClick={() => setShots((cur) => cur.filter((s) => s.id !== shot.id))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.composeRow}>
            <textarea
              ref={taRef}
              className={styles.composeTa}
              rows={2}
              placeholder="Ask a question, or drop a chart and ask what it means."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files || []).filter(looksLikeImage)
                if (!files.length) return
                e.preventDefault()
                void addFiles(files)
              }}
            />
            <input
              ref={fileRef}
              className={styles.fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                e.target.value = ''
                if (files.length) void addFiles(files)
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || shots.length >= MAX_SHOTS}
              onClick={() => fileRef.current?.click()}
            >
              Image
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void run()}>
              {busy ? `⏳ ${engLabel(engine)}…` : 'Analyze'}
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.suggestChips}>
        <button type="button" className={styles.presetPrimary} onClick={applyRetiree} disabled={busy}>
          Retiree portfolio build
        </button>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className={styles.suggestChip}
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
        <div className={styles.resultReady}>
          <div>
            ✓ Answer ready — opened in a new window
            {result.verification?.verdict === 'flags'
              ? ` · ⚠ ${result.verification.flags?.length || 0} verification flag(s)`
              : result.verification?.verdict === 'clean'
                ? ' · verification pass'
                : ''}
            .
          </div>
          <div className={styles.resultActions}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => jobId && openReview(jobId)}
              disabled={!jobId}
            >
              Open window
            </Button>
            <Button size="sm" onClick={() => void exportPdf()}>
              ⬇ PDF
            </Button>
            <Button size="sm" onClick={() => void emailPdf()}>
              ✉ Email
            </Button>
            <Button size="sm" onClick={() => void draftMemo()}>
              📄 Draft memo
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
          <span className={styles.reviewsHint}>Opens in a new window</span>
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
              <Button size="sm" onClick={() => openReview(rv.id)}>
                Open
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
