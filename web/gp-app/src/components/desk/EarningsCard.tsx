import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { api, type EarningsCardPayload } from '@/lib/api'
import { fmtPct, fmtPx, pctClass } from '@/lib/format'
import { openReportWindow } from '@/pages/ReportPage'
import styles from './EarningsCard.module.css'

function fmtEps(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2)
}

function fmtRev(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Math.abs(Number(v))
  const sign = Number(v) < 0 ? '-' : ''
  if (n >= 1e9) return sign + '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return sign + '$' + (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return sign + '$' + (n / 1e3).toFixed(0) + 'K'
  return sign + '$' + n.toFixed(0)
}

function surpriseTxt(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(Number(pct))) return '—'
  const n = Number(pct)
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}

function BeatBadge({
  beat,
  surprisePct,
  prefix = '',
}: {
  beat?: string | null
  surprisePct?: number | null
  prefix?: string
}) {
  if (!beat) return <span className={`${styles.badge} ${styles.pending}`}>PENDING</span>
  if (beat === 'beat') {
    const s = surprisePct != null ? ` +${Number(surprisePct).toFixed(1)}%` : ''
    return (
      <span className={`${styles.badge} ${styles.beat}`}>
        {prefix}BEAT{s}
      </span>
    )
  }
  if (beat === 'miss') {
    const s = surprisePct != null ? ` ${Number(surprisePct).toFixed(1)}%` : ''
    return (
      <span className={`${styles.badge} ${styles.miss}`}>
        {prefix}MISS{s}
      </span>
    )
  }
  return (
    <span className={`${styles.badge} ${styles.inline}`}>
      {prefix}IN-LINE
    </span>
  )
}

type Props = {
  ticker: string
  onClose: () => void
}

export function EarningsCard({ ticker, onClose }: Props) {
  const [data, setData] = useState<EarningsCardPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const d = await api<EarningsCardPayload>(
          `/api/earnings/${encodeURIComponent(ticker)}`,
        )
        if (!alive) return
        if (!d.ok && d.error) throw new Error(d.error)
        setData(d)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to load earnings')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [ticker])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const ev = data?.event || {}
  const res = data?.result || {}
  const q = data?.quote || {}
  const status = data?.status || 'unknown'
  const beat = res.beat || null
  const revBeat = res.revenue_beat || null
  const du = ev.days_until

  let whenLine = '—'
  if (ev.date) {
    if (du === 0) whenLine = `Today · ${ev.date}`
    else if (du === -1) whenLine = `Yesterday · ${ev.date}`
    else if (du != null && du > 0)
      whenLine = `In ${du} day${du === 1 ? '' : 's'} · ${ev.date}`
    else whenLine = String(ev.date)
  }
  if (ev.session) whenLine += ` · ${ev.session}`
  if (ev.fiscal_quarter) whenLine += ` · FQ ${ev.fiscal_quarter}`

  const hasEps = res.eps_actual != null || res.eps_estimate != null
  const hasRev = res.revenue_actual != null || res.revenue_estimate != null
  const reported = status === 'reported' && (hasEps || hasRev)
  const epsClr =
    beat === 'beat' ? styles.pos : beat === 'miss' ? styles.neg : ''
  const revClr =
    revBeat === 'beat' ? styles.pos : revBeat === 'miss' ? styles.neg : ''

  const notes = data?.notes
  const bullets = notes?.bullets || []
  const tone = notes?.tone || ''
  const hl = data?.call_highlights?.highlights || []
  const hist = (data?.history || []).slice(0, 6)

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div className={styles.dialog} role="dialog" aria-label={`${ticker} earnings`}>
        <header className={styles.head}>
          <strong className={styles.tk}>{ticker}</strong>
          <span className={styles.earnTag}>EARNINGS</span>
          {!loading && data && (
            <span className={styles.badgeSlot}>
              {status === 'reported' && (beat || res.eps_actual != null) ? (
                beat ? (
                  <BeatBadge beat={beat} surprisePct={res.surprise_pct} />
                ) : (
                  <span className={`${styles.badge} ${styles.pending}`}>REPORTED</span>
                )
              ) : status === 'pending_update' ? (
                <span className={`${styles.badge} ${styles.pending}`}>RESULTS PENDING</span>
              ) : status === 'scheduled' ? (
                <span className={`${styles.badge} ${styles.pending}`}>AWAITING</span>
              ) : null}
            </span>
          )}
          <button type="button" className={styles.close} onClick={onClose}>
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {loading && <div className={styles.loading}>Loading earnings…</div>}
          {err && <div className={styles.err}>{err}</div>}
          {!loading && !err && data && (
            <>
              {ev.name && <div className={styles.name}>{ev.name}</div>}
              <div className={styles.when}>{whenLine}</div>
              <div className={styles.priceLine}>
                Price{' '}
                {q.price != null ? (
                  <>
                    {fmtPx(q.price)}{' '}
                    <span className={pctClass(q.pct ?? q.pct_change)}>
                      {fmtPct(q.pct ?? q.pct_change)}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </div>

              <div className={styles.hero}>
                <div className={styles.metric}>
                  <div className={styles.metricLbl}>Actual EPS</div>
                  <div className={styles.metricVal}>{fmtEps(res.eps_actual)}</div>
                </div>
                <div className={styles.metric}>
                  <div className={styles.metricLbl}>Consensus EPS</div>
                  <div className={styles.metricVal}>{fmtEps(res.eps_estimate)}</div>
                </div>
                <div className={styles.metric}>
                  <div className={styles.metricLbl}>
                    {reported ? 'EPS Surprise' : 'Status'}
                  </div>
                  <div className={`${styles.metricVal} ${epsClr}`}>
                    {reported
                      ? surpriseTxt(res.surprise_pct)
                      : status === 'pending_update'
                        ? 'Printed · lagging'
                        : 'Not yet reported'}
                  </div>
                </div>
                <div className={styles.metric}>
                  <div className={styles.metricLbl}>Actual Revenue</div>
                  <div className={`${styles.metricVal} ${styles.metricSm}`}>
                    {fmtRev(res.revenue_actual)}
                  </div>
                </div>
                <div className={styles.metric}>
                  <div className={styles.metricLbl}>Consensus Revenue</div>
                  <div className={`${styles.metricVal} ${styles.metricSm}`}>
                    {fmtRev(res.revenue_estimate)}
                  </div>
                </div>
                <div className={styles.metric}>
                  <div className={styles.metricLbl}>Rev Surprise</div>
                  <div className={`${styles.metricVal} ${styles.metricSm} ${revClr}`}>
                    {surpriseTxt(res.revenue_surprise_pct)}
                  </div>
                </div>
              </div>

              {reported && (
                <div className={styles.badges}>
                  <BeatBadge beat={beat} surprisePct={res.surprise_pct} />
                  {revBeat && (
                    <BeatBadge
                      beat={revBeat}
                      surprisePct={res.revenue_surprise_pct}
                      prefix="REV "
                    />
                  )}
                </div>
              )}

              {(bullets.length > 0 || notes?.vs_analysts) && (
                <div
                  className={`${styles.notes} ${
                    tone === 'beat'
                      ? styles.toneBeat
                      : tone === 'miss'
                        ? styles.toneMiss
                        : tone === 'pending'
                          ? styles.tonePend
                          : ''
                  }`}
                >
                  <div className={styles.notesHead}>
                    <span>vs analysts · key points</span>
                    {notes?.vs_analysts && (
                      <strong>{notes.vs_analysts}</strong>
                    )}
                    <span className={styles.free}>free · no AI</span>
                  </div>
                  {bullets.length > 0 && (
                    <ul>
                      {bullets.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {hl.length > 0 && (
                <details className={styles.qa} open>
                  <summary>
                    📞 Call Q&amp;A · stock movers
                    {(data.call_highlights?.quarter || hl[0]?.quarter) && (
                      <span className={styles.qaMeta}>
                        {data.call_highlights?.quarter || hl[0]?.quarter}
                        {data.call_highlights?.call_date
                          ? ` · ${data.call_highlights.call_date}`
                          : ''}
                      </span>
                    )}
                    {data.call_highlights?.stale && (
                      <span className={styles.stale}>STALE INDEX</span>
                    )}
                    <span className={styles.qaCount}>{hl.length}</span>
                  </summary>
                  <div className={styles.qaBody}>
                    {data.call_highlights?.note && (
                      <div className={styles.qaNote}>{data.call_highlights.note}</div>
                    )}
                    {hl.map((h, i) => (
                      <div key={i} className={styles.qaItem}>
                        <div className={styles.qaTags}>
                          {(h.themes?.length ? h.themes : [h.theme || 'Call']).map(
                            (t, j) => (
                              <span key={j} className={styles.qaTag}>
                                {t}
                              </span>
                            ),
                          )}
                        </div>
                        <div className={styles.qaQuote}>“{h.quote || ''}”</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {hist.length > 0 && (
                <>
                  <div className={styles.histTitle}>Recent quarters</div>
                  <table className={styles.hist}>
                    <thead>
                      <tr>
                        <th>Quarter</th>
                        <th>Reported</th>
                        <th className="tabular">Actual</th>
                        <th className="tabular">Est.</th>
                        <th className="tabular">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hist.map((h, i) => (
                        <tr key={i}>
                          <td>{h.fiscal_quarter || '—'}</td>
                          <td className={styles.dim}>{h.date_reported || '—'}</td>
                          <td className="tabular">{fmtEps(h.eps_actual)}</td>
                          <td className={`tabular ${styles.dim}`}>
                            {fmtEps(h.eps_estimate)}
                          </td>
                          <td
                            className={`tabular ${
                              h.beat === 'beat'
                                ? styles.pos
                                : h.beat === 'miss'
                                  ? styles.neg
                                  : ''
                            }`}
                          >
                            {h.surprise_pct != null
                              ? `${Number(h.surprise_pct) >= 0 ? '+' : ''}${Number(h.surprise_pct).toFixed(1)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className={styles.disclaimer}>
                Not investment advice. EPS from Nasdaq/Yahoo · notes free · call Q&amp;A
                from indexed transcripts
                {data.source ? ` · EPS source ${data.source}` : ''}.
              </div>
            </>
          )}
        </div>

        <footer className={styles.foot}>
          <span className={styles.footHint}>EPS free · call Q&amp;A from indexed transcripts</span>
          {data?.has_report && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                openReportWindow(ticker, 'grok')
                onClose()
              }}
            >
              Open DGA report
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </div>
  )
}
