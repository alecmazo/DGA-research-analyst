import { Fragment, useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { PrintLetterhead } from '@/components/brand/PrintLetterhead'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Button } from '@/components/ui/Button'
import { api, downloadAuth } from '@/lib/api'
import type { SheetData, SheetLink, StatementLine, StatementPack } from './types'
import { vlMoney } from './format'
import styles from '../FinancialsPage.module.css'
import { BizBlurb } from './BizBlurb'
import { HoverTip } from './HoverTip'

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
  const [stmts, setStmts] = useState<StatementPack | null>(null)
  const [stmtBusy, setStmtBusy] = useState(false)
  const [stmtErr, setStmtErr] = useState<string | null>(null)
  const [stmtView, setStmtView] = useState<
    'income' | 'balance' | 'cash_flow' | 'comprehensive' | null
  >(null)
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({})

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
    setStmts(null)
    setStmtView(null)
    setOpenLines({})
    setStmtErr(null)
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

  const ensureStatements = useCallback(async (tkRaw: string) => {
    const tk = tkRaw.trim().toUpperCase()
    if (!tk || stmts?.ticker === tk || stmtBusy) return
    setStmtBusy(true)
    setStmtErr(null)
    try {
      const d = await api<StatementPack>(
        `/api/financials/${encodeURIComponent(tk)}/statements`,
      )
      if (d && d.ok === false) {
        setStmtErr(d.error || 'Statements unavailable')
        return
      }
      setStmts(d)
    } catch (e) {
      setStmtErr(e instanceof Error ? e.message : 'Statements unavailable')
    } finally {
      setStmtBusy(false)
    }
  }, [stmts?.ticker, stmtBusy])

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
      compact
    >
      <p className={styles.help}>
        Value Line array — same ticker as the dashboard. SEC store, $ millions.
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
              <BizBlurb text={sheet.business_summary} />
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
                ['Borrowings', vlMoney(cap.borrowings as number | null)],
                ['Lease liab. *', vlMoney(cap.lease_liability as number | null)],
                ['Total debt *', vlMoney(cap.total_debt as number | null)],
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
              <div className={styles.stmtBar}>
                {(
                  [
                    ['income', 'Income statement'],
                    ['balance', 'Balance sheet'],
                    ['cash_flow', 'Cash flow'],
                    ['comprehensive', 'Comprehensive income'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={stmtView === id ? styles.segOn : styles.segBtn}
                    onClick={() => {
                      setStmtView((cur) => (cur === id ? null : id))
                      void ensureStatements(activeTk || sheet.ticker || '')
                    }}
                  >
                    {label}
                  </button>
                ))}
                {stmtBusy && <span className={styles.mutedSm}>Reading the 10-K…</span>}
              </div>
              {stmtErr && <div className={styles.inlineErr}>{stmtErr}</div>}
              <VlTable
                block={sheet.annual}
                title="Annual"
                expand={{
                  open: openLines,
                  assets: alignLines(stmts?.assets, stmts?.years, sheet.annual.labels),
                  liabilities: alignLines(
                    stmts?.liabilities,
                    stmts?.years,
                    sheet.annual.labels,
                  ),
                  onToggle: (id) => {
                    setOpenLines((cur) => ({ ...cur, [id]: !cur[id] }))
                    void ensureStatements(activeTk || sheet.ticker || '')
                  },
                }}
              />
              {stmtView && stmts?.ok && (
                <StatementBlock
                  title={
                    stmtView === 'income'
                      ? 'Income statement'
                      : stmtView === 'balance'
                        ? 'Balance sheet'
                        : stmtView === 'cash_flow'
                          ? 'Cash flow'
                          : 'Comprehensive income'
                  }
                  years={stmts.years || []}
                  lines={
                    stmtView === 'income'
                      ? stmts.income
                      : stmtView === 'balance'
                        ? stmts.balance || [
                            ...(stmts.assets || []),
                            ...(stmts.liabilities || []),
                            ...(stmts.equity || []),
                          ]
                        : stmtView === 'cash_flow'
                          ? stmts.cash_flow
                          : stmts.comprehensive
                  }
                  note={stmts.note}
                />
              )}
            </>
          )}
          {sheet.quarterly && (
            <>
              <div className={styles.vlSection}>Recent quarters</div>
              <VlTable block={sheet.quarterly} title="Quarterly" />
            </>
          )}
          <div className={styles.mutedSm}>
            {(sheet.footnotes || []).map((fn) => (
              <div key={fn} style={{ marginBottom: 6 }}>{fn}</div>
            ))}
            Source: {sheet.source || 'company_financials'}. Print / Save PDF uses
            your browser. Download PDF is generated on click only.
            Not investment advice.
          </div>
        </div>
      )}
    </CollapsibleCard>
  )
}

function alignLines(
  lines: StatementLine[] | undefined,
  years: string[] | undefined,
  labels: string[] | undefined,
): StatementLine[] {
  const yrs = years || []
  const labs = labels || []
  return (lines || []).map((line) => ({
    label: line.label,
    unit: line.unit,
    role: line.role,
    note: line.note,
    values: labs.map((lab) => {
      const i = yrs.indexOf(lab)
      return i >= 0 ? (line.values || [])[i] ?? null : null
    }),
  }))
}

function StatementBlock({
  title,
  years,
  lines,
  note,
}: {
  title: string
  years: string[]
  lines?: StatementLine[]
  note?: string
}) {
  if (!lines?.length) {
    return <div className={styles.mutedSm}>No {title.toLowerCase()} lines in the last five 10-Ks.</div>
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div className={styles.vlSection}>{title} · last five years</div>
      <VlTable block={{ labels: years, rows: lines }} title={title} />
      {note && <div className={styles.mutedSm}>{note}</div>}
    </div>
  )
}

function VlTable({
  block,
  title,
  expand,
}: {
  block: {
    labels?: string[]
    rows?: Array<{
      id?: string
      label?: string
      unit?: string
      role?: string
      note?: string
      values?: Array<number | null | undefined>
    }>
  }
  title: string
  expand?: {
    open: Record<string, boolean>
    assets?: StatementLine[]
    liabilities?: StatementLine[]
    onToggle: (id: string) => void
  }
}) {
  const labels = block.labels || []
  const rows = block.rows || []
  const [tip, setTip] = useState<{ x: number; y: number; title: string; body: string } | null>(null)
  if (!labels.length || !rows.length) return null
  const showNote = (e: ReactMouseEvent, title: string, body: string) => {
    setTip({ x: e.clientX, y: e.clientY, title, body })
  }
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
            const kids =
              r.id === 'assets'
                ? expand?.assets
                : r.id === 'liabilities'
                  ? expand?.liabilities
                  : undefined
            const open = !!(r.id && expand?.open[r.id])
            return (
              <Fragment key={r.id || i}>
                <tr
                  className={r.role === 'total' ? styles.vlTotal : undefined}
                  onMouseEnter={(e) => r.note && showNote(e, r.label || '', r.note)}
                  onMouseMove={(e) => r.note && showNote(e, r.label || '', r.note)}
                  onMouseLeave={() => setTip(null)}
                >
                  <td className={styles.vlLab}>
                    {kids ? (
                      <button
                        type="button"
                        className={styles.vlToggle}
                        onClick={() => r.id && expand?.onToggle(r.id)}
                      >
                        {open ? '▾' : '▸'} {r.label || ''}
                      </button>
                    ) : (
                      r.label || ''
                    )}
                  </td>
                  {(r.values || []).map((v, j) => (
                    <td key={j} className={`${styles.vlNum} tabular`}>
                      {vlMoney(v, r.unit)}
                    </td>
                  ))}
                </tr>
                {open &&
                  (kids || []).map((child, k) => (
                    <tr
                      key={`${r.id}-c-${k}`}
                      className={styles.vlChild}
                      onMouseEnter={(e) =>
                        child.note && showNote(e, child.label || '', child.note)
                      }
                      onMouseMove={(e) =>
                        child.note && showNote(e, child.label || '', child.note)
                      }
                      onMouseLeave={() => setTip(null)}
                    >
                      <td className={styles.vlLab}>{child.label || ''}</td>
                      {(child.values || []).map((v, j) => (
                        <td key={j} className={`${styles.vlNum} tabular`}>
                          {vlMoney(v, child.unit || '$')}
                        </td>
                      ))}
                    </tr>
                  ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {tip && (
        <HoverTip x={tip.x} y={tip.y} className={styles.noteTip} wrap>
          <div className={styles.scoreTipTitle}>{tip.title}</div>
          <div>{tip.body}</div>
        </HoverTip>
      )}
    </div>
  )
}
