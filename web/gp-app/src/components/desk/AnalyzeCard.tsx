import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { api, type JobStatus, type LlmProvider } from '@/lib/api'
import { pollJob } from '@/lib/jobs'
import { delayAfterWatchlist } from '@/lib/deskBoot'
import { AnalysisScene } from '@/components/ui/AnalysisScene'
import { useAnalysisScene } from '@/hooks/useAnalysisScene'
import { inferSceneEngine, type SceneEngine } from '@/lib/analysisScene'
import {
  DEFAULT_REPORT_COST,
  fmtUsd,
  sumRanges,
  useCostCatalog,
} from '@/lib/llmCost'
import styles from './deskWidgets.module.css'

const ENGINES: { id: LlmProvider; label: string }[] = [
  { id: 'grok', label: 'Grok' },
  { id: 'claude', label: 'Claude' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'local', label: 'Local – GPT-OSS 20B Finance (free)' },
]

const STORAGE_KEY = 'dga.hero.engines.v3'
const ACTIVE_JOB_KEY = 'dga.analyze.active.v1'

const ENGINE_ORDER: LlmProvider[] = ['grok', 'claude', 'kimi', 'deepseek', 'local']

function formatRunCost(result: JobStatus['result'] | null | undefined): string {
  if (!result) return ''
  const bits: string[] = []
  if (result.input_tokens != null) {
    bits.push(`${Number(result.input_tokens).toLocaleString()} in`)
  }
  if (result.output_tokens != null) {
    bits.push(`${Number(result.output_tokens).toLocaleString()} out`)
  }
  if (result.cost_usd != null && !Number.isNaN(Number(result.cost_usd))) {
    const n = Number(result.cost_usd)
    if (n === 0 && result.tokens_per_sec != null) bits.push('cost: $0')
    else {
      const shown = n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)
      bits.push(`${result.cost_estimated ? 'about ' : ''}$${shown}`)
    }
  }
  if (result.tokens_per_sec != null && !Number.isNaN(Number(result.tokens_per_sec))) {
    bits.push(`${Number(result.tokens_per_sec).toFixed(1)} tok/s`)
  }
  if (result.latency_ms != null && Number(result.latency_ms) > 0) {
    bits.push(`${Math.round(Number(result.latency_ms) / 1000)}s`)
  }
  return bits.length ? ` · ${bits.join(' · ')}` : ''
}

type StoredActive = {
  jobId: string
  ticker: string
  engines: LlmProvider[]
}

function loadActiveJob(): StoredActive | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_JOB_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as StoredActive
    if (!d?.jobId || !d?.ticker) return null
    return d
  } catch {
    return null
  }
}

function saveActiveJob(d: StoredActive) {
  try {
    sessionStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(d))
  } catch {
    /* quota */
  }
}

function clearActiveJob() {
  try {
    sessionStorage.removeItem(ACTIVE_JOB_KEY)
  } catch {
    /* ignore */
  }
}

function isLiveAnalyze(j: JobStatus | null | undefined): boolean {
  if (!j?.job_id) return false
  const st = String(j.status || '')
  if (st !== 'queued' && st !== 'running') return false
  if (!j.ticker) return false
  if (!j.llm_provider) return false
  return true
}

function enginesFromJob(j: JobStatus, fallback: LlmProvider[]): LlmProvider[] {
  const fromMap = Object.keys(j.providers || {}).filter((e): e is LlmProvider =>
    ENGINE_ORDER.includes(e as LlmProvider),
  )
  if (fromMap.length) return ENGINE_ORDER.filter((e) => fromMap.includes(e))
  const parts = String(j.llm_provider || '')
    .split('+')
    .map((s) => s.trim().toLowerCase())
    .filter((e): e is LlmProvider => ENGINE_ORDER.includes(e as LlmProvider))
  return parts.length ? parts : fallback
}

function loadEngines(): LlmProvider[] {
  try {
    for (const k of [STORAGE_KEY, 'dga.hero.engines.v2', 'dga.hero.engines.v1']) {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const arr = JSON.parse(raw) as unknown
      if (Array.isArray(arr) && arr.length) {
        const ok = arr.filter((e): e is LlmProvider =>
          ENGINES.some((x) => x.id === e),
        )
        if (ok.length) return ok
      }
    }
  } catch {
    /* ignore */
  }
  return ['grok']
}

type Props = {
  /** Prefill / external control of ticker (e.g. Idea Generator → Report). */
  ticker?: string
  onTickerChange?: (t: string) => void
  onComplete?: () => void
  /** Fired when an analyze job is queued so Saved Reports can show in-progress. */
  onStart?: () => void
  /** Increment to auto-run with current ticker (optional). */
  runToken?: number
  /** When true, omit the outer label chrome (Desk board supplies the header). */
  bare?: boolean
}

export function AnalyzeCard({
  ticker: controlled,
  onTickerChange,
  onComplete,
  onStart,
  runToken,
  bare = false,
}: Props) {
  const [localTicker, setLocalTicker] = useState(controlled || '')
  const ticker = controlled !== undefined ? controlled : localTicker
  const setTicker = (t: string) => {
    if (onTickerChange) onTickerChange(t)
    else setLocalTicker(t)
  }

  const [engines, setEngines] = useState<LlmProvider[]>(() => loadEngines())
  const [localOffline, setLocalOffline] = useState<string | null>(null)
  const costs = useCostCatalog()
  const [gamma, setGamma] = useState(false)
  const [running, setRunning] = useState(false)
  const [hint, setHint] = useState('')
  const [hintTone, setHintTone] = useState<'ok' | 'err' | 'mid'>('mid')
  const [progPct, setProgPct] = useState<number | null>(null)
  const [progLbl, setProgLbl] = useState('')
  const [progStep, setProgStep] = useState('')
  const [trace, setTrace] = useState<string[]>([])
  const [showProg, setShowProg] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [sceneEngine, setSceneEngine] = useState<SceneEngine>('grok')
  const pollAbort = useRef<AbortController | null>(null)
  const following = useRef(false)

  useAnalysisScene(
    'analyze',
    Boolean(showProg && running),
    progLbl || 'Queued…',
    progPct == null ? undefined : `${progPct}%`,
    sceneEngine,
    progStep,
  )

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(engines))
    } catch {
      /* ignore */
    }
  }, [engines])

  useEffect(() => {
    if (!engines.includes('local')) {
      setLocalOffline(null)
      return
    }
    let alive = true
    void api<{ ok?: boolean; message?: string }>('/api/llm/local/health')
      .then((d) => {
        if (!alive) return
        setLocalOffline(d?.ok ? null : d?.message || 'Local model offline – start Ollama')
      })
      .catch(() => {
        if (alive) setLocalOffline('Local model offline – start Ollama')
      })
    return () => {
      alive = false
    }
  }, [engines])

  /** Instant toggle — flushSync so highlight paints before the next frame. */
  const toggleEngine = (id: LlmProvider) => {
    if (running) return
    flushSync(() => {
      setEngines((prev) => {
        if (prev.includes(id)) {
          const next = prev.filter((e) => e !== id)
          return next.length ? next : prev // keep at least one
        }
        return [...prev, id]
      })
    })
  }

  const costMap = costs.report

  const costLabel = useMemo(() => {
    if (!engines.length) return 'Select an engine'
    if (engines.length === 1 && engines[0] === 'local') {
      return gamma ? 'cost: $0 / report + deck' : 'cost: $0'
    }
    const ranges = engines.map((e) => costMap[e] || DEFAULT_REPORT_COST[e])
    const [lo, hi] = sumRanges(ranges)
    const range = `$${fmtUsd(lo)}–${fmtUsd(hi)}`
    if (engines.length === 1) {
      return gamma ? `≈ ${range} / report + deck` : `≈ ${range} / report`
    }
    const base = `≈ ${range} · ${engines.length} reports`
    return gamma ? `${base} + deck` : base
  }, [engines, costMap, gamma])

  const costTitle = useMemo(() => {
    const parts = engines.map((e) => {
      if (e === 'local') return 'local: cost $0 per report'
      const [a, b] = costMap[e] || DEFAULT_REPORT_COST[e]
      return `${e}: $${fmtUsd(a)}–${fmtUsd(b)} per report`
    })
    return (
      'Estimated LLM cost for selected engines (each run is saved separately). ' +
      parts.join('; ') +
      (gamma ? ' · Gamma deck adds cost on Grok only.' : '')
    )
  }, [engines, costMap, gamma])

  const followJob = useCallback(
    async (jobId: string, tk: string, ordered: LlmProvider[], resumed: boolean) => {
      pollAbort.current?.abort()
      const ac = new AbortController()
      pollAbort.current = ac
      following.current = true
      saveActiveJob({ jobId, ticker: tk, engines: ordered })
      setActiveJobId(jobId)
      setRunning(true)
      setShowProg(true)
      setSceneEngine(ordered[0] || 'grok')
      setHintTone('mid')
      setHint(
        resumed
          ? `Still running ${tk} · ${ordered.join(' + ')} — left the desk, picked up where it left off.`
          : `Running ${ordered.length} engine${ordered.length > 1 ? 's' : ''} · ${ordered.join(' + ')}${
              gamma ? ' · Gamma on Grok' : ''
            } · one job, each engine saved`,
      )

      try {
        const outcome = await pollJob(
          jobId,
          {
            onProgress: (pctInt, lbl, job) => {
              setProgPct(pctInt == null ? null : Math.min(99, pctInt))
              setProgLbl(lbl || '…')
              setProgStep(String(job?.progress?.step || ''))
              const lines = (job.trace || []).slice(-16).map((row) => {
                const sec = Math.max(0, Number(row.elapsed_s) || 0)
                const mm = Math.floor(sec / 60)
                const ss = String(sec % 60).padStart(2, '0')
                const pct = row.pct != null ? `${Math.round(Number(row.pct) * 100)}%` : ''
                return `${mm}:${ss}  ${pct}  ${row.step || ''}  ${row.label || ''}`.trim()
              })
              if (lines.length) setTrace(lines)
              setSceneEngine(
                inferSceneEngine(
                  job?.progress?.step || job?.llm_provider || lbl,
                  ordered[0] || 'grok',
                ),
              )
            },
          },
          1500,
          ac.signal,
        )
        if (outcome.status === 'aborted' || ac.signal.aborted) return

        clearActiveJob()
        setActiveJobId(null)
        onComplete?.()

        const spent = formatRunCost(outcome.result)
        setProgPct(100)
        setProgLbl(spent ? spent.slice(3) : 'Complete')
        setProgStep('done')
        setTimeout(() => setShowProg(false), 4000)

        if (outcome.status === 'canceled' || outcome.status === 'cancelled') {
          setHintTone('mid')
          setHint('Canceled — any finished engines were saved to Saved Reports.')
        } else if (outcome.status === 'failed') {
          setHintTone('err')
          setHint(
            `Error: ${outcome.error || outcome.detail || 'analysis failed'}${spent}`,
          )
        } else {
          const provs = (outcome.result?.providers || {}) as Record<string, string>
          const names = Object.keys(provs)
          const okN = names.length
            ? names.filter((k) => provs[k] === 'done').length
            : outcome.status === 'done'
              ? ordered.length
              : 0
          const failN = names.length
            ? names.filter((k) => provs[k] !== 'done').length
            : outcome.status === 'done'
              ? 0
              : ordered.length
          const failNames = names.filter((k) => provs[k] !== 'done')
          const warn = outcome.warning || outcome.error || outcome.detail
          setHintTone(failN && !okN ? 'err' : failN ? 'mid' : 'ok')
          setHint(
            `${okN ? `✅ ${okN} report${okN > 1 ? 's' : ''} saved` : '❌ none saved'}${
              failN ? ` · ${failN} failed${failNames.length ? ` (${failNames.join(', ')})` : ''}` : ''
            }${spent} — see Saved Reports${
              warn && failN ? ` · ${String(warn).slice(0, 140)}` : ''
            }`,
          )
        }
      } catch (e) {
        if (ac.signal.aborted) return
        clearActiveJob()
        setShowProg(false)
        setActiveJobId(null)
        setHintTone('err')
        setHint(`Error: ${e instanceof Error ? e.message : 'unknown'}`)
      } finally {
        following.current = false
        if (!ac.signal.aborted) {
          setRunning(false)
          setCanceling(false)
        }
      }
    },
    [gamma, onComplete],
  )

  const runAnalysis = useCallback(async () => {
    const tk = ticker.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '')
    if (!tk) {
      setHintTone('err')
      setHint('Enter a ticker first.')
      return
    }
    if (!engines.length) {
      setHintTone('err')
      setHint('Select at least one engine.')
      return
    }
    if (following.current) return

    const ordered = [...engines].sort(
      (a, b) => ENGINE_ORDER.indexOf(a) - ENGINE_ORDER.indexOf(b),
    )
    setTrace([])
    setProgPct(null)
    setProgLbl(
      ordered.length > 1
        ? `${ordered[0]} · 1/${ordered.length} queued…`
        : `${ordered[0]} queued…`,
    )
    setRunning(true)
    setShowProg(true)

    try {
      setSceneEngine(ordered[0] || 'grok')
      const job = await api<JobStatus>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          ticker: tk,
          generate_gamma: gamma,
          llm_provider: ordered[0],
          llm_providers: ordered,
        }),
      })
      const jobId = job.job_id
      if (!jobId) throw new Error('No job_id from analyze')
      onStart?.()
      await followJob(jobId, tk, ordered, false)
    } catch (e) {
      following.current = false
      clearActiveJob()
      setShowProg(false)
      setActiveJobId(null)
      setRunning(false)
      setHintTone('err')
      setHint(`Error: ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }, [ticker, engines, gamma, onStart, followJob])

  // Re-attach a job that kept running after we left Desk (other tabs unmount this card).
  useEffect(() => {
    let cancelled = false
    const stop = delayAfterWatchlist(0, () => {
      void (async () => {
        if (following.current) return
        const stored = loadActiveJob()
        let job: JobStatus | null = null
        if (stored?.jobId) {
          try {
            job = await api<JobStatus>(`/api/jobs/${encodeURIComponent(stored.jobId)}`)
          } catch {
            job = null
          }
        }
        if (!isLiveAnalyze(job)) {
          try {
            const all = await api<JobStatus[]>('/api/jobs')
            job =
              (Array.isArray(all) ? all : []).find((j) => isLiveAnalyze(j)) || null
          } catch {
            job = null
          }
        }
        if (cancelled || !isLiveAnalyze(job) || !job?.job_id || !job.ticker) {
          if (stored && !isLiveAnalyze(job)) clearActiveJob()
          return
        }
        const tk = job.ticker
        const ordered = enginesFromJob(job, stored?.engines || engines)
        onTickerChange?.(tk)
        setLocalTicker(tk)
        const pctRaw = job.progress?.pct
        setProgPct(
          pctRaw != null && !Number.isNaN(Number(pctRaw))
            ? Math.min(99, Math.round(Number(pctRaw) * 100))
            : null,
        )
        setProgLbl(job.progress?.label || `${tk} still running…`)
        onStart?.()
        await followJob(job.job_id, tk, ordered, true)
      })()
    })
    return () => {
      cancelled = true
      stop()
      pollAbort.current?.abort()
    }
    // Mount-only: re-attach whatever is live on the server / session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External run trigger (Desk board / parent → Report)
  useEffect(() => {
    if (runToken && runToken > 0 && ticker.trim()) {
      void runAnalysis()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on runToken
  }, [runToken])

  const cancel = async () => {
    if (!activeJobId) return
    setCanceling(true)
    setProgLbl('Canceling…')
    try {
      await api(`/api/jobs/${encodeURIComponent(activeJobId)}/cancel`, { method: 'POST' })
    } catch {
      setCanceling(false)
    }
  }

  return (
    <div className={`${styles.heroCard} ${bare ? styles.heroBare : ''}`}>
      {!bare && <div className={styles.heroLabel}>Analyze Ticker</div>}
      <div className={styles.heroRow}>
        <input
          className={styles.heroInput}
          placeholder="e.g. AAPL"
          autoCapitalize="characters"
          autoComplete="off"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runAnalysis()
          }}
          disabled={running}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => void runAnalysis()}
          disabled={running}
          className={styles.heroRun}
        >
          {running ? '…' : '⚡ RUN'}
        </Button>
        {running && activeJobId && (
          <Button variant="ghost" size="sm" onClick={() => void cancel()} disabled={canceling}>
            {canceling ? 'Canceling…' : '✕ Cancel'}
          </Button>
        )}
      </div>

      {showProg && (
        <div className={styles.heroProg}>
          <AnalysisScene
            size="card"
            step={progStep}
            engine={sceneEngine}
            label={progLbl || 'Queued…'}
            meta={progPct == null ? undefined : `${progPct}%`}
          />
          <div className={styles.heroProgHead}>
            <span className={styles.heroProgDot} />
            <span className={styles.heroProgLbl}>{progLbl || 'Queued…'}</span>
            <span className={styles.heroProgPct}>
              {progPct == null ? '' : `${progPct}%`}
            </span>
          </div>
          <div className={styles.heroProgTrack}>
            <div
              className={styles.heroProgFill}
              style={{ width: `${progPct == null ? 6 : Math.max(4, Math.min(100, progPct))}%` }}
            />
          </div>
          {trace.length > 0 && (
            <pre className={styles.heroTrace}>{trace.join('\n')}</pre>
          )}
        </div>
      )}

      {localOffline && engines.includes('local') && (
        <div className={`${styles.heroHint} ${styles.hintErr}`}>{localOffline}</div>
      )}

      {hint && (
        <div
          className={`${styles.heroHint} ${
            hintTone === 'err' ? styles.hintErr : hintTone === 'ok' ? styles.hintOk : ''
          }`}
        >
          {hint}
        </div>
      )}

      <div className={styles.heroMeta}>
        <span className={styles.enginesLbl}>Engines:</span>
        <span className={styles.engineChips} role="group" aria-label="Select analysis engines">
          {ENGINES.map((e) => {
            const on = engines.includes(e.id)
            return (
              <button
                key={e.id}
                type="button"
                className={`${styles.engineChip} ${on ? styles.engineChipOn : ''}`}
                /* pointerdown + flushSync = highlight on press, not on release */
                onPointerDown={(ev) => {
                  if (ev.button !== 0 || running) return
                  ev.preventDefault()
                  toggleEngine(e.id)
                }}
                onClick={(ev) => {
                  // Keyboard / accessibility path (Space/Enter)
                  if (ev.detail === 0) toggleEngine(e.id)
                }}
                disabled={running}
                aria-pressed={on}
                title={`${e.label} · ${on ? 'selected' : 'off'} · click to toggle`}
              >
                {e.label}
              </button>
            )
          })}
        </span>
        <span className={styles.costEst} title={costTitle} aria-live="polite">
          {costLabel}
        </span>
        <label className={styles.gammaLabel}>
          <input
            type="checkbox"
            checked={gamma}
            onChange={(e) => setGamma(e.target.checked)}
            disabled={running}
          />
          Gamma deck
        </label>
      </div>
    </div>
  )
}
