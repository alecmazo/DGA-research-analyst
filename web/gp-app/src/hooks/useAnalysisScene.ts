import { useEffect } from 'react'
import {
  beginAnalysisScene,
  endAnalysisScene,
  updateAnalysisScene,
} from '@/lib/analysisScene'

/** Push this job into the global Foundation “behind the scenes” graphic. */
export function useAnalysisScene(
  id: string,
  active: boolean,
  label: string,
  meta?: string,
) {
  useEffect(() => {
    if (!active) {
      endAnalysisScene(id)
      return
    }
    beginAnalysisScene(id, label || 'Working…', meta)
    return () => endAnalysisScene(id)
  }, [id, active])

  useEffect(() => {
    if (!active) return
    updateAnalysisScene(id, label || 'Working…', meta)
  }, [id, active, label, meta])
}
