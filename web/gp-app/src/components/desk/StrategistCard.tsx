import { useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
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
import { formatRange, useCostCatalog } from '@/lib/llmCost'
import { renderMd } from '@/lib/md'
import {
  navigateResearchWindow,
  openPendingResearchWindow,
  openResearchWindow,
  writeResearchSeed,
} from '@/pages/ResearchAnswerPage'
import styles from './deskWidgets.module.css'

const ENGINE_KEY = 'dga.strategist.engine.v1'

type FundOpt = { id: string; name?: string; short_name?: string }

type StratReview = {
  id: string
  fund_name?: string
  tickers?: string
  generated_at?: string
  cost_usd?: number
  model?: string
  answer?: string
  verification?: AgenticResult['verification']
}

type Props = { bare?: boolean }

export function StrategistCard({ bare = false }: Props) {
  const navigate = useNavigate()
  const [engine, setEngine] = useState<AgentEngine>(() => loadEngine(ENGINE_KEY, 'claude'))
  const costs = useCostCatalog()
  const [funds, setFunds] = useState<FundOpt[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [progress, setProgress] = useState<AgenticJob | null>(null)
  const [result, setResult] = useState<AgenticResult | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [fundLabel, setFundLabel] = useState('')
  const [tickers, setTickers] = useState<string[]>([])

  const costLabel = useMemo(() => {
    const r = costs.strategist[engine]
    return formatRange(r, ' / review')
  }, [costs.strategist, engine])

  const costTitle = useMemo(() => {
    const r = costs.strategist[engine]
    return (
      `${engLabel(engine)} whole-book strategist estimate · $${r[0].toFixed(2)}–${r[1].toFixed(2)}. ` +
      'Updates when you switch engines (from live model pricing).'
    )
  }, [costs.strategist, engine])

  const pickEngine = (e: AgentEngine) => {
    if (busy) return
    flushSync(() => {
      setEngine(e)
      saveEngine(ENGINE_KEY, e)
    })
  }
  const [positions, setPositions] = useState<unknown[]>([])
  const [archive, setArchive] = useState<StratReview[]>([])
  const [roundupMsg, setRoundupMsg] = useState<string | null>(null)

  const loadFunds = useCallback(async () => {
    try {
      const d = await api<FundOpt[] | { funds?: FundOpt[] }>('/api/fund/list')
      const list = (Array.isArray(d) ? d : d.funds || []).filter((f) => f && f.id)
      setFunds(list)
    } catch {
      /* ignore */
    }
  }, [])

  const loadArchive = useCallback(async () => {
    try {
      const d = await api<{ reviews?: StratReview[] }>('/api/research/strategist/reviews')
      setArchive(d.reviews || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadFunds()
    void loadArchive()
  }, [loadFunds, loadArchive])

  const start = async (
    payload: Record<string, unknown>,
    label: string,
    win: Window | null,
  ) => {
    setErr(null)
    setResult(null)
    setRoundupMsg(null)
    setBusy(true)
    setFundLabel(label)
    setProgress({ status: 'running', label: `Loading book · ${engLabel(engine)}…`, steps: 0 })
    try {
      const d0 = await api<{
        ok?: boolean
        job_id?: string
        error?: string
        positions?: unknown[]
        tickers?: string[]
        fund_name?: string
      }>('/api/research/portfolio-strategist', {
        method: 'POST',
        body: JSON.stringify({ ...payload, llm_provider: engine }),
      })
      if (!d0.ok || !d0.job_id) throw new Error(d0.error || 'Failed to start')
      setJobId(d0.job_id)
      setPositions(d0.positions || [])
      setTickers(d0.tickers || [])
      const name = d0.fund_name || label
      if (d0.fund_name) setFundLabel(d0.fund_name)
      const tickStr = (d0.tickers || []).join(', ')
      navigateResearchWindow(win, 'strategist', d0.job_id, {
        title: 'Investment Committee Review',
        fund_name: name,
        tickers: tickStr,
        question: label,
      })
      const res = await pollAgenticJob(
        d0.job_id,
        (j) => setProgress(j),
        { maxMs: 12 * 60 * 1000, intervalMs: 1400 },
      )
      setResult(res)
      setProgress(null)
      const seed = {
        title: 'Investment Committee Review',
        fund_name: name,
        tickers: tickStr,
        question: label,
        answer: res.answer,
        model: res.model,
        cost_usd: res.cost_usd,
        verification: res.verification,
      }
      writeResearchSeed('strategist', d0.job_id, seed)
      if (!win || win.closed) openResearchWindow('strategist', d0.job_id, seed)
      void loadArchive()
    } catch (e) {
      if (win && !win.closed) {
        try {
          win.close()
        } catch {
          /* ignore */
        }
      }
      setErr(e instanceof Error ? e.message : 'Strategist failed')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (!selected.length && !file) {
      setErr('Pick a fund or upload a portfolio file.')
      return
    }
    const hint = selected.length
      ? funds
          .filter((f) => selected.includes(f.id))
          .map((f) => f.short_name || f.name || f.id)
          .join(' + ')
      : file?.name || 'uploaded book'
    const win = openPendingResearchWindow('strategist', hint)
    if (selected.length) {
      const label =
        funds
          .filter((f) => selected.includes(f.id))
          .map((f) => f.short_name || f.name || f.id)
          .join(' + ') + (selected.length > 1 ? ' (combined)' : '')
      await start({ fund_ids: selected }, label, win)
      return
    }
    if (file) {
      setBusy(true)
      setErr(null)
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('parse_only', 'true')
        // api() sets JSON content-type; use fetch for FormData
        const headers = new Headers()
        try {
          const token = localStorage.getItem('dga_v2_token')
          if (token) headers.set('x-auth-v2-token', token)
        } catch {
          /* ignore */
        }
        const up = await fetch('/api/podcast-portfolio-roundup/upload', {
          method: 'POST',
          headers,
          body: fd,
        })
        const uj = (await up.json()) as {
          ok?: boolean
          detail?: string
          error?: string
          positions?: unknown[]
        }
        if (!up.ok || !uj.ok) throw new Error(uj.detail || uj.error || 'Parse failed')
        await start({ positions: uj.positions || [] }, 'uploaded book', win)
      } catch (e) {
        if (win && !win.closed) {
          try {
            win.close()
          } catch {
            /* ignore */
          }
        }
        setErr(e instanceof Error ? e.message : 'Upload failed')
        setBusy(false)
      }
    }
  }

  const answerHtml = result?.answer ? renderMd(result.answer) : ''

  const exportPdf = async (reviewId?: string) => {
    try {
      let rv: AgenticResult & { fund_name?: string; tickers?: string; generated_at?: string } =
        result || {}
      const id = reviewId || jobId
      if (id && (!rv.answer || jobId !== id)) {
        const d = await api<{ ok?: boolean; review?: StratReview }>(
          `/api/research/strategist/reviews/${encodeURIComponent(id)}`,
        )
        if (!d.review) throw new Error('review not found')
        rv = d.review
      }
      if (!rv.answer) throw new Error('Nothing to export')
      await researchPdfDownload({
        title: 'Investment Committee Review',
        question: [rv.fund_name || fundLabel, rv.tickers || tickers.join(',')].filter(Boolean).join(' — '),
        answer_html: renderMd(rv.answer),
        stamp: rv.generated_at
          ? new Date(rv.generated_at).toLocaleString()
          : undefined,
        filename:
          'IC-Review_' +
          String(rv.fund_name || fundLabel || 'Portfolio').replace(/[^A-Za-z0-9]+/g, '_') +
          '.pdf',
      })
    } catch (e) {
      alert('PDF failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const emailPdf = async () => {
    if (!result?.answer) return
    const def = getCachedUser()?.email || ''
    const to = window.prompt('Email this review PDF to:', def)
    if (!to) return
    try {
      await researchPdfEmail({
        title: 'Investment Committee Review',
        question: fundLabel,
        answer_html: answerHtml,
        to,
      })
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
          `⚠ Verification flagged ${v.flags!.length} claim(s). Draft strategy memo anyway?`,
        )
      )
        return
    }
    const title = window.prompt(
      'Memo title:',
      fundLabel ? `${fundLabel} — Strategy Review` : 'Portfolio Strategy Review',
    )
    if (title === null) return
    try {
      const d = await api<{ ok?: boolean; detail?: string; error?: string }>(
        '/api/memos/from-analysis',
        {
          method: 'POST',
          body: JSON.stringify({
            question: 'Portfolio strategy review: ' + (fundLabel || 'uploaded book'),
            answer: result.answer,
            title: (title || '').trim(),
          }),
        },
      )
      if (!d.ok) throw new Error(d.detail || d.error || 'Failed')
      alert('✓ Strategy memo saved — Memos tab to assign & email.')
    } catch (e) {
      alert('Memo draft failed: ' + (e instanceof Error ? e.message : e))
    }
  }

  const handoffRoundup = async () => {
    if (tickers.length < 5) {
      alert(`Portfolio Roundup needs ≥5 tickers; this book has ${tickers.length}.`)
      return
    }
    setRoundupMsg('🎙️ Queuing Portfolio Roundup script…')
    try {
      const j = await api<{ ok?: boolean; error?: string }>(
        '/api/podcast-portfolio-roundup/script',
        {
          method: 'POST',
          body: JSON.stringify({ tickers, positions }),
        },
      )
      if (!j.ok) throw new Error(j.error || 'Failed')
      setRoundupMsg('✓ Roundup script queued — open Podcasts to review / generate audio.')
      // Soft navigate to podcasts
      window.setTimeout(() => navigate('/podcasts'), 1200)
    } catch (e) {
      setRoundupMsg('❌ ' + (e instanceof Error ? e.message : e))
    }
  }

  const viewArchive = (id: string) => {
    setJobId(id)
    const opened = openResearchWindow('strategist', id)
    if (!opened) setErr('Pop-up blocked — allow windows for this site, then click Open again.')
    else setErr(null)
  }

  const deleteArchive = async (id: string) => {
    if (!window.confirm('Delete this saved committee review?')) return
    try {
      await api(`/api/research/strategist/reviews/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      void loadArchive()
    } catch {
      /* ignore */
    }
  }

  const tools = (progress?.tool_calls || []).slice(-8)

  return (
    <div className={`${styles.agentBody} ${bare ? styles.heroBare : ''}`}>
      <p className={styles.agentHint}>
        Full investment-committee review of an entire book. Reasons{' '}
        <em>across</em> positions (concentration, correlation, EV) and proposes
        grounded adjustments. The review opens in a new window when ready —
        same as Saved Reports. Hand off to Roundup podcast or strategy memo.
        Cost follows the selected engine.
      </p>

      <div className={styles.agentToolbar}>
        <span className={styles.metaLabel}>Engine</span>
        <span className={styles.seg} role="group" aria-label="Strategist engine">
          {AGENT_ENGINES.map((e) => {
            const on = engine === e.id
            const er = costs.strategist[e.id]
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

      <div className={styles.stratRow}>
        <div className={styles.fieldCol}>
          <label className={styles.fieldLbl}>Account(s) — pick one or more</label>
          <select
            className={styles.fundSelect}
            multiple
            size={4}
            value={selected}
            disabled={busy}
            onChange={(e) => {
              const opts = Array.from(e.target.selectedOptions).map((o) => o.value)
              setSelected(opts)
            }}
          >
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.short_name || f.name || f.id}
              </option>
            ))}
          </select>
          <span className={styles.muted}>
            ⌘/Ctrl-click to combine 2–3 accounts into one book.
          </span>
        </div>
        <span className={styles.muted} style={{ alignSelf: 'center' }}>
          or
        </span>
        <div className={styles.fieldCol}>
          <label className={styles.fieldLbl}>Upload book</label>
          <input
            className={styles.fileInput}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,.xlsm"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void run()}>
          {busy ? `⏳ ${engLabel(engine)}…` : '🧭 Run review'}
        </Button>
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
            </span>
          </div>
          {tools.map((tc, i) => (
            <div key={i} className={styles.toolLine}>
              🔧 <strong>{tc.tool}</strong>{' '}
              <code>{tc.input ? JSON.stringify(tc.input).slice(0, 46) : ''}</code>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className={styles.resultReady}>
          <div>
            ✓ Review ready — opened in a new window
            {result.verification?.verdict === 'flags'
              ? ` · ⚠ ${result.verification.flags?.length || 0} verification flag(s)`
              : result.verification?.verdict === 'clean'
                ? ' · verification pass'
                : ''}
            . Saved automatically.
          </div>
          <div className={styles.resultActions}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => jobId && viewArchive(jobId)}
              disabled={!jobId}
            >
              Open window
            </Button>
            <Button size="sm" onClick={() => void exportPdf()}>
              ⬇ Review PDF
            </Button>
            <Button size="sm" onClick={() => void emailPdf()}>
              ✉ Email
            </Button>
            <Button size="sm" variant="primary" onClick={() => void handoffRoundup()}>
              🎙️ Generate Portfolio Roundup
            </Button>
            <Button size="sm" onClick={() => void draftMemo()}>
              📄 Draft strategy memo
            </Button>
            <span className={styles.resultCost}>
              {result.cost_usd != null ? `$${Number(result.cost_usd).toFixed(3)}` : ''}
              {result.model ? ` · ${result.model}` : ''}
            </span>
          </div>
          {roundupMsg && <div className={styles.muted} style={{ marginTop: 8 }}>{roundupMsg}</div>}
        </div>
      )}

      <div className={styles.reviews}>
        <div className={styles.reviewsHead}>
          <span className={styles.metaLabel}>
            Past committee reviews ({archive.length})
          </span>
          <Button size="sm" onClick={() => void loadArchive()}>
            ↻
          </Button>
        </div>
        {!archive.length ? (
          <div className={styles.muted}>No saved reviews yet.</div>
        ) : (
          archive.map((rv) => (
            <div key={rv.id} className={styles.revRow}>
              <div className={styles.revTitle}>
                <div className={styles.revQ}>{rv.fund_name || 'Portfolio'}</div>
                <div className={styles.revMeta}>
                  {(rv.tickers || '').split(',').slice(0, 6).join(', ')}
                  {(rv.tickers || '').split(',').length > 6 ? '…' : ''}
                  {' · '}
                  {(rv.generated_at || '').slice(0, 16).replace('T', ' ')}
                </div>
              </div>
              <Button size="sm" onClick={() => viewArchive(rv.id)}>
                Open
              </Button>
              <Button size="sm" onClick={() => void exportPdf(rv.id)}>
                PDF
              </Button>
              <Button size="sm" variant="danger" onClick={() => void deleteArchive(rv.id)}>
                ✕
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
