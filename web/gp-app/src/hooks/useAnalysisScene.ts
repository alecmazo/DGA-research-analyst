import { useEffect } from 'react'
import {
  beginAnalysisScene,
  endAnalysisScene,
  updateAnalysisScene,
  type SceneEngine,
} from '@/lib/analysisScene'

/** Push this job into the global engine-specific “behind the scenes” graphic. */
export function useAnalysisScene(
  id: string,
  active: boolean,
  label: string,
  meta?: string,
  engine?: SceneEngine,
) {
  useEffect(() => {
    if (!active) {
      endAnalysisScene(id)
      return
    }
    beginAnalysisScene(id, label || 'Working…', meta, engine)
    return () => endAnalysisScene(id)
  }, [id, active])

  useEffect(() => {
    if (!active) return
    updateAnalysisScene(id, label || 'Working…', meta, engine)
  }, [id, active, label, meta, engine])
}
