/**
 * Live LLM cost estimates for Desk chips (Analyze / Analyst / Strategist).
 * Source of truth: GET /api/config/models → est.* (server pricing tables).
 */
import { useEffect, useState } from 'react'
import { api } from './api'
import type { AgentEngine } from './agentic'
import type { LlmProvider } from './api'

export type CostRange = [number, number]

/** Full equity report (Analyze Ticker) */
export const DEFAULT_REPORT_COST: Record<LlmProvider, CostRange> = {
  grok: [0.3, 0.6],
  claude: [0.5, 1.0],
  deepseek: [0.01, 0.05],
  kimi: [0.15, 0.6],
}

/** Multi-step Analyst agent */
export const DEFAULT_AGENTIC_COST: Record<AgentEngine, CostRange> = {
  claude: [0.05, 0.3],
  grok: [0.04, 0.25],
  deepseek: [0.01, 0.08],
}

/** Whole-book Portfolio Strategist (Opus 5, thinking off — matches ~$1 4.8 runs) */
export const DEFAULT_STRATEGIST_COST: Record<AgentEngine, CostRange> = {
  claude: [0.4, 1.2],
  grok: [0.25, 0.8],
  deepseek: [0.05, 0.25],
}

export type ModelsCatalog = {
  est?: Record<string, unknown>
  grok?: string
  claude?: string
}

function asRange(v: unknown, fallback: CostRange): CostRange {
  if (Array.isArray(v) && v.length >= 2) {
    const lo = Number(v[0])
    const hi = Number(v[1])
    if (!Number.isNaN(lo) && !Number.isNaN(hi) && lo >= 0 && hi >= lo) return [lo, hi]
  }
  return fallback
}

export function fmtUsd(n: number): string {
  if (n < 0.005) return n.toFixed(3)
  if (n < 0.1) {
    const s = n.toFixed(2)
    return s
  }
  return n.toFixed(2)
}

export function formatRange(r: CostRange, suffix = ''): string {
  const [lo, hi] = r
  const body = lo === hi ? `$${fmtUsd(lo)}` : `$${fmtUsd(lo)}–${fmtUsd(hi)}`
  return suffix ? `≈ ${body}${suffix}` : `≈ ${body}`
}

export function sumRanges(ranges: CostRange[]): CostRange {
  let lo = 0
  let hi = 0
  for (const [a, b] of ranges) {
    lo += a
    hi += b
  }
  return [lo, hi]
}

type CatalogState = {
  report: Record<LlmProvider, CostRange>
  agentic: Record<AgentEngine, CostRange>
  strategist: Record<AgentEngine, CostRange>
  models: { grok?: string; claude?: string }
  loaded: boolean
}

const INITIAL: CatalogState = {
  report: { ...DEFAULT_REPORT_COST },
  agentic: { ...DEFAULT_AGENTIC_COST },
  strategist: { ...DEFAULT_STRATEGIST_COST },
  models: {},
  loaded: false,
}

function parseCatalog(d: ModelsCatalog): CatalogState {
  const est = d.est || {}
  const report: Record<LlmProvider, CostRange> = {
    grok: asRange(est.grok_report, DEFAULT_REPORT_COST.grok),
    claude: asRange(est.claude_report, DEFAULT_REPORT_COST.claude),
    deepseek: asRange(est.deepseek_report, DEFAULT_REPORT_COST.deepseek),
    kimi: asRange(est.kimi_report, DEFAULT_REPORT_COST.kimi),
  }

  // Prefer per-engine maps from API; fall back to flat est.agentic / defaults
  const agenticFlat = asRange(est.agentic, DEFAULT_AGENTIC_COST.claude)
  const stratFlat = asRange(est.strategist, DEFAULT_STRATEGIST_COST.claude)
  const byA = (est.agentic_by_provider || {}) as Record<string, unknown>
  const byS = (est.strategist_by_provider || {}) as Record<string, unknown>

  const agentic: Record<AgentEngine, CostRange> = {
    claude: asRange(byA.claude, agenticFlat),
    grok: asRange(byA.grok, DEFAULT_AGENTIC_COST.grok),
    deepseek: asRange(byA.deepseek, DEFAULT_AGENTIC_COST.deepseek),
  }
  const strategist: Record<AgentEngine, CostRange> = {
    claude: asRange(byS.claude, stratFlat),
    grok: asRange(byS.grok, DEFAULT_STRATEGIST_COST.grok),
    deepseek: asRange(byS.deepseek, DEFAULT_STRATEGIST_COST.deepseek),
  }

  return {
    report,
    agentic,
    strategist,
    models: { grok: d.grok, claude: d.claude },
    loaded: true,
  }
}

let _cache: CatalogState | null = null
let _inflight: Promise<CatalogState> | null = null

/** Shared fetch — one request for all desk cards. */
export async function loadCostCatalog(force = false): Promise<CatalogState> {
  if (!force && _cache?.loaded) return _cache
  if (!force && _inflight) return _inflight
  _inflight = (async () => {
    try {
      const d = await api<ModelsCatalog>('/api/config/models')
      _cache = parseCatalog(d || {})
    } catch {
      _cache = { ...INITIAL, loaded: true }
    } finally {
      _inflight = null
    }
    return _cache!
  })()
  return _inflight
}

export function useCostCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>(_cache || INITIAL)
  useEffect(() => {
    let cancelled = false
    void loadCostCatalog().then((c) => {
      if (!cancelled) setState(c)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
