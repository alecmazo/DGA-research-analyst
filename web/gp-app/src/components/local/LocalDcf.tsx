import { useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import {
  type DcfDraft,
  type DcfPins,
  type DcfSeed,
  type FinRow,
  type GapId,
  GAP_LABEL,
  draftFromSeed,
  emptyDraft,
  inputsFromDraft,
  linkDraft,
  parseMillions,
  parsePercent,
  seedFromFinancials,
  suggestWacc,
  valueDcf,
} from '@/lib/dcf'
import { fmtCap, fmtPct, fmtPx } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import styles from './LocalDcf.module.css'

type FinPayload = {
  ok?: boolean
  error?: string
  entity_name?: string | null
  rows?: FinRow[]
}

type QuoteRow = {
  price?: number | null
  source?: string | null
}

const OPEN_PINS: DcfPins = { wacc: false, netDebt: false, equity: false }

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        aria-label={label}
      />
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  )
}

function sourceText(seed: DcfSeed): string {
  const who = [
    seed.company,
    seed.fy != null ? `FY${seed.fy}` : null,
    seed.periodEnd ? `year ended ${seed.periodEnd}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const shares =
    seed.shareBasis === 'diluted'
      ? 'Diluted shares from that year.'
      : seed.shareBasis === 'outstanding'
        ? 'Shares outstanding from that year. Diluted shares were blank.'
        : ''
  const fcf =
    seed.fcf != null && seed.revenue != null
      ? `Free cash flow ${fmtCap(seed.fcf)} on revenue ${fmtCap(seed.revenue)}.`
      : ''
  const margin =
    seed.operatingMargin != null
      ? `Operating margin ${(seed.operatingMargin * 100).toFixed(1)}% is context only. The model uses the free-cash-flow margin, which is already after tax.`
      : ''
  const price =
    seed.price != null
      ? `Price is the ${seed.priceSource === 'live' ? 'live' : 'stored'} quote.`
      : 'No quote came back, so price was left blank.'
  const book = seed.bookEquity != null ? `Book equity ${fmtCap(seed.bookEquity)}.` : ''
  return [who, shares, fcf, seed.growthLabel ? `${seed.growthLabel}.` : '', margin, price, book]
    .filter(Boolean)
    .join(' ')
}

export function LocalDcf() {
  const [ticker, setTicker] = useState('AAPL')
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [seed, setSeed] = useState<DcfSeed | null>(null)
  const [draft, setDraft] = useState<DcfDraft>(emptyDraft())
  const [terminal, setTerminal] = useState<'growth' | 'exit'>('growth')
  const [started, setStarted] = useState(false)
  const pins = useRef<DcfPins>({ ...OPEN_PINS })
  const bookEquity = useRef<number | null>(null)

  const commit = (patch: Partial<DcfDraft>, pin?: Partial<DcfPins>) => {
    if (pin?.wacc != null) pins.current.wacc = pin.wacc
    if (pin?.netDebt != null) pins.current.netDebt = pin.netDebt
    if (pin?.equity != null) pins.current.equity = pin.equity
    setStarted(true)
    setDraft((prev) => linkDraft({ ...prev, ...patch }, pins.current, bookEquity.current))
  }

  const load = async () => {
    const tk = ticker.trim().toUpperCase()
    if (!tk) return
    setTicker(tk)
    setLoading(true)
    setLoadErr(null)
    setStarted(true)
    try {
      const [fin, quote] = await Promise.all([
        api<FinPayload>(`/api/financials/${encodeURIComponent(tk)}?period_type=annual`),
        api<Record<string, QuoteRow>>(`/api/quotes?tickers=${encodeURIComponent(tk)}`).catch(() => null),
      ])
      if (fin && fin.ok === false) {
        throw new Error(fin.error || `No financials stored for ${tk}`)
      }
      const rows = fin?.rows || []
      if (rows.length === 0) {
        pins.current = { ...OPEN_PINS }
        bookEquity.current = null
        setSeed(null)
        setDraft(emptyDraft())
        setTerminal('growth')
        setLoadErr(`No financials stored for ${tk}.`)
        return
      }
      const q = quote?.[tk]
      const price = typeof q?.price === 'number' && q.price > 0 ? q.price : null
      const next = seedFromFinancials(rows, fin?.entity_name || null, price, q?.source || null)
      pins.current = { ...OPEN_PINS }
      bookEquity.current = next.bookEquity
      setSeed(next)
      setTerminal('growth')
      setDraft(linkDraft(draftFromSeed(next), pins.current, next.bookEquity))
    } catch (e) {
      pins.current = { ...OPEN_PINS }
      bookEquity.current = null
      setSeed(null)
      setDraft(emptyDraft())
      setLoadErr(e instanceof Error ? e.message : 'Could not load financials')
    } finally {
      setLoading(false)
    }
  }

  const inputs = useMemo(() => inputsFromDraft(draft, terminal), [draft, terminal])
  const result = useMemo(() => valueDcf(inputs), [inputs])
  const waccNote = useMemo(() => {
    if (pins.current.wacc) {
      return 'Using the WACC you typed. Edit cost of equity, the equity value, or debt to rebuild it.'
    }
    return suggestWacc({
      equity: parseMillions(draft.waccEquity),
      debt: parseMillions(draft.grossDebt),
      costOfEquity: parsePercent(draft.costOfEquity),
      preTaxCostOfDebt: parsePercent(draft.preTaxCostOfDebt),
      tax: parsePercent(draft.tax),
    }).note
  }, [draft])

  const gapLine = seed
    ? seed.gaps
        .filter((id) => gapStillBlank(id, draft))
        .map((id) => GAP_LABEL[id])
        .join(', ')
    : ''

  const upsideClass =
    result.upside == null ? undefined : result.upside >= 0 ? styles.up : styles.down

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        void load()
      }}
    >
      <div className={styles.ticker}>
        <div className={styles.tickerRow}>
          <label className={styles.field}>
            <span>Ticker</span>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              aria-label="DCF ticker"
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <Button variant="primary" disabled={loading} type="submit">
            {loading ? 'Loading…' : 'Load'}
          </Button>
        </div>
      </div>

      {loadErr && <div className={styles.warn}>{loadErr}</div>}
      {seed && <div className={styles.source}>{sourceText(seed)}</div>}
      {gapLine && (
        <div className={styles.warn}>
          Left blank because the store does not have them: {gapLine}.
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.groups}>
          <div className={styles.group}>
            <h3>Base year</h3>
            <div className={styles.fields}>
              <Field
                label="Revenue ($ millions)"
                value={draft.revenue}
                onChange={(v) => commit({ revenue: v })}
              />
              <Field
                label="FCF margin (%)"
                hint="Free cash flow ÷ revenue. Already after tax and reinvestment."
                value={draft.fcfMargin}
                onChange={(v) => commit({ fcfMargin: v })}
              />
              <Field
                label="Cash ($ millions)"
                hint="Cash plus short-term investments. Editing this rebuilds net debt."
                value={draft.cash}
                onChange={(v) => commit({ cash: v }, { netDebt: false })}
              />
              <Field
                label="Gross debt ($ millions)"
                hint="Editing this rebuilds net debt and, unless you typed a WACC, the discount rate."
                value={draft.grossDebt}
                onChange={(v) => commit({ grossDebt: v }, { netDebt: false, wacc: false })}
              />
              <Field
                label="Net debt ($ millions)"
                hint="Gross debt minus cash, until you edit this box."
                value={draft.netDebt}
                onChange={(v) => commit({ netDebt: v }, { netDebt: true })}
              />
              <Field
                label="Shares (millions)"
                hint="Diluted shares when the store has them."
                value={draft.shares}
                onChange={(v) => commit({ shares: v })}
              />
              <Field
                label="Price ($)"
                value={draft.price}
                onChange={(v) => commit({ price: v })}
              />
            </div>
          </div>

          <div className={styles.group}>
            <h3>Forecast</h3>
            <div className={styles.fields}>
              <Field
                label="Revenue growth (%)"
                hint={seed?.growthLabel || 'Left blank when the store has fewer than two annual revenue years.'}
                value={draft.growth}
                onChange={(v) => commit({ growth: v })}
              />
              <Field
                label="Explicit years"
                hint="How many years revenue compounds before the terminal value. Assumption, default 5."
                value={draft.years}
                onChange={(v) => commit({ years: v })}
              />
              <label className={styles.field}>
                <span>Terminal</span>
                <select
                  value={terminal}
                  aria-label="Terminal"
                  onChange={(e) => setTerminal(e.target.value === 'exit' ? 'exit' : 'growth')}
                >
                  <option value="growth">Growth perpetuity</option>
                  <option value="exit">Exit FCF multiple</option>
                </select>
              </label>
              {terminal === 'growth' ? (
                <Field
                  label="Terminal growth (%)"
                  hint="Assumption, not from the store."
                  value={draft.terminalGrowth}
                  onChange={(v) => commit({ terminalGrowth: v })}
                />
              ) : (
                <Field
                  label="Exit multiple (× FCF)"
                  hint="Times the last explicit year's free cash flow. Not from the store."
                  value={draft.exitMultiple}
                  onChange={(v) => commit({ exitMultiple: v })}
                />
              )}
            </div>

            <h3 className={styles.later}>Discount rate</h3>
            <div className={styles.fields}>
              <Field
                label="WACC (%)"
                hint={waccNote}
                value={draft.wacc}
                onChange={(v) => commit({ wacc: v }, { wacc: true })}
              />
              <Field
                label="Cost of equity (%)"
                hint="Assumption. The financials dashboard uses 9% with no beta. Not from the filing."
                value={draft.costOfEquity}
                onChange={(v) => commit({ costOfEquity: v }, { wacc: false })}
              />
              <Field
                label="Equity in WACC ($ millions)"
                hint="Price × shares until you edit it. With no quote, it starts at book equity."
                value={draft.waccEquity}
                onChange={(v) => commit({ waccEquity: v }, { equity: true, wacc: false })}
              />
              <Field
                label="Pre-tax cost of debt (%)"
                hint="Not in the store. With a tax rate, this replaces the 4.3% after-tax assumption."
                value={draft.preTaxCostOfDebt}
                onChange={(v) => commit({ preTaxCostOfDebt: v }, { wacc: false })}
              />
              <Field
                label="Tax rate (%)"
                hint="Not in the store. Free cash flow is not taxed again. Used only to turn a pre-tax cost of debt into an after-tax one."
                value={draft.tax}
                onChange={(v) => commit({ tax: v }, { wacc: false })}
              />
            </div>
          </div>
        </div>

        <div className={styles.outs} aria-live="polite">
          <div className={styles.hero}>
            <span>Value per share</span>
            <strong aria-label="Value per share">{fmtPx(result.valuePerShare)}</strong>
          </div>
          <div className={styles.line}>
            <span>Upside vs price</span>
            <strong className={upsideClass} aria-label="Upside">
              {result.upside == null ? '—' : fmtPct(result.upside * 100, 1)}
            </strong>
          </div>
          {started && result.reason && <div className={styles.warn}>{result.reason}</div>}
          <div className={styles.bridge}>
            <div className={styles.line}>
              <span>Explicit period</span>
              <strong>{fmtCap(result.explicitPv)}</strong>
            </div>
            <div className={styles.line}>
              <span>Terminal, present value</span>
              <strong>{fmtCap(result.terminalPv)}</strong>
            </div>
            <div className={styles.line}>
              <span>Enterprise value</span>
              <strong aria-label="Enterprise value">{fmtCap(result.enterpriseValue)}</strong>
            </div>
            <div className={styles.line}>
              <span>Net debt</span>
              <strong>{fmtCap(inputs.netDebt)}</strong>
            </div>
            <div className={styles.line}>
              <span>Equity value</span>
              <strong aria-label="Equity value">{fmtCap(result.equityValue)}</strong>
            </div>
          </div>
          {result.years.length > 0 && (
            <table className={styles.years}>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Revenue</th>
                  <th>FCFF</th>
                  <th>PV</th>
                </tr>
              </thead>
              <tbody>
                {result.years.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td>{fmtCap(y.revenue)}</td>
                    <td>{fmtCap(y.fcff)}</td>
                    <td>{fmtCap(y.pv)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Term</td>
                  <td />
                  <td>{fmtCap(result.terminalValue)}</td>
                  <td>{fmtCap(result.terminalPv)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <div className={styles.formula}>
            Year-end discounting. Free cash flow is revenue times the FCF margin, then discounted at WACC.
          </div>
        </div>
      </div>
    </form>
  )
}

function gapStillBlank(id: GapId, draft: DcfDraft): boolean {
  const map: Record<GapId, string> = {
    revenue: draft.revenue,
    fcf: draft.fcfMargin,
    cash: draft.cash,
    debt: draft.grossDebt,
    shares: draft.shares,
    price: draft.price,
    growth: draft.growth,
    tax: draft.tax,
    costOfDebt: draft.preTaxCostOfDebt,
    equity: draft.waccEquity,
  }
  return map[id].trim() === ''
}
