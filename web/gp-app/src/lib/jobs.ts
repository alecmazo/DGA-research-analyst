import { api, type JobStatus } from './api'

export type PollHandlers = {
  onProgress?: (pct: number | null, label: string, job: JobStatus) => void
  onDone?: (job: JobStatus) => void
  onFail?: (job: JobStatus) => void
  onCanceled?: (job: JobStatus) => void
}

/** Poll `/api/jobs/{id}` until done / failed / canceled. Resolves with final job. */
export function pollJob(
  jobId: string,
  handlers: PollHandlers = {},
  intervalMs = 1500,
): Promise<JobStatus> {
  let miss = 0
  let lastPct: number | null = null
  let lastLbl = ''
  let lastChangeAt = Date.now()
  const STALL_MS = 12 * 60 * 1000

  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const job = await api<JobStatus>(`/api/jobs/${encodeURIComponent(jobId)}`)
        if (!job || !job.status) {
          miss += 1
          if (miss >= 4) {
            window.clearInterval(iv)
            const failed: JobStatus = {
              status: 'failed',
              job_id: jobId,
              error: 'Job lost or unavailable',
            }
            handlers.onFail?.(failed)
            resolve(failed)
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
          window.clearInterval(iv)
          handlers.onDone?.(job)
          resolve(job)
          return
        }
        if (job.status === 'failed') {
          window.clearInterval(iv)
          handlers.onFail?.(job)
          resolve(job)
          return
        }
        if (job.status === 'canceled' || job.status === 'cancelled') {
          window.clearInterval(iv)
          handlers.onCanceled?.(job)
          resolve(job)
        }
      } catch (e) {
        miss += 1
        if (miss >= 4) {
          window.clearInterval(iv)
          const failed: JobStatus = {
            status: 'failed',
            job_id: jobId,
            error: e instanceof Error ? e.message : 'Poll failed',
          }
          handlers.onFail?.(failed)
          resolve(failed)
        }
      }
    }

    const iv = window.setInterval(() => void tick(), intervalMs)
    void tick()
  })
}
