import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Quote } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { fmtPct, pctClass } from '@/lib/format'
import { renderMd } from '@/lib/md'
import styles from './deskWidgets.module.css'

const STALE_MS = 18 * 60 * 60 * 1000

export type PulseRow = {
  sentiment?: string
  markdown?: string
  error?: string
  pct_change?: number | null
  ok?: boolean
  _scanned_at?: string | null
  scanned_at?: string | null
}

type LatestScan = {
  exists?: boolean
  scanned_at?: string | null
  results?: Record<string, PulseRow>
}

type ScanJob = {
  job_id?: string
  status?: string
  tickers_done?: string[]
  tickers?: string[]
  error?: string
}

function parseStamp(iso?: string | null): number {
  if (!iso) return NaN
  const t = iso.trim()
  const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(t) ? t : `${t.replace(' ', 'T')}Z`)
  return d.getTime()
}

function ageMs(res?: PulseRow): number {
  const t = parseStamp(res?._scanned_at || res?.scanned_at)
  if (!Number.isFinite(t)) return Infinity
  return Math.max(0, Date.now() - t)
}

function ageLabel(res?: PulseRow): string {
  const ms = ageMs(res)
  if (!Number.isFinite(ms)) return 'unknown age'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  if (m < 60 * 48) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

function pulseSummary(md?: string): string {
  if (!md) return ''
  const clean = (ln: string) =>
    ln.replace(/[*_`#>\[\]]/g, '').replace(/📰/g, '').trim()
  const lines = String(md).split('\n')
  for (const ln of lines) {
    const idx = ln.toLowerCase().indexOf('s move:')
    if (idx >= 0) return clean(ln.slice(idx + 7))
  }
  for (const ln of lines) {
    const txt = clean(ln)
    if (txt.length > 25 && !/^(HIGH|MED|LOW|#)/.test(txt)) return txt
  }
  return ''
}

function quotePct(q?: Quote | null, pulsePct?: number | null): number | null {
  if (q) {
    const v = q.pct ?? q.pct_change
    if (v != null && !Number.isNaN(Number(v))) return Number(v)
  }
  if (pulsePct != null && !Number.isNaN(Number(pulsePct))) return Number(pulsePct)
  return null
}

function sentClass(raw?: string): string {
  const s = String(raw || '').toUpperCase()
  if (s === 'BULLISH') return styles.sentBull
  if (s === 'BEARISH') return styles.sentBear
  if (s === 'NEUTRAL') return styles.sentFlat
  return styles.sentUnk
}

export function MarketPulse({
  watchlist = [],
  quotes = {},
  bare = false,
}: {
  watchlist?: string[]
  quotes?: Record<string, Quote>
  bare?: boolean
}) {
  const [data, setData] = useState<LatestScan | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [openTk, setOpenTk] = useState<string | null>(null)
  const [rescanning, setRescanning] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      const d = await api<LatestScan>('/api/scan/latest')
      setData(d)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Pulse unavailable')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => {
      if (document.hidden) return
      void load()
    }, 3 * 60_000)
    return () => window.clearInterval(id)
  }, [load])

  const wlSet = useMemo(
    () => new Set(watchlist.map((t) => t.toUpperCase()).filter(Boolean)),
    [watchlist],
  )

  const entries = useMemo(() => {
    const all = Object.entries(data?.results || {})
    const filtered = wlSet.size
      ? all.filter(([tk]) => wlSet.has(tk.toUpperCase()))
      : all
    const rows = (filtered.length ? filtered : all).map(([tk, res]) => {
      const q = quotes[tk] || quotes[tk.toUpperCase()]
      const pct = quotePct(q, res?.pct_change)
      return {
        tk,
        res: res || {},
        pct,
        abs: pct == null ? -1 : Math.abs(pct),
        stale: ageMs(res) > STALE_MS,
      }
    })
    // Same ranking as Desk watchlist: biggest |day %| first.
    rows.sort((a, b) => b.abs - a.abs || a.tk.localeCompare(b.tk))
    return rows
  }, [data, wlSet, quotes])

  const newest = useMemo(() => {
    let best = 0
    for (const { res } of entries) {
      const t = parseStamp(res._scanned_at || res.scanned_at)
      if (Number.isFinite(t)) best = Math.max(best, t)
    }
    return best || parseStamp(data?.scanned_at || null)
  }, [entries, data])

  const pollJob = async (jobId: string) => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      const j = await api<ScanJob>(`/api/scan/${encodeURIComponent(jobId)}`).catch(
        () => null,
      )
      const st = (j?.status || '').toLowerCase()
      const done = (j?.tickers_done || []).length
      const tot = (j?.tickers || []).length
      if (tot) setStatus(`Scanning ${done}/${tot}…`)
      if (st === 'done' || st === 'completed' || st === 'cancelled' || st === 'failed') {
        if (j?.error) setErr(j.error)
        break
      }
      if (i % 3 === 2) await load()
    }
    await load()
  }

  const runPulse = async () => {
    const n = wlSet.size || watchlist.length
    if (!n) {
      setStatus('Watchlist is empty — add tickers first.')
      return
    }
    const ok = window.confirm(
      `Run Market Pulse on ${n} watchlist ticker${n === 1 ? '' : 's'}?\n\n` +
        'Live web + X search per name (Settings → Models · market_pulse). ' +
        'Opening Desk never starts a scan on its own.',
    )
    if (!ok) return
    setBusy(true)
    setErr(null)
    setStatus('Starting scan…')
    try {
      const job = await api<ScanJob>('/api/scan', { method: 'POST', body: '{}' })
      if (job.job_id && job.status !== 'done') await pollJob(job.job_id)
      else await load()
      setStatus('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Scan failed')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const rescanOne = async (tk: string) => {
    setRescanning((s) => ({ ...s, [tk]: true }))
    try {
      const job = await api<ScanJob>(`/api/scan/ticker/${encodeURIComponent(tk)}`, {
        method: 'POST',
      })
      if (job.job_id && job.status !== 'done') {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 2500))
          const j = await api<ScanJob>(`/api/scan/${encodeURIComponent(job.job_id)}`).catch(
            () => null,
          )
          const st = (j?.status || '').toLowerCase()
          if (st === 'done' || st === 'completed' || st === 'failed') break
        }
      }
      await load()
    } catch {
      /* keep previous row */
    } finally {
      setRescanning((s) => ({ ...s, [tk]: false }))
    }
  }

  const toggleRow = (tk: string, res: PulseRow, stale: boolean) => {
    const next = openTk === tk ? null : tk
    setOpenTk(next)
    if (next && (stale || !res.markdown)) void rescanOne(tk)
  }

  const headerAge = Number.isFinite(newest) && newest
    ? `${Math.round((Date.now() - newest) / 60_000) < 60
        ? `${Math.max(1, Math.round((Date.now() - newest) / 60_000))}m`
        : `${Math.round((Date.now() - newest) / 3_600_000)}h`} ago`
    : '—'
  const staleN = entries.filter((e) => e.stale).length

  const body = (
    <div className={styles.pulseEmbed}>
      <div className={styles.pulseToolbar}>
        <span className={styles.wireHint}>
          {headerAge}
          {staleN ? ` · ${staleN} stale` : ''}
          {entries.length ? ` · ${entries.length}` : ''}
        </span>
        <div className={styles.pulseActions}>
          <button
            type="button"
            className={styles.pulseInfoBtn}
            title="What Market Pulse does"
            onClick={() => setInfoOpen((o) => !o)}
          >
            *
          </button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void runPulse()}>
            {busy ? 'Scanning…' : 'Run Pulse'}
          </Button>
        </div>
      </div>
      {infoOpen && (
        <div className={styles.pulseInfo}>
          Live web + X search for each watchlist name. Tags Bullish / Bearish /
          Neutral with the day’s driver. Runs on your Settings schedule or when
          you tap Run Pulse — opening Desk only loads the last scan.
        </div>
      )}
      {status && <div className={styles.pulseStatus}>{status}</div>}
      <div className={styles.pulseList}>
        {err && !entries.length && <div className={styles.wireEmpty}>{err}</div>}
        {!err && !entries.length && (
          <div className={styles.wireEmpty}>
            No pulse yet — click Run Pulse to scan your watchlist.
          </div>
        )}
        {entries.map(({ tk, res, pct, stale }) => {
          const sent = String(res.sentiment || 'UNKNOWN').toUpperCase()
          const line = res.error
            ? `⚠ ${res.error}`
            : rescanning[tk]
              ? '⏳ Rescanning…'
              : pulseSummary(res.markdown) || 'Scan result available.'
          const open = openTk === tk
          return (
            <div key={tk}>
              <button
                type="button"
                className={`${styles.pulseRow} ${stale ? styles.pulseRowStale : ''}`}
                onClick={() => toggleRow(tk, res, stale)}
              >
                <span className={styles.pulseTk}>{tk}</span>
                <span className={`${styles.pulsePill} ${sentClass(sent)}`}>
                  {sent === 'BULLISH' || sent === 'BEARISH' || sent === 'NEUTRAL'
                    ? sent
                    : '—'}
                </span>
                {pct != null && (
                  <span className={`tabular ${styles.pulseDay} ${pctClass(pct)}`}>
                    {fmtPct(pct)}
                  </span>
                )}
                {stale ? (
                  <span className={styles.pulseStale}>STALE · {ageLabel(res)}</span>
                ) : (
                  <span className={styles.pulseAge}>{ageLabel(res)}</span>
                )}
                <span className={styles.pulseSum}>{line}</span>
              </button>
              {open && (
                <div className={styles.pulseDetail}>
                  {stale && (
                    <div className={styles.pulseStaleBanner}>
                      Stale pulse · scanned {ageLabel(res)} · refreshing…
                    </div>
                  )}
                  <div
                    className={styles.md}
                    dangerouslySetInnerHTML={{
                      __html: renderMd(res.markdown || res.error || 'No detail available.'),
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  if (bare) return body
  return body
}
