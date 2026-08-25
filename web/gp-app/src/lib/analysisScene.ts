/** Tiny bus so any LLM / agent job can drive the Foundation analysis graphic. */

export type AnalysisSceneState = {
  id: string
  label: string
  meta?: string
} | null

type Listener = (s: AnalysisSceneState) => void

let current: AnalysisSceneState = null
const listeners = new Set<Listener>()

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

export function beginAnalysisScene(id: string, label: string, meta?: string) {
  current = { id, label, meta }
  listeners.forEach((fn) => fn(current))
}

export function updateAnalysisScene(id: string, label: string, meta?: string) {
  if (current && current.id !== id) return
  current = { id, label, meta }
  listeners.forEach((fn) => fn(current))
}

export function endAnalysisScene(id: string) {
  if (current?.id !== id) return
  current = null
  listeners.forEach((fn) => fn(null))
}
