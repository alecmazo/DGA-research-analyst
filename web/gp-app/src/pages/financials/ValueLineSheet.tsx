import { useCallback, useEffect, useState } from 'react'
import { PrintLetterhead } from '@/components/brand/PrintLetterhead'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api, downloadAuth } from '@/lib/api'
import type { SheetData, SheetLink } from './types'
import { vlMoney } from './format'
import styles from '../FinancialsPage.module.css'

type Props = {
  ticker: string
  onSelectTicker: (tk: string) => void
}

export function ValueLineSheet({ ticker, onSelectTicker }: Props) {
  const [input, setInput] = useState(ticker)
  const [links, setLinks] = useState<SheetLink[]>([])
  const [sheet, setSheet] = useState<SheetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [activeTk, setActiveTk] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  const loadLinks = useCallback(async () => {
    try {
      const j = await api<{ ok?: boolean; links?: SheetLink[]; error?: string }>(
        '/api/financials/sheet-links?limit=48',
      )
      setLinks(Array.isArray(j.links) ? j.links : [])
    } catch {
      setLinks([])
    }
  }, [])

  useEffect(() => {
    void loadLinks()
  }, [loadLinks])

  const loadSheet = useCallback(async (tkRaw: string) => {
    const tk = tkRaw.trim().toUpperCase()
    if (!tk) return
    setLoading(true)
    setErr(null)
    setActiveTk(tk)
    setInput(tk)
    try {
      const d = await api<SheetData>(
        `/api/financials/${encodeURIComponent(tk)}/sheet`,
      )
      if (d && d.ok === false) {
        setSheet(null)
        setErr(d.error || 'Failed to load sheet')
        return
      }
      setSheet(d)
    } catch (e) {
      setSheet(null)
      setErr(
        `${e instanceof Error ? e.message : 'Failed'} — pull SEC data for this ticker in the store below.`,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  // Sync with dashboard ticker
  useEffect(() => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    setInput(t)
    void loadSheet(t)
  }, [ticker, loadSheet])

  const open = () => {
    const t = input.trim().toUpperCase()
    if (!t) return
    onSelectTicker(t)
    void loadSheet(t)
  }

  const print = () => {
    if (!sheet) return
    window.print()
  }

  const downloadPdf = async () => {
    const tk = (activeTk || input).trim().toUpperCase()
    if (!tk) return
    setPdfBusy(true)
    try {
      await downloadAuth(
        `/api/financials/${encodeURIComponent(tk)}/sheet.pdf`,
        `${tk}_DGA_Financials_Sheet.pdf`,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'PDF failed')
    } finally {
      setPdfBusy(false)
    }
  }

  const action = (
    <div className={styles.dashActions}>
      <input
        className={styles.search}
        list="fin-dash-list"
        value={input}
        onChange={(e) => setInput(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && open()}
        placeholder="Ticker…"
        maxLength={8}
      />
      <Button variant="primary" size="sm" onClick={open} disabled={!input.trim()}>
        Open sheet ▶
      </Button>
      <Button variant="secondary" size="sm" onClick={print} disabled={!sheet}>
        🖨 Print / Save PDF
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void downloadPdf()}
        disabled={!activeTk || pdfBusy}
      >
        {pdfBusy ? '…' : '⬇ PDF'}
      </Button>
    </div>
  )

  const cap = sheet?.capital || {}
  const px =
    sheet?.price != null
      ? `$${Number(sheet.price).toLocaleString('en-US', {
          maximumFractionDigits: 2,
        })}`
      : '—'
  const sectorLine = [sheet?.industry, sheet?.sector].filter(Boolean).join(' · ')

  return (
    <CollapsibleCard
      id="fin-vl-panel"
      title="📈 Financials"
      badge="VALUE LINE"
      action={action}
      defaultOpen
    >
      <p className={styles.help}>
        <strong>Value Line–style statistical array</strong> — same ticker as
        Company Dashboard above (auto-fills when you View a name). Full income /
        cash flow / balance sheet / margins from the store.{' '}
        Reads the SEC store already on file.
      </p>

      <div className={styles.chipRow}>
        {links.length === 0 ? (
          <span className={styles.mutedSm}>
            No stored financials yet — pull SEC data below, then company links
            appear here.
          </span>
        ) : (
          links.map((L) => (
            <button
              key={L.ticker}
              type="button"
              className={`${styles.vlChip} ${activeTk === L.ticker ? styles.vlChipActive : ''}`}
              title={`${L.name || ''} · ${L.annuals || 0} FY · ${L.quarters || 0}Q`}
              onClick={() => {
                const t = (L.ticker || '').toUpperCase()
                if (!t) return
                onSelectTicker(t)
                void loadSheet(t)
              }}
            >
              {L.followed && <span className={styles.chipDot} title="In your universe" />}
              {L.ticker}
            </button>
          ))
        )}
      </div>

      {err && <div className={styles.inlineErr}>{err}</div>}
      {loading && <div className={styles.mutedSm}>Loading {activeTk}…</div>}

      {!loading && !sheet && !err && (
        <div className={styles.mutedSm}>
          Select a ticker (links above, or type one) to open its financial sheet.
        </div>
      )}

      {!loading && sheet && (
        <div className={styles.vlSheet}>
          <PrintLetterhead
            doc="Financials"
            meta={[sheet.ticker || activeTk, sheet.entity_name, sectorLine]}
          />
          <div className={styles.vlHead}>
            <div>
              <div className={styles.vlEntity}>
                {sheet.entity_name || activeTk}{' '}
                <span className={styles.muted}>· {sheet.ticker || activeTk}</span>
              </div>
              {sectorLine && (
                <div className={styles.sectorLine}>{sectorLine}</div>
              )}
            </div>
            <div className={styles.vlHeadRight}>
              Value Line–style · SEC store
              <br />
              Synced with Company Dashboard ·{' '}
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => {
                  document
                    .getElementById('fin-dash-panel')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                ↑ Dashboard
              </button>
            </div>
          </div>

          <div className={styles.vlCap}>
            {(
              [
                ['Recent price', px],
                ['Market cap', vlMoney(cap.market_cap as number | null)],
                ['Enterprise val.', vlMoney(cap.enterprise_value as number | null)],
                ['P/E', vlMoney(cap.pe as number | null, 'x')],
                ['P/B', vlMoney(cap.pb as number | null, 'x')],
                ['EV/EBITDA', vlMoney(cap.ev_ebitda as number | null, 'x')],
                ['FCF yield', vlMoney(cap.fcf_yield_pct as number | null, '%')],
                ['Cash', vlMoney(cap.cash as number | null)],
                ['Total debt', vlMoney(cap.total_debt as number | null)],
                ['Book / sh', vlMoney(cap.book_value_ps as number | null, '$/sh')],
                ['Shares', vlMoney(cap.shares as number | null, 'sh')],
                [
                  'FY end',
                  cap.period_end
                    ? String(cap.period_end).slice(0, 10)
                    : '—',
                ],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <div className={styles.vlCapK}>{k}</div>
                <div className={`${styles.vlCapV} tabular`}>{v}</div>
              </div>
            ))}
          </div>

          {sheet.annual && (
            <>
              <div className={styles.vlSection}>Statistical array (annual)</div>
              <VlTable block={sheet.annual} title="Annual" />
            </>
          )}
          {sheet.quarterly && (
            <>
              <div className={styles.vlSection}>Recent quarters</div>
              <VlTable block={sheet.quarterly} title="Quarterly" />
            </>
          )}
          <div className={styles.mutedSm}>
            Source: {sheet.source || 'company_financials'}. Print / Save PDF uses
            your browser. Download PDF is generated on click only.
            Not investment advice.
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}

function VlTable({
  block,
  title,
}: {
  block: { labels?: string[]; rows?: Array<{ label?: string; unit?: string; values?: Array<number | null | undefined> }> }
  title: string
}) {
  const labels = block.labels || []
  const rows = block.rows || []
  if (!labels.length || !rows.length) return null
  return (
    <div className={styles.vlScroll}>
      <table className={styles.vlTable}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', minWidth: 140 }}>{title}</th>
            {labels.map((l) => (
              <th key={l}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.unit === 'section') {
              return (
                <tr key={i} className={styles.vlSec}>
                  <td colSpan={labels.length + 1}>{r.label || ''}</td>
                </tr>
              )
            }
            return (
              <tr key={i}>
                <td className={styles.vlLab}>{r.label || ''}</td>
                {(r.values || []).map((v, j) => (
                  <td key={j} className={`${styles.vlNum} tabular`}>
                    {vlMoney(v, r.unit)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
