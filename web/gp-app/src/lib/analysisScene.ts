/** Tiny bus so any LLM / agent job can drive the engine-specific analysis graphic. */

export type SceneEngine = 'grok' | 'claude' | 'deepseek' | 'kimi' | string

export type AnalysisSceneState = {
  id: string
  label: string
  meta?: string
  engine?: SceneEngine
} | null

type Listener = (s: AnalysisSceneState) => void

let current: AnalysisSceneState = null
const listeners = new Set<Listener>()

export function inferSceneEngine(
  raw?: string | null,
  fallback: SceneEngine = 'grok',
): SceneEngine {
  const s = String(raw || '').toLowerCase()
  if (/\bclaude\b|opus|sonnet|anthropic/.test(s)) return 'claude'
  if (/\bgrok\b/.test(s)) return 'grok'
  if (/deepseek/.test(s)) return 'deepseek'
  if (/\bkimi\b/.test(s)) return 'kimi'
  return fallback
}

export function getAnalysisScene(): AnalysisSceneState {
  return current
}

export function subscribeAnalysisScene(fn: Listener): () => void {
  listeners.add(fn)
  fn(current)
  return () => {
    listeners.delete(fn)
  }
}

export function beginAnalysisScene(
  id: string,
  label: string,
  meta?: string,
  engine?: SceneEngine,
) {
  current = { id, label, meta, engine }
  listeners.forEach((fn) => fn(current))
}

export function updateAnalysisScene(
  id: string,
  label: string,
  meta?: string,
  engine?: SceneEngine,
) {
  if (current && current.id !== id) return
  current = { id, label, meta, engine }
  listeners.forEach((fn) => fn(current))
}

export function endAnalysisScene(id: string) {
  if (current?.id !== id) return
  current = null
  listeners.forEach((fn) => fn(null))
}
