import { api, type JobStatus } from './api'

export type PollHandlers = {
  onProgress?: (pct: number | null, label: string, job: JobStatus) => void
  onDone?: (job: JobStatus) => void
  onFail?: (job: JobStatus) => void
  onCanceled?: (job: JobStatus) => void
}

/** Poll `/api/jobs/{id}` until done / failed / canceled. Resolves with final job.
 *  Pass an AbortSignal so leaving the Desk tab stops the timer without losing
 *  the server-side job (AnalyzeCard re-attaches on return). */
export function pollJob(
  jobId: string,
  handlers: PollHandlers = {},
  intervalMs = 1500,
  signal?: AbortSignal,
): Promise<JobStatus> {
  let miss = 0
  let lastPct: number | null = null
  let lastLbl = ''
  let lastChangeAt = Date.now()
  const STALL_MS = 12 * 60 * 1000

  return new Promise((resolve) => {
    let iv = 0
    let settled = false
    const finish = (job: JobStatus) => {
      if (settled) return
      settled = true
      window.clearInterval(iv)
      signal?.removeEventListener('abort', onAbort)
      resolve(job)
    }
    const onAbort = () => finish({ job_id: jobId, status: 'aborted' })
    if (signal?.aborted) {
      finish({ job_id: jobId, status: 'aborted' })
      return
    }
    signal?.addEventListener('abort', onAbort)

    const tick = async () => {
      if (settled || signal?.aborted) return
      try {
        const job = await api<JobStatus>(`/api/jobs/${encodeURIComponent(jobId)}`)
        if (!job || !job.status) {
          miss += 1
          if (miss >= 25) {
            const failed: JobStatus = {
              status: 'failed',
              job_id: jobId,
              error: 'Job lost or unavailable',
            }
            handlers.onFail?.(failed)
            finish(failed)
          }
          return
        }
        miss = 0

        const pctRaw = job.progress?.pct
        const lbl = job.progress?.label || ''
        const pctInt =
          pctRaw != null && !Number.isNaN(Number(pctRaw))
            ? Math.round(Number(pctRaw) * 100)
            : null

        let showLbl = lbl
        if (pctInt !== lastPct || lbl !== lastLbl) {
          lastPct = pctInt
          lastLbl = lbl
          lastChangeAt = Date.now()
        } else if (job.status === 'running' && Date.now() - lastChangeAt > STALL_MS) {
          showLbl = `${lbl || 'Working'} · still running (LLM can take several minutes)…`
        }
        handlers.onProgress?.(pctInt, showLbl, job)

        if (job.status === 'done') {
          handlers.onDone?.(job)
          finish(job)
          return
        }
        if (job.status === 'failed') {
          handlers.onFail?.(job)
          finish(job)
          return
        }
        if (job.status === 'canceled' || job.status === 'cancelled') {
          handlers.onCanceled?.(job)
          finish(job)
        }
      } catch (e) {
        miss += 1
        if (miss >= 25) {
          const failed: JobStatus = {
            status: 'failed',
            job_id: jobId,
            error: e instanceof Error ? e.message : 'Poll failed',
          }
          handlers.onFail?.(failed)
          finish(failed)
        }
      }
    }

    iv = window.setInterval(() => void tick(), intervalMs)
    void tick()
  })
}
