import { useCallback, useEffect, useRef, useState } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import type {
  CoverageRow,
  FinSettings,
  NightlyLast,
  SyncJob,
  UniverseKey,
  UniversesMeta,
} from './types'
import styles from '../FinancialsPage.module.css'

const CHIP_CAP = 120
const COLLAPSE_AT = 40

type Props = {
  coverage: CoverageRow[]
  onCoverageChange: () => void
  onSelectTicker: (tk: string) => void
}

export function FinancialsStore({
  coverage,
  onCoverageChange,
  onSelectTicker,
}: Props) {
  const [universe, setUniverse] = useState<UniverseKey>('followed')
  const [years, setYears] = useState(7)
  const [tickers, setTickers] = useState('')
  const [statusHtml, setStatus] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [overnightBusy, setOvernightBusy] = useState(false)
  const [nightly, setNightly] = useState(false)
  const [monthly, setMonthly] = useState(false)
  const [usBackfill, setUsBackfill] = useState(false)
  const [autoHint, setAutoHint] = useState('')
  const [metaLine, setMetaLine] = useState('')
  const [nightlyLast, setNightlyLast] = useState<NightlyLast | null>(null)
  const [coverageOpen, setCoverageOpen] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const savingRef = useRef(false)

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const loadSettings = useCallback(async () => {
    try {
      const s = await api<FinSettings>('/api/financials/settings')
      if (!s || s.ok === false) return
      if (s.fin_nightly) setNightly(!!s.fin_nightly.enabled)
      if (s.fin_monthly) setMonthly(!!s.fin_monthly.enabled)
      if (s.fin_us_backfill) setUsBackfill(!!s.fin_us_backfill.enabled)
      const n = s.followed_count != null ? s.followed_count : '?'
      let t = `${n} followed names`
      if (s.fin_nightly?.last?.ts)
        t += ` · last nightly ${String(s.fin_nightly.last.ts).slice(0, 16).replace('T', ' ')}`
      const uc = s.fin_nightly?.last?.updated_count
      if (uc != null) t += ` · ${uc} new filing${uc === 1 ? '' : 's'}`
      setAutoHint(t)
      if (s.fin_nightly?.last) setNightlyLast(s.fin_nightly.last)
    } catch {
      /* ignore */
    }
  }, [])

  const loadUniverses = useCallback(async () => {
    try {
      const u = await api<UniversesMeta>('/api/financials/universes')
      if (!u || !u.ok) return
      const bits: string[] = []
      if (u.followed?.count != null) bits.push(`My companies: ${u.followed.count}`)
      if (u.stored_tickers != null)
        bits.push(`In DB: ${Number(u.stored_tickers).toLocaleString()}`)
      if (u.stored_bytes)
        bits.push(`Table ~${(u.stored_bytes / 1e6).toFixed(1)} MB`)
      if (u.nightly) {
        bits.push(`Nightly ${u.nightly.enabled ? 'ON' : 'OFF'}`)
        const last = u.nightly.last
        if (last && (last.ts || last.at))
          bits.push(
            `last nightly ${String(last.ts || last.at).slice(0, 16).replace('T', ' ')}`,
          )
        if (last && last.updated_count != null)
          bits.push(
            `${last.updated_count} new filing${last.updated_count === 1 ? '' : 's'}`,
          )
      }
      if (u.monthly) bits.push(`Monthly ${u.monthly.enabled ? 'ON' : 'OFF'}`)
      if (u.us_backfill)
        bits.push(`US backfill ${u.us_backfill.enabled ? 'ON' : 'OFF'}`)
      setMetaLine(
        `${bits.join(' · ')} · free SEC · zero LLM tokens · browse = free`,
      )
      if (u.nightly?.last) setNightlyLast(u.nightly.last)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadSettings()
    void loadUniverses()
    return () => stopPoll()
  }, [loadSettings, loadUniverses])

  useEffect(() => {
    if (coverage.length >= COLLAPSE_AT) setCoverageOpen(false)
  }, [coverage.length])

  const saveAuto = async (next?: {
    nightly?: boolean
    monthly?: boolean
    us?: boolean
  }) => {
    if (savingRef.current) return
    savingRef.current = true
    const body = {
      fin_nightly: { enabled: next?.nightly ?? nightly },
      fin_monthly: { enabled: next?.monthly ?? monthly },
      fin_us_backfill: { enabled: next?.us ?? usBackfill },
    }
    try {
      const j = await api<{ ok?: boolean; error?: string }>(
        '/api/financials/settings',
        { method: 'POST', body: JSON.stringify(body) },
      )
      if (j && j.ok === false) throw new Error(j.error || 'Save failed')
      await loadSettings()
      await loadUniverses()
    } catch (e) {
      setStatus(
        `Could not save auto settings: ${e instanceof Error ? e.message : e}`,
      )
    }
    savingRef.current = false
  }

  const pollJob = (jobId: string) => {
    stopPoll()
    const t0 = Date.now()
    let lastDone = -1
    let stuckSince = Date.now()
    let resumeAttempts = 0
    pollRef.current = setInterval(() => {
      void (async () => {
        if (Date.now() - t0 > 4 * 3600 * 1000) {
          stopPoll()
          setStatus(
            'Still running in the background — safe to close this tab. Re-open Financials later; coverage updates as rows land.',
          )
          setPulling(false)
          setOvernightBusy(false)
          return
        }
        try {
          const s = await api<SyncJob>(
            `/api/financials/sync/${encodeURIComponent(jobId)}`,
          )
          if (
            s &&
            s.ok === false &&
            s.resumable &&
            resumeAttempts < 2
          ) {
            resumeAttempts++
            setStatus('↻ Job handle lost (deploy?) — starting one more gap-fill chunk…')
            try {
              const jj = await api<{ ok?: boolean; job_id?: string }>(
                '/api/financials/overnight',
                {
                  method: 'POST',
                  body: JSON.stringify({ mode: 'us_chunk', years_back: 6 }),
                },
              )
              if (jj.ok && jj.job_id) {
                stopPoll()
                pollJob(jj.job_id)
                return
              }
            } catch {
              /* ignore */
            }
          }
          if (s.status === 'done') {
            stopPoll()
            const n = s.result?.periods_stored || 0
            setStatus(
              `✓ ${s.label || 'Done'}${n ? ` · ${n} periods` : ''}`,
            )
            setPulling(false)
            setOvernightBusy(false)
            setCoverageOpen(false)
            onCoverageChange()
            void loadUniverses()
          } else if (s.status === 'error') {
            stopPoll()
            setStatus(`❌ ${s.error || s.label || 'failed'}`)
            setPulling(false)
            setOvernightBusy(false)
          } else {
            const done = s.done != null ? s.done : 0
            const total = s.total != null ? s.total : 0
            if (done !== lastDone) {
              lastDone = done
              stuckSince = Date.now()
            }
            let extra = ''
            if (done === 0 && total > 0 && Date.now() - stuckSince > 45000) {
              extra = ' · first SEC extract can take 30–90s (normal)'
            }
            const pct =
              total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0
            const stats =
              s.names_ok != null
                ? ` · +${s.names_ok} new names${s.names_fail != null ? ` · ${s.names_fail} no SEC data` : ''}`
                : ''
            setStatus(
              `${s.label || 'Working…'}${total ? ` · ${done}/${total} tried (${pct}%)` : ''}${stats}${extra}`,
            )
            if (
              done > 0 &&
              (done % 5 === 0 ||
                (s.names_ok != null && s.names_ok > 0 && done % 3 === 0))
            ) {
              onCoverageChange()
            }
          }
        } catch {
          /* network blip — keep polling */
        }
      })()
    }, 2500)
  }

  const sync = async () => {
    const tkList = tickers
      .toUpperCase()
      .split(/[^A-Z.]+/)
      .filter(Boolean)
    if (universe === 'custom' && !tkList.length) {
      setStatus('Enter at least one ticker (e.g. NVDA) then pull.')
      return
    }
    setPulling(true)
    stopPoll()
    try {
      const j = await api<{
        ok?: boolean
        error?: string
        detail?: string
        job_id?: string
        count?: number
        tickers?: string[]
        universe?: string
      }>('/api/financials/sync', {
        method: 'POST',
        body: JSON.stringify({
          years_back: years,
          tickers: tkList,
          universe,
          refresh: true,
        }),
      })
      if (j && j.ok === false)
        throw new Error(j.error || j.detail || 'Failed')
      const nTk = j.count != null ? j.count : (j.tickers || []).length
      const uniLabel: Record<string, string> = {
        followed: 'my companies',
        reports: 'saved reports',
        custom: 'custom ticker(s)',
        sp500_nasdaq100: 'S&P+NDX comps',
        sp500: 'S&P 500',
        nasdaq100: 'Nasdaq-100',
      }
      setStatus(
        `📊 Pulling SEC XBRL for ${nTk} names · ${uniLabel[j.universe || universe] || universe}${nTk > 80 ? ' · large set can take a while; safe to leave the tab' : ' · usually a few minutes'}. Insert-only (no overwrite).`,
      )
      if (!j.job_id) {
        setPulling(false)
        return
      }
      pollJob(j.job_id)
    } catch (e) {
      setStatus(`❌ ${e instanceof Error ? e.message : e}`)
      setPulling(false)
    }
  }

  const backup = async () => {
    setBackupBusy(true)
    try {
      const j = await api<{ ok?: boolean; path?: string; error?: string; detail?: string }>(
        '/api/financials/backup',
        { method: 'POST' },
      )
      if (j && j.ok === false) throw new Error(j.error || j.detail || 'Failed')
      setStatus(`☁️ Backed up: ${j.path || 'ok'}`)
    } catch (e) {
      setStatus(`❌ Backup failed: ${e instanceof Error ? e.message : e}`)
    }
    setBackupBusy(false)
  }

  const overnight = async () => {
    setOvernightBusy(true)
    try {
      const j = await api<{
        ok?: boolean
        error?: string
        detail?: string
        job_id?: string
        have?: number
        missing?: number
        chunk?: number
      }>('/api/financials/overnight', {
        method: 'POST',
        body: JSON.stringify({ mode: 'us_chunk', years_back: 6 }),
      })
      if (j && j.ok === false) throw new Error(j.error || j.detail || 'Failed')
      setStatus(
        `🔧 One US gap-fill chunk · keeping ${j.have != null ? Number(j.have).toLocaleString() : '?'} stored · ${j.missing != null ? Number(j.missing).toLocaleString() : '?'} gaps remaining · chunk size ${j.chunk != null ? j.chunk : '~150'} · job ${j.job_id || ''}. Insert-only · continuous backfill stays off unless toggled.`,
      )
      if (j.job_id) pollJob(j.job_id)
      else setOvernightBusy(false)
    } catch (e) {
      setStatus(`❌ ${e instanceof Error ? e.message : e}`)
      setOvernightBusy(false)
    }
  }

  const badge =
    coverage.length > 0
      ? `${coverage.length.toLocaleString()} names`
      : 'empty'

  const show = coverage.slice(0, CHIP_CAP)
  const more = coverage.length - show.length

  const updated = Array.isArray(nightlyLast?.updated)
    ? nightlyLast!.updated!
    : Array.isArray(nightlyLast?.updated_tickers)
      ? nightlyLast!.updated_tickers!.map((t) => ({ ticker: t }))
      : []
  const nightTs = nightlyLast?.ts || nightlyLast?.at || ''
  const when = nightTs
    ? `${String(nightTs).slice(0, 16).replace('T', ' ')} UTC`
    : ''

  return (
    <CollapsibleCard
      id="fin-store-panel"
      title="📊 Financials store"
      badge={<span className={styles.badgeInfo}>{badge}</span>}
      defaultOpen={false}
    >
      <div className={styles.howto}>
        <div className={styles.howtoTitle}>How this works (cheap by design)</div>
        <ol>
          <li>
            <strong>Browsing</strong> company history, screens, rank cards =
            Postgres only. No SEC, no LLM, no Railway burn.
          </li>
          <li>
            <strong>⬇️ Pull SEC data</strong> downloads filings for the set you
            pick (or a custom ticker). Insert-only — never overwrites existing
            periods.
          </li>
          <li>
            <strong>Nightly auto</strong> re-checks only{' '}
            <em>your companies</em> — saved reports + watchlist — for new
            10-Q/10-K periods.
          </li>
          <li>
            <strong>Monthly auto</strong> lightly refreshes the oldest names
            already in the store (not the whole US list). Insert-only.
          </li>
          <li>
            New filings are <em>not</em> live the second they drop; they land on
            the next nightly (followed) or monthly (store) pass, or when you pull
            manually.
          </li>
        </ol>
      </div>

      <div className={styles.storeRow}>
        <label className={styles.fieldLbl}>
          Pull for
          <select
            className={styles.select}
            value={universe}
            onChange={(e) => setUniverse(e.target.value as UniverseKey)}
          >
            <option value="followed">My companies (reports + watchlist)</option>
            <option value="reports">Saved reports only</option>
            <option value="custom">Custom ticker(s)…</option>
            <option value="sp500_nasdaq100">S&P 500 + Nasdaq-100 comps (~550)</option>
            <option value="sp500">S&P 500 only</option>
            <option value="nasdaq100">Nasdaq-100 only</option>
          </select>
        </label>
        <label className={styles.fieldLbl}>
          years
          <input
            className={styles.years}
            type="number"
            min={1}
            max={20}
            value={years}
            onChange={(e) => setYears(parseInt(e.target.value || '7', 10))}
            title="How many years of history to request from SEC. 5–7 is enough for most work."
          />
        </label>
        <Button
          variant="primary"
          size="sm"
          disabled={pulling}
          onClick={() => void sync()}
        >
          {pulling ? '⏳ Pulling…' : '⬇️ Pull SEC data'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={backupBusy}
          onClick={() => void backup()}
        >
          {backupBusy ? '⏳ Uploading…' : '☁️ Backup'}
        </Button>
      </div>

      {universe === 'custom' && (
        <div className={styles.customRow}>
          <label className={styles.fieldLbl}>
            Ticker(s) to pull from SEC{' '}
            <span className={styles.mutedSm}>(comma or space separated)</span>
          </label>
          <div className={styles.storeRow}>
            <input
              className={styles.tickersInput}
              value={tickers}
              onChange={(e) => setTickers(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void sync()
                }
              }}
              placeholder="e.g. NVDA, AMD, INTC"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={pulling}
              onClick={() => void sync()}
            >
              Pull these tickers
            </Button>
          </div>
        </div>
      )}

      <div className={styles.autoRow}>
        <label className={styles.checkLbl}>
          <input
            type="checkbox"
            checked={nightly}
            onChange={(e) => {
              const v = e.target.checked
              setNightly(v)
              void saveAuto({ nightly: v })
            }}
          />
          <span>
            <strong>Nightly auto</strong> · my companies only
          </span>
        </label>
        <label className={styles.checkLbl}>
          <input
            type="checkbox"
            checked={monthly}
            onChange={(e) => {
              const v = e.target.checked
              setMonthly(v)
              void saveAuto({ monthly: v })
            }}
          />
          <span>
            <strong>Monthly auto</strong> · rest of store
          </span>
        </label>
        <span className={styles.mutedSm}>{autoHint}</span>
      </div>

      {/* Nightly updated banner */}
      {(updated.length > 0 || nightTs) && (
        <div
          className={
            updated.length > 0 ? styles.nightlyOk : styles.nightlyQuiet
          }
        >
          <div className={styles.nightlyTitle}>
            {updated.length > 0
              ? `Last nightly · new filings${when ? ` · ${when}` : ''} · ${updated.length} name${updated.length === 1 ? '' : 's'}`
              : `Last nightly${when ? ` · ${when}` : ''} · no new 10-Q/10-K periods`}
          </div>
          {updated.length > 0 ? (
            <div className={styles.chipRow}>
              {updated.map((raw, i) => {
                const u = raw as {
                  ticker?: string
                  latest_period_end?: string
                  excel_quarter_end?: string
                  fp?: string
                  prior_period_end?: string
                }
                const tk = (u && u.ticker) || ''
                if (!tk) return null
                const pe = u.latest_period_end || u.excel_quarter_end || ''
                const fp = u.fp || ''
                const lbl =
                  fp && pe
                    ? `${fp} ${String(pe).slice(0, 10)}`
                    : pe
                      ? String(pe).slice(0, 10)
                      : 'updated'
                return (
                  <button
                    key={`${tk}-${i}`}
                    type="button"
                    className={styles.nightlyChip}
                    title={
                      u.prior_period_end
                        ? `${tk} latest ${lbl} (was ${String(u.prior_period_end).slice(0, 10)})`
                        : `${tk} · ${lbl}`
                    }
                    onClick={() => onSelectTicker(tk)}
                  >
                    {tk}
                    {pe && <span className={styles.nightlyPe}> · {lbl}</span>}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className={styles.mutedSm}>
              All followed names were checked; store latest periods unchanged.
              Earnings 8-Ks alone do not update the store until the 10-Q files.
            </div>
          )}
        </div>
      )}

      {statusHtml && <div className={styles.syncStatus}>{statusHtml}</div>}
      {metaLine && <div className={styles.mutedSm}>{metaLine}</div>}

      <details className={styles.advanced}>
        <summary>Advanced · optional full-US gap fill</summary>
        <div className={styles.advancedBody}>
          <p>
            Not needed for day-to-day use. Runs one chunk of missing US-listed
            names (insert-only). Continuous backfill stays <strong>off</strong>{' '}
            unless you enable it — keeps Railway quiet.
          </p>
          <div className={styles.storeRow}>
            <Button
              variant="secondary"
              size="sm"
              disabled={overnightBusy}
              onClick={() => void overnight()}
            >
              {overnightBusy
                ? '⏳ Queuing…'
                : 'Run one US gap-fill chunk'}
            </Button>
            <label className={styles.checkLbl}>
              <input
                type="checkbox"
                checked={usBackfill}
                onChange={(e) => {
                  const v = e.target.checked
                  setUsBackfill(v)
                  void saveAuto({ us: v })
                }}
              />
              Continuous US backfill (off by default)
            </label>
          </div>
        </div>
      </details>

      <details
        className={styles.coverageDetails}
        open={coverageOpen}
        onToggle={(e) =>
          setCoverageOpen((e.target as HTMLDetailsElement).open)
        }
      >
        <summary className={styles.coverageSummary}>
          Covered names
          {coverage.length
            ? ` · ${coverage.length.toLocaleString()}${coverage.length >= COLLAPSE_AT ? ' (collapsed — expand to browse)' : ''}`
            : ''}
        </summary>
        <div className={styles.coverageBody}>
          {!coverage.length ? (
            <span className={styles.mutedSm}>
              No financials stored yet — choose <em>My companies</em> or{' '}
              <em>Custom ticker(s)</em> and click “Pull SEC data”.
            </span>
          ) : (
            <>
              {show.map((c) => (
                <button
                  key={c.ticker}
                  type="button"
                  className={styles.covChip}
                  title={`${c.entity_name || ''} · ${c.earliest || ''} → ${c.latest || ''}`}
                  onClick={() => c.ticker && onSelectTicker(c.ticker)}
                >
                  {c.ticker} · {c.quarters ?? 0}q/{c.annuals ?? 0}y
                </button>
              ))}
              {more > 0 && (
                <span className={styles.mutedSm}>
                  +{more.toLocaleString()} more (use Company dashboard search /
                  datalist)
                </span>
              )}
            </>
          )}
        </div>
      </details>
    </CollapsibleCard>
  )
}
