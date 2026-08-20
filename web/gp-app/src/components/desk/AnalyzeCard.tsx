import { useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { api, type JobStatus, type LlmProvider } from '@/lib/api'
import { pollJob } from '@/lib/jobs'
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
]

const STORAGE_KEY = 'dga.hero.engines.v3'

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
  const costs = useCostCatalog()
  const [gamma, setGamma] = useState(false)
  const [running, setRunning] = useState(false)
  const [hint, setHint] = useState('')
  const [hintTone, setHintTone] = useState<'ok' | 'err' | 'mid'>('mid')
  const [progPct, setProgPct] = useState<number | null>(null)
  const [progLbl, setProgLbl] = useState('')
  const [showProg, setShowProg] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(engines))
    } catch {
      /* ignore */
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
      const [a, b] = costMap[e] || DEFAULT_REPORT_COST[e]
      return `${e}: $${fmtUsd(a)}–${fmtUsd(b)} per report`
    })
    return (
      'Estimated LLM cost for selected engines (each run is saved separately). ' +
      parts.join('; ') +
      (gamma ? ' · Gamma deck adds cost on Grok only.' : '')
    )
  }, [engines, costMap, gamma])

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

    setRunning(true)
    setShowProg(true)
    setProgPct(null)
    setProgLbl(`${engines[0]} · 1/${engines.length} queued…`)
    setHintTone('mid')
    setHint(
      `Running ${engines.length} engine${engines.length > 1 ? 's' : ''} · ${engines.join(' + ')}${
        gamma ? ' · Gamma on Grok' : ''
      } · one job, each engine saved`,
    )

    try {
      setProgLbl(
        engines.length > 1
          ? `${engines[0]} · 1/${engines.length} queued…`
          : `${engines[0]} queued…`,
      )
      const job = await api<JobStatus>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          ticker: tk,
          generate_gamma: gamma,
          llm_provider: engines[0],
          llm_providers: engines,
        }),
      })
      const jobId = job.job_id
      if (!jobId) throw new Error('No job_id from analyze')
      setActiveJobId(jobId)
      onStart?.()

      const outcome = await pollJob(jobId, {
        onProgress: (pctInt, lbl) => {
          setProgPct(pctInt == null ? null : Math.min(99, pctInt))
          setProgLbl(lbl || '…')
        },
      })
      setActiveJobId(null)
      onComplete?.()

      setProgPct(100)
      setProgLbl('Complete')
      setTimeout(() => setShowProg(false), 650)

      if (outcome.status === 'canceled' || outcome.status === 'cancelled') {
        setHintTone('mid')
        setHint('Canceled — any finished engines were saved to Saved Reports.')
      } else {
        const provs = (outcome.result?.providers || {}) as Record<string, string>
        const names = Object.keys(provs)
        const okN = names.length
          ? names.filter((k) => provs[k] === 'done').length
          : outcome.status === 'done'
            ? engines.length
            : 0
        const failN = names.length
          ? names.filter((k) => provs[k] !== 'done').length
          : outcome.status === 'done'
            ? 0
            : engines.length
        const failNames = names.filter((k) => provs[k] !== 'done')
        const c = outcome.result?.cost_usd
        const warn = outcome.warning || outcome.error || outcome.detail
        setHintTone(failN && !okN ? 'err' : failN ? 'mid' : 'ok')
        setHint(
          `${okN ? `✅ ${okN} report${okN > 1 ? 's' : ''} saved` : '❌ none saved'}${
            failN ? ` · ${failN} failed${failNames.length ? ` (${failNames.join(', ')})` : ''}` : ''
          }${c != null && !Number.isNaN(Number(c)) ? ` · $${Number(c).toFixed(2)}` : ''} — see Saved Reports${
            warn && failN ? ` · ${String(warn).slice(0, 140)}` : ''
          }`,
        )
      }
    } catch (e) {
      setShowProg(false)
      setActiveJobId(null)
      setHintTone('err')
      setHint(`Error: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setRunning(false)
      setCanceling(false)
    }
  }, [ticker, engines, gamma, onComplete, onStart])

  // External run trigger (Idea Generator / Prioritize → Report)
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
        </div>
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
