import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Empty, Spinner } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { fmtPct, fmtUsd, fmtUsdSigned } from '@/lib/format'
import styles from './planning.module.css'

type Section = 'current' | 'long_term' | 'liability' | 'income'
type Source = 'manual' | 'managed' | 'fund'

type PlanRow = {
  id: string
  section: Section
  label: string
  amount: number | null
  yield_pct: number | null
  pnl_actual: number | null
  notes: string
  include_in_investments: boolean
  source: Source
  link_id?: string | null
  hidden: boolean
  amount_override: number | null
  live_amount?: number | null
  pnl_actual_live?: number | null
  live_as_of?: string | null
  ytd_pct?: number | null
  live?: boolean
  stale?: boolean
  commitment?: number | null
  yield_pct_live?: number | null
  capital_gains?: number | null
  dividends_ytd?: number | null
}

type Computed = {
  total_assets: number
  total_liabilities: number
  net_worth: number
  investable: number
  other_income: number
  pnl_estimate: number | null
  pnl_actual: number | null
  capital_gains: number | null
  annual_expenses: number
  required_generation: number
  total_yield: number
  surplus: number
  gap: number
  covered: boolean | null
}

type RosterLp = {
  lp_id: string
  name?: string
  email?: string
  fund_count?: number
  acct_count?: number
  has_snapshot?: boolean
}

const SECTIONS: { key: Section; label: string; add: string; cls: string }[] = [
  { key: 'current', label: 'Current assets', add: '+ Add asset', cls: styles.secCurrent },
  { key: 'long_term', label: 'Long-term assets', add: '+ Add property', cls: styles.secCurrent },
  { key: 'income', label: 'Other annual income', add: '+ Add income', cls: styles.secCurrent },
  { key: 'liability', label: 'Liabilities', add: '+ Add liability', cls: styles.secLiab },
]

const LS_KEY = 'dga.lpPlanning.lpId'

function nid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

function parseNum(raw: string): number | null {
  const t = raw.trim().replace(/[$,%\s]/g, '').replace(/^\((.+)\)$/, '-$1')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function rowAmount(r: PlanRow): number {
  if (r.hidden) return 0
  if (r.amount_override != null) return r.amount_override
  if (r.source !== 'manual' && r.live_amount != null) return r.live_amount
  return r.amount ?? 0
}

function cashLike(label: string): boolean {
  const s = (label || '').toLowerCase()
  return ['cash', 'checking', 'money market', 'mmf', 'spaxx'].some((k) =>
    s.includes(k),
  )
}

function rowYield(r: PlanRow): number | null {
  if (
    cashLike(r.label) &&
    r.yield_pct_live != null &&
    (r.yield_pct == null || r.yield_pct <= 1)
  ) {
    return r.yield_pct_live
  }
  if (r.yield_pct != null) return r.yield_pct
  return r.yield_pct_live ?? null
}

function rowPnlEst(r: PlanRow): number | null {
  if (r.section === 'income') return rowAmount(r)
  const y = rowYield(r)
  if (y == null) return null
  return rowAmount(r) * (y / 100)
}

function rowPnlAct(r: PlanRow): number | null {
  if (r.section === 'income') return rowAmount(r)
  if (r.source !== 'manual') return r.pnl_actual_live ?? null
  return r.pnl_actual
}

function compute(rows: PlanRow[], expenses: number): Computed {
  let assets = 0
  let liabilities = 0
  let investable = 0
  let income = 0
  let invEst = 0
  let invAct = 0
  let capGains = 0
  let hasEst = false
  let hasAct = false
  let hasCap = false
  for (const r of rows) {
    if (r.hidden) continue
    const amt = rowAmount(r)
    if (r.section === 'liability') {
      liabilities += amt
      continue
    }
    if (r.section === 'income') {
      income += amt
      continue
    }
    assets += amt
    if (r.include_in_investments) investable += amt
    const est = rowPnlEst(r)
    if (est != null) {
      invEst += est
      hasEst = true
    }
    const act = rowPnlAct(r)
    if (act != null) {
      invAct += act
      hasAct = true
    }
    if (r.capital_gains != null) {
      capGains += r.capital_gains
      hasCap = true
    }
  }
  const required = Math.max(0, expenses - income)
  const invMark = hasAct ? invAct : invEst
  return {
    total_assets: assets,
    total_liabilities: liabilities,
    net_worth: assets - liabilities,
    investable,
    other_income: income,
    pnl_estimate: hasEst ? invEst : null,
    pnl_actual: hasAct ? invAct : null,
    capital_gains: hasCap ? capGains : null,
    annual_expenses: expenses,
    required_generation: required,
    total_yield: invMark + income,
    surplus: invMark + income - expenses,
    gap: required - invMark,
    covered: expenses ? required - invMark <= 0.01 : null,
  }
}

function formatShown(value: number | null | undefined, kind?: 'usd' | 'pct'): string {
  if (value == null || Number.isNaN(Number(value))) return ''
  if (kind === 'pct') {
    const n = Number(value)
    const body = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    return `${body}%`
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number(value))
}

function NumCell(props: {
  value: number | null | undefined
  onChange: (v: number | null) => void
  disabled?: boolean
  kind?: 'usd' | 'pct'
  placeholder?: string
}) {
  const [focus, setFocus] = useState(false)
  const [text, setText] = useState('')
  const shown = formatShown(props.value, props.kind)
  const edit = props.value == null ? '' : String(props.value)

  return (
    <input
      className={`${styles.num} ${props.kind === 'pct' ? styles.yieldNum : ''}`}
      readOnly={props.disabled}
      value={focus ? text : shown}
      placeholder={props.placeholder || ''}
      inputMode="decimal"
      onFocus={() => {
        if (props.disabled) return
        setText(edit)
        setFocus(true)
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocus(false)
        if (!props.disabled) props.onChange(parseNum(text))
      }}
    />
  )
}

export function LpPlanning() {
  const [roster, setRoster] = useState<RosterLp[]>([])
  const [lpId, setLpId] = useState(() => sessionStorage.getItem(LS_KEY) || '')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [title, setTitle] = useState('')
  const [asOf, setAsOf] = useState('')
  const [notes, setNotes] = useState('')
  const [expenses, setExpenses] = useState<number | null>(0)
  const [rows, setRows] = useState<PlanRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [seeded, setSeeded] = useState(false)
  const [unmatched, setUnmatched] = useState<string[]>([])

  const loadRoster = useCallback(async () => {
    const d = await api<{ lps?: RosterLp[] }>('/api/v2/gp/lp-planning')
    setRoster(d.lps || [])
    return d.lps || []
  }, [])

  const loadSnap = useCallback(async (id: string) => {
    if (!id) {
      setRows([])
      setTitle('')
      setLoading(false)
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const d = await api<{
        snapshot: {
          title?: string
          as_of?: string
          notes?: string
          annual_expenses?: number
          rows?: PlanRow[]
          seeded?: boolean
        }
        live?: { unmatched_accounts?: string[] }
      }>(`/api/v2/gp/lp-planning/${encodeURIComponent(id)}`)
      const s = d.snapshot || {}
      setTitle(s.title || '')
      setAsOf(s.as_of || new Date().toISOString().slice(0, 10))
      setNotes(s.notes || '')
      setExpenses(s.annual_expenses ?? 0)
      setRows(s.rows || [])
      setSeeded(Boolean(s.seeded))
      setUnmatched(d.live?.unmatched_accounts || [])
      setDirty(false)
      setStatus('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load snapshot')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await loadRoster()
        if (cancelled) return
        const saved = sessionStorage.getItem(LS_KEY) || ''
        const pick =
          (saved && list.some((x) => x.lp_id === saved) ? saved : '') ||
          list[0]?.lp_id ||
          ''
        setLpId(pick)
        if (pick) sessionStorage.setItem(LS_KEY, pick)
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Could not load LP roster')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadRoster])

  useEffect(() => {
    if (!lpId) {
      setLoading(false)
      return
    }
    void loadSnap(lpId)
  }, [lpId, loadSnap])

  const mark = (next: PlanRow[] | ((r: PlanRow[]) => PlanRow[])) => {
    setRows(next)
    setDirty(true)
  }

  const patch = (id: string, partial: Partial<PlanRow>) => {
    mark((rs) => rs.map((r) => (r.id === id ? { ...r, ...partial } : r)))
  }

  const addRow = (section: Section) => {
    mark((rs) => {
      const n = rs.filter((r) => r.section === section && !r.hidden).length
      const labels: Record<Section, string> = {
        current: n ? `Other asset ${n}` : 'Other asset',
        long_term: n ? `Property ${n + 1} (FMV)` : 'Real estate (FMV)',
        liability: n ? `Liability ${n + 1}` : 'Mortgage / property debt',
        income: n ? `Income source ${n + 1}` : 'Social Security (annual)',
      }
      return [
        ...rs,
        {
          id: nid(),
          section,
          label: labels[section],
          amount: null,
          yield_pct: null,
          pnl_actual: null,
          notes: '',
          include_in_investments: section === 'current',
          source: 'manual' as const,
          link_id: null,
          hidden: false,
          amount_override: null,
        },
      ]
    })
  }

  const removeRow = (r: PlanRow) => {
    if (r.source !== 'manual') {
      patch(r.id, { hidden: true })
      return
    }
    mark((rs) => rs.filter((x) => x.id !== r.id))
  }

  const save = async () => {
    if (!lpId) return
    setBusy(true)
    setErr(null)
    try {
      const body = {
        title,
        as_of: asOf,
        notes,
        annual_expenses: expenses ?? 0,
        rows: rows.map((r) => ({
          id: r.id,
          section: r.section,
          label: r.label,
          amount: r.amount,
          yield_pct: r.yield_pct,
          pnl_actual: r.pnl_actual,
          notes: r.notes,
          include_in_investments: r.include_in_investments,
          source: r.source,
          link_id: r.link_id,
          hidden: r.hidden,
          amount_override: r.amount_override,
        })),
      }
      const d = await api<{
        snapshot: {
          title?: string
          as_of?: string
          notes?: string
          annual_expenses?: number
          rows?: PlanRow[]
        }
      }>(`/api/v2/gp/lp-planning/${encodeURIComponent(lpId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      const s = d.snapshot || {}
      setRows(s.rows || rows)
      setDirty(false)
      setSeeded(false)
      setStatus('Saved')
      await loadRoster()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const totals = useMemo(() => compute(rows, expenses ?? 0), [rows, expenses])
  const selected = roster.find((x) => x.lp_id === lpId)
  const hiddenCount = rows.filter((r) => r.hidden).length

  const pctTot = (r: PlanRow) => {
    const amt = rowAmount(r)
    if (!totals.total_assets) return null
    if (r.section !== 'current' && r.section !== 'long_term' && r.section !== 'liability')
      return null
    if (r.hidden) return null
    return (amt / totals.total_assets) * 100
  }

  if (!roster.length && !loading && !err) {
    return (
      <Empty
        title="No LPs in Settings"
        sub="Create an LP under Settings → Users, then assign managed accounts and fund memberships. Planning snapshots are GP-only."
      />
    )
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.hint}>
        GP-only household snapshot for one Settings LP. Live SMA NAV and fund
        stakes fill in from their assignments; add cash, real estate, debt, Social
        Security, and expenses so you can see the annual P&amp;L the books need to
        generate.
      </p>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span className={styles.lbl}>Limited partner</span>
          <select
            className={styles.select}
            value={lpId}
            onChange={(e) => {
              const v = e.target.value
              if (dirty && !confirm('Discard unsaved planning changes?')) return
              setLpId(v)
              sessionStorage.setItem(LS_KEY, v)
            }}
          >
            {!lpId && <option value="">Select LP…</option>}
            {roster.map((u) => (
              <option key={u.lp_id} value={u.lp_id}>
                {u.name || u.email || u.lp_id}
                {u.acct_count || u.fund_count
                  ? `  ·  ${u.acct_count || 0} SMA / ${u.fund_count || 0} fund`
                  : ''}
                {u.has_snapshot ? '  ·  saved' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.lbl}>Snapshot name</span>
          <input
            className={`${styles.input} ${styles.titleIn}`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setDirty(true)
            }}
            placeholder="Retirement base case"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.lbl}>As of</span>
          <input
            className={`${styles.input} ${styles.dateIn}`}
            type="date"
            value={asOf}
            onChange={(e) => {
              setAsOf(e.target.value)
              setDirty(true)
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.lbl}>Annual expenses</span>
          <div className={styles.expIn}>
            <NumCell
              value={expenses}
              onChange={(v) => {
                setExpenses(v)
                setDirty(true)
              }}
              placeholder="200000"
            />
          </div>
        </label>
        <div className={styles.actions}>
          {hiddenCount > 0 && (
            <label className={styles.showHidden}>
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              Show hidden ({hiddenCount})
            </label>
          )}
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !lpId || !dirty}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save snapshot'}
          </Button>
        </div>
      </div>

      {err && <div className={styles.callout}>{err}</div>}
      {status && !dirty && <div className={styles.statusOk}>{status}</div>}
      {seeded && (
        <p className={styles.status}>
          Starter lines added — edit amounts or delete anything you don’t need.
          Every Settings SMA should appear under Current assets. Use{' '}
          <strong>+ Add property</strong> for each real-estate line (FMV here,
          mortgage under Liabilities).
        </p>
      )}
      {unmatched.length > 0 && (
        <div className={`${styles.callout} ${styles.calloutNeed}`}>
          Settings names with no matching SMA book:{' '}
          {unmatched.join(', ')}. Check the account name in Settings, or keep the
          line and type an amount.
        </div>
      )}

      {!lpId ? (
        <div className={styles.emptyPick}>Pick an LP to open their planning snapshot.</div>
      ) : loading ? (
        <Spinner label="Loading snapshot…" />
      ) : (
        <>
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Net worth</div>
              <div className={styles.kpiVal}>{fmtUsd(totals.net_worth)}</div>
              <div className={styles.kpiHint}>
                Assets {fmtUsd(totals.total_assets)} − debt{' '}
                {fmtUsd(totals.total_liabilities)}
              </div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Investable</div>
              <div className={styles.kpiVal}>{fmtUsd(totals.investable)}</div>
              <div className={styles.kpiHint}>Checked lines — DGA-relevant book</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Required P&amp;L</div>
              <div className={styles.kpiVal}>{fmtUsd(totals.required_generation)}</div>
              <div className={styles.kpiHint}>
                Expenses {fmtUsd(totals.annual_expenses)} − other income{' '}
                {fmtUsd(totals.other_income)}
              </div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Actual YTD / est.</div>
              <div className={styles.kpiVal}>
                {totals.pnl_actual != null
                  ? fmtUsd(totals.pnl_actual)
                  : totals.pnl_estimate != null
                    ? fmtUsd(totals.pnl_estimate)
                    : '—'}
              </div>
              <div className={styles.kpiHint}>
                {totals.pnl_actual != null
                  ? `Estimate ${fmtUsd(totals.pnl_estimate)}`
                  : 'Set yield % or wait for SMA YTD'}
              </div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>Gap vs expenses</div>
              <div
                className={`${styles.kpiVal} ${totals.surplus >= 0 ? styles.pos : styles.neg}`}
              >
                {fmtUsdSigned(totals.surplus)}
              </div>
              <div className={styles.kpiHint}>
                Total yield {fmtUsd(totals.total_yield)} vs expenses
              </div>
            </div>
          </div>

          <div
            className={`${styles.callout} ${
              totals.covered ? styles.calloutOk : styles.calloutMuted
            }`}
          >
            <span className={styles.calloutK}>Strategy number</span>
            <span className={styles.calloutV}>
              {fmtUsd(totals.required_generation)}
            </span>
            <span>
              {selected?.name ? `${selected.name}: ` : ''}
              generate this much from the investable book so household expenses
              are covered after other income
              {totals.other_income ? ` (${fmtUsd(totals.other_income)})` : ''}.
              {totals.covered
                ? ' Current yield covers the nut.'
                : totals.gap > 0
                  ? ` Short ${fmtUsd(totals.gap)}.`
                  : ''}
            </span>
          </div>

          <div className={styles.sheet}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <colgroup>
                  <col />
                  <col />
                  <col />
                  <col />
                  <col className={styles.colYield} />
                  <col />
                  <col />
                  <col />
                  <col className={styles.colRealized} />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Inv</th>
                    <th>Amount</th>
                    <th>% Tot</th>
                    <th className={styles.colYield}>Yield %</th>
                    <th>P&amp;L est</th>
                    <th>P&amp;L actual</th>
                    <th>Notes</th>
                    <th className={styles.colRealized}>Realized Gains</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {SECTIONS.map((sec) => {
                    const list = rows.filter(
                      (r) => r.section === sec.key && (showHidden || !r.hidden),
                    )
                    const sub = list.reduce(
                      (s, r) => s + (r.hidden ? 0 : rowAmount(r)),
                      0,
                    )
                    return (
                      <SectionBlock
                        key={sec.key}
                        sec={sec}
                        rows={list}
                        subtotal={sub}
                        pctTot={pctTot}
                        onAdd={() => addRow(sec.key)}
                        onPatch={patch}
                        onRemove={removeRow}
                      />
                    )
                  })}
                  <tr className={styles.tot}>
                    <td>Total assets</td>
                    <td />
                    <td style={{ textAlign: 'right' }}>{fmtUsd(totals.total_assets)}</td>
                    <td className={styles.cellMuted}>100%</td>
                    <td />
                    <td style={{ textAlign: 'right' }}>
                      {fmtUsd(totals.pnl_estimate)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(totals.pnl_actual)}</td>
                    <td />
                    <td style={{ textAlign: 'right' }}>{fmtUsd(totals.capital_gains)}</td>
                    <td />
                  </tr>
                  <tr className={styles.tot}>
                    <td>Total liabilities</td>
                    <td />
                    <td style={{ textAlign: 'right' }}>
                      {fmtUsd(totals.total_liabilities)}
                    </td>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                  <tr className={styles.eq}>
                    <td>Equity / net worth</td>
                    <td />
                    <td style={{ textAlign: 'right' }}>{fmtUsd(totals.net_worth)}</td>
                    <td colSpan={7} className={styles.cellMuted} style={{ textAlign: 'left' }}>
                      Investable {fmtUsd(totals.investable)} · other income{' '}
                      {fmtUsd(totals.other_income)} · expenses{' '}
                      {fmtUsd(totals.annual_expenses)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <label className={styles.strategy}>
            <span className={styles.lbl}>Strategy notes (GP only)</span>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setDirty(true)
              }}
              placeholder="Approach for this LP — growth vs income sleeve, liquidity needs, when Social Security starts, tax lots to avoid, etc."
            />
          </label>
        </>
      )}
    </div>
  )
}

function SectionBlock(props: {
  sec: { key: Section; label: string; add: string; cls: string }
  rows: PlanRow[]
  subtotal: number
  pctTot: (r: PlanRow) => number | null
  onAdd: () => void
  onPatch: (id: string, p: Partial<PlanRow>) => void
  onRemove: (r: PlanRow) => void
}) {
  return (
    <>
      <tr className={`${styles.secRow} ${props.sec.cls}`}>
        <td colSpan={10}>
          {props.sec.label}
          <span style={{ fontWeight: 600, marginLeft: 10, textTransform: 'none' }}>
            {fmtUsd(props.subtotal)}
          </span>
          <button type="button" className={styles.secAdd} onClick={props.onAdd}>
            {props.sec.add}
          </button>
          {props.sec.key === 'long_term' && (
            <span style={{ fontWeight: 500, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
              one line per property
            </span>
          )}
        </td>
      </tr>
      {props.rows.map((r) => {
        const linked = r.source !== 'manual'
        const amtLocked = linked && r.amount_override == null
        const badge =
          r.stale
            ? { cls: styles.badgeStale, text: 'stale' }
            : r.source === 'managed'
              ? { cls: styles.badge, text: 'SMA' }
              : r.source === 'fund'
                ? { cls: `${styles.badge} ${styles.badgeFund}`, text: 'FUND' }
                : null
        const act =
          r.section === 'income'
            ? rowAmount(r)
            : linked
              ? r.pnl_actual_live
              : r.pnl_actual
        const est = rowPnlEst(r)
        return (
          <tr key={r.id} className={r.hidden ? styles.hiddenRow : undefined}>
            <td>
              <div className={styles.line}>
                {badge && <span className={badge.cls}>{badge.text}</span>}
                <input
                  className={styles.lineIn}
                  value={r.label}
                  onChange={(e) => props.onPatch(r.id, { label: e.target.value })}
                />
              </div>
            </td>
            <td>
              {r.section !== 'income' && r.section !== 'liability' ? (
                <input
                  className={styles.check}
                  type="checkbox"
                  title="Count in investable book"
                  checked={r.include_in_investments}
                  onChange={(e) =>
                    props.onPatch(r.id, { include_in_investments: e.target.checked })
                  }
                />
              ) : null}
            </td>
            <td>
              <NumCell
                value={
                  amtLocked
                    ? r.live_amount ?? r.amount
                    : r.amount_override ?? r.amount
                }
                disabled={amtLocked}
                onChange={(v) => {
                  if (linked) props.onPatch(r.id, { amount_override: v })
                  else props.onPatch(r.id, { amount: v })
                }}
                placeholder={linked ? 'live' : '0'}
              />
              {linked && r.amount_override != null && (
                <span className={styles.ovHint}>
                  live {fmtUsd(r.live_amount)} — click lock to revert
                </span>
              )}
            </td>
            <td className={styles.cellMuted}>
              {props.pctTot(r) == null ? '' : fmtPct(props.pctTot(r), 1).replace('+', '')}
            </td>
            <td className={styles.colYield}>
              {r.section === 'income' ? (
                <span className={styles.cellMuted}>n/a</span>
              ) : (
                <NumCell
                  kind="pct"
                  value={rowYield(r)}
                  onChange={(v) => props.onPatch(r.id, { yield_pct: v })}
                  placeholder="%"
                />
              )}
            </td>
            <td className={styles.cellMuted}>{est == null ? '' : fmtUsd(est)}</td>
            <td>
              {linked || r.section === 'income' ? (
                <span className={styles.cellMuted} style={{ whiteSpace: 'nowrap' }}>
                  {act == null ? '' : fmtUsd(act)}
                  {r.ytd_pct != null ? ` (${fmtPct(r.ytd_pct)} YTD)` : ''}
                </span>
              ) : (
                <NumCell
                  value={r.pnl_actual}
                  onChange={(v) => props.onPatch(r.id, { pnl_actual: v })}
                  placeholder="actual"
                />
              )}
            </td>
            <td>
              <input
                className={styles.notesIn}
                value={r.notes}
                onChange={(e) => props.onPatch(r.id, { notes: e.target.value })}
              />
            </td>
            <td className={styles.cellMuted}>
              {r.section === 'income' || r.section === 'liability'
                ? ''
                : r.capital_gains == null
                  ? ''
                  : fmtUsd(r.capital_gains)}
            </td>
            <td>
              {linked && (
                <button
                  type="button"
                  className={styles.iconBtn}
                  title={
                    r.amount_override != null
                      ? 'Use live NAV'
                      : 'Override amount for planning'
                  }
                  onClick={() =>
                    props.onPatch(r.id, {
                      amount_override:
                        r.amount_override == null ? r.live_amount ?? 0 : null,
                    })
                  }
                >
                  {r.amount_override != null ? '↺' : '✎'}
                </button>
              )}
              {r.hidden ? (
                <button
                  type="button"
                  className={styles.iconBtn}
                  title="Restore"
                  onClick={() => props.onPatch(r.id, { hidden: false })}
                >
                  +
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.iconBtnDanger}
                  title={linked ? 'Hide linked line' : 'Delete'}
                  onClick={() => props.onRemove(r)}
                >
                  ×
                </button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}
