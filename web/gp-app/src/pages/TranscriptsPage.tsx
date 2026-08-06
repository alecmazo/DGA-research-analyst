import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import page from './page.module.css'
import styles from './TranscriptsPage.module.css'

type CoverageRow = {
  ticker?: string
  quarters?: number
  chunks?: number
  latest_call?: string
  freshness?: string
  freshness_label?: string
  days_since_latest?: number | null
  latest_source?: string
  sources?: string[]
}

type Coverage = {
  ok?: boolean
  error?: string
  freshness_summary?: Record<string, number>
  source_summary?: Record<string, { transcripts?: number; chunks?: number }>
  needs_topup_count?: number
  universe?:
    | number
    | {
        saved_reports?: number
        indexed?: number
        missing?: number
        missing_tickers?: string[]
      }
  note?: string
  coverage?: CoverageRow[]
  cost_hint?: string | { text?: string; note?: string }
  mode?: string
}

type YtRow = {
  id?: string
  title?: string
  url?: string
  person?: string
  created_at?: string
  company_count?: number
}

function asText(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return String(v)
  if (typeof v === 'object' && v && 'text' in v)
    return String((v as { text: unknown }).text)
  if (typeof v === 'object' && v && 'note' in v)
    return String((v as { note: unknown }).note)
  try {
    return JSON.stringify(v)
  } catch {
    return '—'
  }
}

export function TranscriptsPage() {
  const [data, setData] = useState<Coverage | null>(null)
  const [ytList, setYtList] = useState<YtRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [ytUrl, setYtUrl] = useState('')
  const [ytPerson, setYtPerson] = useState('')
  const [ytBusy, setYtBusy] = useState(false)

  const [backfillYears, setBackfillYears] = useState(3)
  const [syncQuarters, setSyncQuarters] = useState(4)
  const [syncMax, setSyncMax] = useState(40)
  const [jobBusy, setJobBusy] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [cov, list] = await Promise.all([
        api<Coverage>('/api/transcripts/calls/coverage'),
        api<{ transcripts?: YtRow[] } | YtRow[]>('/api/transcripts').catch(
          () => [],
        ),
      ])
      setData(cov)
      const rows = Array.isArray(list)
        ? list
        : Array.isArray((list as { transcripts?: YtRow[] }).transcripts)
          ? (list as { transcripts: YtRow[] }).transcripts
          : []
      setYtList(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load transcripts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pollJob = async (jobId: string, pathPrefix: string) => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      try {
        const j = await api<{
          status?: string
          label?: string
          error?: string
          progress?: { label?: string; pct?: number }
        }>(`${pathPrefix}/${encodeURIComponent(jobId)}`)
        const st = j.status || ''
        setStatus(j.progress?.label || j.label || st || 'Working…')
        if (st === 'done' || st === 'failed' || st === 'error' || st === 'canceled') {
          if (st !== 'done') {
            setErr(j.error || j.label || 'Job failed')
          }
          return
        }
      } catch {
        /* keep */
      }
    }
  }

  const ingestYt = async () => {
    if (!ytUrl.trim()) {
      setErr('Paste a YouTube URL first.')
      return
    }
    setYtBusy(true)
    setErr(null)
    setStatus('Starting YouTube ingest…')
    try {
      const j = await api<{ job_id?: string; ok?: boolean; error?: string }>(
        '/api/transcripts/youtube',
        {
          method: 'POST',
          body: JSON.stringify({
            url: ytUrl.trim(),
            person: ytPerson.trim() || null,
          }),
        },
      )
      if (j.job_id) {
        await pollJob(j.job_id, '/api/transcripts/jobs')
      }
      setStatus('✓ Ingest finished — refreshing…')
      setYtUrl('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ingest failed')
    } finally {
      setYtBusy(false)
    }
  }

  const runBackfill = async () => {
    setJobBusy(true)
    setErr(null)
    setStatus('Starting history backfill…')
    try {
      const j = await api<{ job_id?: string }>(
        '/api/transcripts/calls/backfill',
        {
          method: 'POST',
          body: JSON.stringify({ years: backfillYears }),
        },
      )
      if (j.job_id) await pollJob(j.job_id, '/api/transcripts/calls/sync')
      setStatus('✓ Backfill finished')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Backfill failed')
    } finally {
      setJobBusy(false)
    }
  }

  const runSync = async (mode: 'gap' | 'latest') => {
    setJobBusy(true)
    setErr(null)
    setStatus(mode === 'gap' ? 'Fill gap (free)…' : 'Latest calls…')
    try {
      const j = await api<{ job_id?: string }>('/api/transcripts/calls/sync', {
        method: 'POST',
        body: JSON.stringify({
          mode: mode === 'gap' ? 'gap' : 'latest',
          max_quarters: syncQuarters,
          max_names: syncMax,
          allow_grok: mode === 'latest' ? 1 : 0,
        }),
      })
      if (j.job_id) await pollJob(j.job_id, '/api/transcripts/calls/sync')
      setStatus('✓ Sync finished')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setJobBusy(false)
    }
  }

  const stopJobs = async () => {
    try {
      await api('/api/transcripts/calls/sync/cancel-all', { method: 'POST' })
      setStatus('Stop requested')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Stop failed')
    }
  }

  const fresh = data?.freshness_summary || {}
  const uni =
    data?.universe && typeof data.universe === 'object'
      ? data.universe
      : null
  const uniBadge =
    uni != null
      ? `${uni.indexed ?? 0}/${uni.saved_reports ?? 0}`
      : typeof data?.universe === 'number'
        ? String(data.universe)
        : '—'

  const coverage = Array.isArray(data?.coverage) ? data!.coverage! : []

  return (
    <div className={page.page}>
      <header className={page.hero}>
        <div>
          <p className={page.kicker}>Research</p>
          <h1 className={page.h1}>Transcripts</h1>
          <p className={page.sub}>
            Ingest interview &amp; keynote transcripts, index earnings calls,
            and browse coverage freshness.
          </p>
        </div>
        <div className={page.heroActions}>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </header>

      {err && <div className={page.bannerErr}>{err}</div>}
      {status && <div className={styles.status}>{status}</div>}

      {loading ? (
        <Spinner label="Loading transcript coverage…" />
      ) : (
        <>
          <div className={styles.grid2}>
            <Panel title="Ingest a YouTube transcript" badge="~$0.02–0.05">
              <p className={styles.hint}>
                Paste a YouTube URL (interview, keynote, fireside). We pull the
                transcript and extract companies mentioned.
              </p>
              <input
                className={styles.input}
                placeholder="https://www.youtube.com/watch?v=…"
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
              />
              <div className={styles.row}>
                <input
                  className={styles.input}
                  placeholder="Speaker (optional)"
                  value={ytPerson}
                  onChange={(e) => setYtPerson(e.target.value)}
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={ytBusy}
                  onClick={() => void ingestYt()}
                >
                  {ytBusy ? '…' : 'Ingest ▶'}
                </Button>
              </div>
              {ytList.length > 0 && (
                <ul className={styles.ytList}>
                  {ytList.slice(0, 12).map((t, i) => (
                    <li key={t.id || i}>
                      <strong>{t.title || t.url || 'Transcript'}</strong>
                      {t.person && <span> · {t.person}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Earnings-call index" badge={uniBadge}>
              <p className={styles.hint}>
                Index earnings calls for saved-report tickers. Backfill = free
                history. Fill gap = free sources. Latest = free → Grok cascade.
              </p>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={jobBusy}
                  onClick={() => void runBackfill()}
                >
                  📚 Backfill · free
                </Button>
                <label className={styles.lbl}>
                  years
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={backfillYears}
                    onChange={(e) => setBackfillYears(Number(e.target.value))}
                    className={styles.num}
                  />
                </label>
              </div>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={jobBusy}
                  onClick={() => void runSync('gap')}
                >
                  🕳 Fill gap · free
                </Button>
              </div>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={jobBusy}
                  onClick={() => void runSync('latest')}
                >
                  ⚡ Latest calls
                </Button>
                <label className={styles.lbl}>
                  qtrs
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={syncQuarters}
                    onChange={(e) => setSyncQuarters(Number(e.target.value))}
                    className={styles.num}
                  />
                </label>
                <label className={styles.lbl}>
                  max
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={syncMax}
                    onChange={(e) => setSyncMax(Number(e.target.value))}
                    className={styles.num}
                  />
                </label>
                {jobBusy && (
                  <Button size="sm" variant="ghost" onClick={() => void stopJobs()}>
                    ⏹ Stop
                  </Button>
                )}
              </div>
              {data?.cost_hint != null && (
                <p className={styles.hint}>{asText(data.cost_hint)}</p>
              )}
              {data?.note && <p className={styles.hint}>{asText(data.note)}</p>}
            </Panel>
          </div>

          <div className={styles.kpiRow}>
            {Object.entries(fresh).map(([k, v]) => (
              <div key={k} className={styles.kpi}>
                <div className={styles.kpiLabel}>{k}</div>
                <div className={styles.kpiVal}>
                  {typeof v === 'number' ? v : asText(v)}
                </div>
              </div>
            ))}
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Needs top-up</div>
              <div className={styles.kpiVal}>
                {data?.needs_topup_count ?? '—'}
              </div>
            </div>
            {uni && (
              <div className={styles.kpi}>
                <div className={styles.kpiLabel}>Missing</div>
                <div className={styles.kpiVal}>{uni.missing ?? '—'}</div>
              </div>
            )}
          </div>

          <Panel title="Call index coverage" badge={coverage.length || '0'} flush>
            {!coverage.length ? (
              <Empty
                title="No call chunks indexed yet"
                sub="Run Backfill or Fill gap above to populate the earnings-call index."
              />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Freshness</th>
                      <th>Latest call</th>
                      <th className="tabular">Days</th>
                      <th className="tabular">Qtrs</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.slice(0, 120).map((c, i) => (
                      <tr key={`${c.ticker}-${i}`}>
                        <td className={styles.tk}>{c.ticker || '—'}</td>
                        <td>
                          <span
                            className={`${styles.fresh} ${
                              styles[`f_${c.freshness || ''}`] || ''
                            }`}
                          >
                            {c.freshness_label || c.freshness || '—'}
                          </span>
                        </td>
                        <td>{c.latest_call || '—'}</td>
                        <td className="tabular">
                          {c.days_since_latest ?? '—'}
                        </td>
                        <td className="tabular">{c.quarters ?? '—'}</td>
                        <td className={styles.src}>
                          {c.latest_source ||
                            (c.sources && c.sources[0]) ||
                            '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
