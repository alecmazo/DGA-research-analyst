import { api } from './api'

export type AgentEngine = 'claude' | 'grok' | 'deepseek'

export type AgenticToolCall = {
  tool?: string
  input?: unknown
}

export type AgenticResult = {
  answer?: string
  cost_usd?: number
  model?: string
  tool_calls?: AgenticToolCall[]
  verification?: {
    verdict?: string
    flags?: Array<{ issue?: string; claim?: string; note?: string }>
  }
}

export type AgenticJob = {
  ok?: boolean
  status?: string
  label?: string
  steps?: number
  cost_usd?: number
  error?: string
  tool_calls?: AgenticToolCall[]
  result?: AgenticResult
}

export const AGENT_ENGINES: { id: AgentEngine; label: string; title: string }[] = [
  { id: 'claude', label: 'Claude', title: 'Claude Opus 5 · tool-use default' },
  { id: 'grok', label: 'Grok', title: 'Grok 4.6 · live/current markets' },
  { id: 'deepseek', label: 'DeepSeek', title: 'DeepSeek · cheapest agent path' },
]

export function loadEngine(key: string, fallback: AgentEngine = 'claude'): AgentEngine {
  try {
    const v = (localStorage.getItem(key) || '').toLowerCase()
    if (v === 'claude' || v === 'grok' || v === 'deepseek') return v
  } catch {
    /* ignore */
  }
  return fallback
}

export function saveEngine(key: string, eng: AgentEngine) {
  try {
    localStorage.setItem(key, eng)
  } catch {
    /* ignore */
  }
}

export function engLabel(eng: AgentEngine) {
  if (eng === 'grok') return 'Grok'
  if (eng === 'deepseek') return 'DeepSeek'
  return 'Claude'
}

/** Instant engine pick for React desk chips (call inside flushSync). */
export function pickAndSaveEngine(
  key: string,
  eng: AgentEngine,
  setEngine: (e: AgentEngine) => void,
) {
  setEngine(eng)
  saveEngine(key, eng)
}

/** Poll agentic job until done/error/timeout. Calls onTick while running. */
export async function pollAgenticJob(
  jobId: string,
  onTick?: (job: AgenticJob, elapsedMs: number) => void,
  opts?: { intervalMs?: number; maxMs?: number },
): Promise<AgenticResult> {
  const interval = opts?.intervalMs ?? 1500
  const maxMs = opts?.maxMs ?? 14 * 60 * 1000
  const t0 = Date.now()

  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, interval))
    let j: AgenticJob
    try {
      j = await api<AgenticJob>(`/api/research/agentic/${encodeURIComponent(jobId)}`)
    } catch {
      continue
    }
    onTick?.(j, Date.now() - t0)
    if (j.status === 'done' && j.result) return j.result
    if (j.status === 'error') throw new Error(j.label || j.error || 'failed')
  }
  throw new Error('Timed out waiting for agent. Check saved analyses — server may still finish.')
}

export type ResearchPdfBody = {
  title?: string
  question?: string
  answer_html?: string
  stamp?: string
  filename?: string
  kind?: 'analyst' | 'strategist' | string
  model?: string
  fund_name?: string
  tickers?: string
  cost_usd?: number
  verification?: AgenticResult['verification']
  to?: string
  subject?: string
}

export async function researchPdfDownload(body: ResearchPdfBody) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  try {
    const token = localStorage.getItem('dga_v2_token')
    if (token) headers.set('x-auth-v2-token', token)
  } catch {
    /* ignore */
  }
  const win = window.open('', '_blank')
  if (win) {
    try {
      win.document.write(
        '<p style="font-family:sans-serif;color:#64748b;padding:20px;">Generating PDF…</p>',
      )
    } catch {
      /* ignore */
    }
  }
  try {
    const res = await fetch('/api/research/pdf', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let m = ''
      try {
        m = String((await res.json()).detail || '')
      } catch {
        /* ignore */
      }
      throw new Error(m || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    if (win) win.location.href = url
    else window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    if (win) {
      try {
        win.close()
      } catch {
        /* ignore */
      }
    }
    throw e
  }
}

export async function researchPdfEmail(body: ResearchPdfBody & { to: string }) {
  return api<{ ok?: boolean; detail?: string }>('/api/research/email-pdf', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
