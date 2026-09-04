import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SupportFab } from '@/components/support/SupportFab'
import {
  api,
  downloadAuth,
  type Quote,
  type ReportDelta,
  type ReportDetail,
  type ReportHistory,
  type ReportHistoryVersion,
} from '@/lib/api'
import { getCachedUser } from '@/lib/auth'
import { fmtPct, fmtPx, pctClass, printEngineName, relativeTime, scrubPrintEngineNames } from '@/lib/format'
import { renderMd, reportMarkdown } from '@/lib/md'
import { PrintLetterhead } from '@/components/brand/PrintLetterhead'
import styles from './ReportPage.module.css'

function fmtTarget(v: number | null | undefined) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return `$${n >= 100 ? n.toFixed(0) : n.toFixed(2)}`
}

function deltaBits(dlt: ReportDelta | null | undefined): string[] {
  if (!dlt) return []
  const bits: string[] = []
  if (dlt.rating_changed) {
    bits.push(
      `Rating ${(dlt.rating?.from || '—')} → ${(dlt.rating?.to || '—')}`,
    )
  }
  if (dlt.pt_changed || dlt.price_target?.from != null) {
    const ch = dlt.price_target?.chg_pct
    bits.push(
      `Target ${fmtTarget(dlt.price_target?.from)} → ${fmtTarget(dlt.price_target?.to)}` +
        (ch != null ? ` (${ch >= 0 ? '+' : ''}${Number(ch).toFixed(1)}%)` : ''),
    )
  }
  if (dlt.upside_pct?.chg_pp != null) {
    const pp = Number(dlt.upside_pct.chg_pp)
    bits.push(`Upside ${pp >= 0 ? '+' : ''}${pp.toFixed(1)} pp`)
  }
  if (dlt.days_since_prior != null) {
    bits.push(`${dlt.days_since_prior}d since prior`)
  }
  return bits
}

export function ReportPage() {
  const [params, setParams] = useSearchParams()
  const ticker = (params.get('ticker') || '').toUpperCase()
  const provider = (params.get('provider') || 'grok').toLowerCase()

  const [data, setData] = useState<ReportDetail | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [history, setHistory] = useState<ReportHistory | null>(null)
  const [viewId, setViewId] = useState<string | number>('current')
  const [viewMd, setViewMd] = useState<string | null>(null)
  const [viewSnap, setViewSnap] = useState<ReportHistoryVersion | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [histBusy, setHistBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [excelBusy, setExcelBusy] = useState(false)
  const [docBusy, setDocBusy] = useState(false)

  useEffect(() => {
    document.title = ticker
      ? `${ticker} · ${printEngineName(provider)} report · DGA`
      : 'Report · DGA'
  }, [ticker, provider])

  useEffect(() => {
    if (!ticker) {
      setErr('Missing ticker')
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      setLoading(true)
      setErr(null)
      setViewId('current')
      setViewMd(null)
      setViewSnap(null)
      try {
        const [r, q, h] = await Promise.all([
          api<ReportDetail>(
            `/api/report/${encodeURIComponent(ticker)}?provider=${encodeURIComponent(provider)}`,
          ),
          api<Quote>(`/api/quote/${encodeURIComponent(ticker)}`).catch(() => null),
          api<ReportHistory>(
            `/api/report/${encodeURIComponent(ticker)}/history?provider=${encodeURIComponent(provider)}`,
          ).catch(() => null),
        ])
        if (!alive) return
        setData(r)
        setQuote(q)
        setHistory(h)
        if (h?.current) setViewSnap(h.current)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to load report')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [ticker, provider])

  const loadVersion = async (id: string | number) => {
    if (!ticker) return
    setHistBusy(true)
    try {
      if (id === 'current') {
        setViewId('current')
        setViewMd(null)
        setViewSnap(history?.current || null)
        return
      }
      const v = await api<{
        report_md?: string
        rating?: string | null
        price_target?: number | null
        upside_pct?: number | null
        generated_at?: string | null
        id?: number
      }>(
        `/api/report/${encodeURIComponent(ticker)}/version/${encodeURIComponent(String(id))}`,
      )
      setViewId(id)
      setViewMd(v.report_md || '')
      setViewSnap({
        id: v.id ?? id,
        rating: v.rating,
        price_target: v.price_target,
        upside_pct: v.upside_pct,
        generated_at: v.generated_at,
        is_current: false,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load version')
    } finally {
      setHistBusy(false)
    }
  }

  const currentMd = reportMarkdown(data)
  const md = viewId === 'current' ? currentMd : viewMd || ''
  const html = useMemo(
    () => (md ? scrubPrintEngineNames(renderMd(md)) : ''),
    [md],
  )
  const pct = quote?.pct ?? quote?.pct_change ?? null
  const shownProvider = (data?.provider || provider).toLowerCase()
  const printName = printEngineName(shownProvider)
  const engines = new Set(
    (data?.providers || []).map((p) => String(p || '').toLowerCase()),
  )
  if (shownProvider) engines.add(shownProvider)
  const switchGrok = engines.has('grok')
  const switchClaude = engines.has('claude')
  const showEngineSwitch = switchGrok && switchClaude

  const switchEngine = (pv: string) => {
    if (!ticker || pv === shownProvider) return
    setParams({ ticker, provider: pv })
  }

  const dlt =
    data?.delta_from_prior ||
    history?.current?.delta_from_prior ||
    history?.delta_from_prior ||
    null
  const vc =
    data?.version_count ||
    history?.current?.version_count ||
    history?.version_count ||
    1
  const bits = deltaBits(dlt)
  const showDelta =
    viewId === 'current' &&
    dlt &&
    (dlt.rating_changed ||
      dlt.pt_changed ||
      dlt.upside_pct?.chg_pp != null ||
      (vc > 1 && dlt.days_since_prior != null) ||
      dlt.has_change ||
      bits.length > 0)

  const versions = history?.versions || []
  const showTimeline = Boolean(history?.current || versions.length)

  const displayRating = viewSnap?.rating ?? data?.rating
  const displayTarget = viewSnap?.price_target ?? data?.price_target
  const displayUpside = viewSnap?.upside_pct ?? data?.upside_pct
  const displayWhen =
    viewId === 'current'
      ? data?.generated_at || data?.report_date
      : viewSnap?.generated_at || viewSnap?.report_date

  const downloadExcel = async () => {
    if (!ticker) return
    setExcelBusy(true)
    try {
      await downloadAuth(
        `/api/download/${encodeURIComponent(ticker)}/xlsx?provider=${encodeURIComponent(shownProvider)}`,
        `${ticker}_DGA_Model.xlsx`,
        { overwrite: true },
      )
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      alert('Excel export failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setExcelBusy(false)
    }
  }

  const downloadDocx = async () => {
    if (!ticker) return
    setDocBusy(true)
    try {
      await downloadAuth(
        `/api/download/${encodeURIComponent(ticker)}/docx`,
        `${ticker}_DGA_Report.docx`,
      )
    } catch (e) {
      alert('Word download failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setDocBusy(false)
    }
  }

  const sharePdf = async () => {
    if (!html || !ticker) return
    const def = getCachedUser()?.email || ''
    const to = window.prompt('Email this report PDF to:', def)
    if (!to) return
    setSharing(true)
    try {
      const d = await api<{ ok?: boolean; detail?: string }>(
        `/api/report/${encodeURIComponent(ticker)}/email`,
        {
          method: 'POST',
          body: JSON.stringify({
            to,
            provider: shownProvider,
            version_id: viewId === 'current' ? undefined : String(viewId),
            html,
            price: fmtPx(quote?.price),
            day: fmtPct(pct),
            rating: displayRating || '—',
            target: fmtTarget(displayTarget),
            upside: fmtPct(displayUpside),
            when:
              (viewId === 'current' ? '' : 'prior · ') +
              (displayWhen ? relativeTime(displayWhen) : ''),
            version_label: vc > 1 ? `v${vc}` : '',
            note: data?.note || '',
            day_tone: pctClass(pct) || '',
            upside_tone: pctClass(displayUpside) || '',
            delta_title: showDelta
              ? `Δ since prior Analyze ${vc > 1 ? `(v${vc})` : ''}`
              : '',
            delta_bits: showDelta
              ? bits.length
                ? bits.join(' · ')
                : 'Thesis re-run archived (headline numbers similar)'
              : '',
            delta_note: showDelta
              ? 'Each Analyze is a timestamped snapshot. Priors are kept. New reports include a Thesis Continuity section when a prior exists.'
              : '',
          }),
        },
      )
      if (!d.ok) throw new Error(d.detail || 'Send failed')
      alert('Sent to ' + to)
    } catch (e) {
      alert('Email failed: ' + (e instanceof Error ? e.message : e))
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className={styles.page}>
      <PrintLetterhead
        doc="Research Report"
        meta={[
          ticker,
          printName,
          displayWhen ? relativeTime(displayWhen) : '',
        ]}
      />
      <header className={styles.head}>
        <div className={styles.title}>
          <strong>{ticker || '—'}</strong>
          <span className={styles.prov} data-p={shownProvider}>
            {printName.toUpperCase()}
          </span>
          {vc > 1 && (
            <span className={styles.verBadge} title="Analyze re-run count for this ticker/engine">
              v{vc}
            </span>
          )}
          {displayWhen && (
            <span className={styles.meta}>
              {viewId === 'current' ? '' : 'prior · '}
              {relativeTime(displayWhen)}
            </span>
          )}
          {data?.note && <span className={styles.note}>{data.note}</span>}
        </div>
        <div className={`${styles.actions} ${styles.noPrint}`}>
          {showEngineSwitch && (
            <div className={styles.engineSwitch} role="tablist" aria-label="Report engine">
              <button
                type="button"
                role="tab"
                aria-selected={shownProvider === 'grok'}
                className={`${styles.engineBtn} ${shownProvider === 'grok' ? styles.engineOn : ''}`}
                data-p="grok"
                disabled={loading}
                onClick={() => switchEngine('grok')}
                title="Show Grok report"
              >
                Grok
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={shownProvider === 'claude'}
                className={`${styles.engineBtn} ${shownProvider === 'claude' ? styles.engineOn : ''}`}
                data-p="claude"
                disabled={loading}
                onClick={() => switchEngine('claude')}
                title="Show Claude report"
              >
                Claude
              </button>
            </div>
          )}
          {data?.gamma_url && (
            <a
              href={data.gamma_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.gamma}
            >
              GAMMA
            </a>
          )}
          <button
            type="button"
            className={styles.doc}
            onClick={() => void downloadDocx()}
            disabled={loading || docBusy || !ticker || data?.has_docx === false}
            title="Download Word report"
          >
            {docBusy ? 'Word…' : 'Word'}
          </button>
          <button
            type="button"
            className={styles.excel}
            onClick={() => void downloadExcel()}
            disabled={loading || excelBusy || !ticker}
            title={`Replace ${ticker}_DGA_Model.xlsx in Dropbox /Apps/DGA Research/Excel`}
          >
            {excelBusy ? 'Excel…' : 'Excel'}
          </button>
          <button
            type="button"
            className={styles.print}
            onClick={() => window.print()}
            disabled={loading || !html}
            title="Print this window as you see it"
          >
            Print
          </button>
          <button
            type="button"
            className={styles.share}
            onClick={() => void sharePdf()}
            disabled={loading || sharing || !html}
            title="Email this report as a PDF"
          >
            {sharing ? 'Sending…' : 'Share'}
          </button>
          <button type="button" className={styles.close} onClick={() => window.close()}>
            Close
          </button>
        </div>
      </header>

      <div className={styles.metrics}>
        <div>
          <span>Price</span>
          <strong>{fmtPx(quote?.price)}</strong>
        </div>
        <div>
          <span>Day</span>
          <strong className={pctClass(pct)}>{fmtPct(pct)}</strong>
        </div>
        <div>
          <span>Rating</span>
          <strong>{displayRating || '—'}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{fmtTarget(displayTarget)}</strong>
        </div>
        <div>
          <span>Upside</span>
          <strong className={pctClass(displayUpside)}>{fmtPct(displayUpside)}</strong>
        </div>
      </div>

      {showDelta && (
        <div className={styles.deltaBanner} role="status">
          <div className={styles.deltaTitle}>
            Δ since prior Analyze {vc > 1 ? `(v${vc})` : ''}
          </div>
          <div className={styles.deltaBits}>
            {bits.length ? bits.join(' · ') : 'Thesis re-run archived (headline numbers similar)'}
          </div>
          <div className={styles.deltaNote}>
            Each Analyze is a timestamped snapshot. Priors are kept — pick a version below to re-read
            the old thesis. New reports include a <strong>Thesis Continuity</strong> section when a
            prior exists.
          </div>
        </div>
      )}

      {showTimeline && (
        <div className={`${styles.timeline} ${styles.noPrint}`}>
          <div className={styles.timelineLabel}>
            Thesis timeline · {(history?.current ? 1 : 0) + versions.length} snapshot
            {(history?.current ? 1 : 0) + versions.length === 1 ? '' : 's'}
            {histBusy ? ' · loading…' : ''}
          </div>
          <div className={styles.timelineChips}>
            {history?.current && (
              <button
                type="button"
                className={`${styles.histChip} ${viewId === 'current' ? styles.histChipOn : ''}`}
                onClick={() => void loadVersion('current')}
              >
                Current
                {history.current.generated_at
                  ? ` · ${relativeTime(history.current.generated_at)}`
                  : ''}
                {history.current.rating ? ` · ${history.current.rating}` : ''}
                {history.current.price_target != null
                  ? ` · ${fmtTarget(history.current.price_target)}`
                  : ''}
              </button>
            )}
            {versions.slice(0, 12).map((v) => (
              <button
                key={String(v.id)}
                type="button"
                className={`${styles.histChip} ${viewId === v.id ? styles.histChipOn : ''}`}
                onClick={() => void loadVersion(v.id)}
              >
                {v.generated_at ? relativeTime(v.generated_at) : `#${v.id}`}
                {v.rating ? ` · ${v.rating}` : ''}
                {v.price_target != null ? ` · ${fmtTarget(v.price_target)}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.body}>
        {loading && <div className={styles.empty}>Loading report…</div>}
        {err && <div className={styles.err}>{err}</div>}
        {!loading && !err && html && (
          <article className={styles.md} dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {!loading && !err && !html && (
          <div className={styles.empty}>
            Report loaded but has no text content. Try another engine or re-run Analyze.
          </div>
        )}
      </div>
      <div className={styles.noPrint}>
        <SupportFab />
      </div>
    </div>
  )
}

/** Open saved report in a real browser window (legacy behavior). */
export function openReportWindow(ticker: string, provider = 'grok') {
  const tk = ticker.trim().toUpperCase()
  if (!tk) return
  const pv = (provider || 'grok').toLowerCase()
  const url = `/gp/report?ticker=${encodeURIComponent(tk)}&provider=${encodeURIComponent(pv)}`
  const name = `dga-report-${tk}-${pv}`
  // Do not use noopener alone in a way that breaks same-origin localStorage —
  // omit noreferrer so the session token still works; popup is same-origin SPA.
  const win = window.open(
    url,
    name,
    'width=1040,height=900,menubar=no,toolbar=no,location=no,status=no',
  )
  if (!win) {
    window.location.href = url
  }
}
