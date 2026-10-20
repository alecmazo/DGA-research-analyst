/**
 * Two-stage free cash flow to the firm (FCFF).
 *
 * This is the compact Damodaran / Koyfin / Bloomberg DCF: grow revenue for a
 * few explicit years, turn it into free cash flow with a margin, discount at
 * WACC, and close with either a growth perpetuity or an exit multiple.
 * Cash flows are discounted at each year-end (not mid-year).
 *
 * Revenue in year t is the base-year revenue compounded at the growth rate.
 * Free cash flow that year is revenue times the FCF margin. The margin is
 * already after tax and after reinvestment, so tax is not applied again.
 * Enterprise value is the sum of those present values plus the present value
 * of the terminal value. In the growth case the terminal value is next year's
 * free cash flow divided by WACC minus terminal growth. In the exit case it
 * is the last explicit year's free cash flow times the exit multiple. Equity
 * value is enterprise value minus net debt. Value per share is equity value
 * divided by shares. Upside is that value divided by the price, minus one.
 */

export const DASHBOARD_COST_OF_EQUITY = 0.09
export const DASHBOARD_AFTER_TAX_COST_OF_DEBT = 0.043
export const DEFAULT_EXPLICIT_YEARS = 5
export const DEFAULT_TERMINAL_GROWTH = 0.025

export type GapId =
  | 'revenue'
  | 'fcf'
  | 'cash'
  | 'debt'
  | 'shares'
  | 'price'
  | 'growth'
  | 'tax'
  | 'costOfDebt'
  | 'equity'

export const GAP_LABEL: Record<GapId, string> = {
  revenue: 'revenue',
  fcf: 'free cash flow',
  cash: 'cash',
  debt: 'gross debt',
  shares: 'shares',
  price: 'price',
  growth: 'revenue growth',
  tax: 'tax rate',
  costOfDebt: 'pre-tax cost of debt',
  equity: 'equity value for WACC',
}

export type FinRow = {
  fy?: number | string | null
  period_end?: string | null
  entity_name?: string | null
  revenue?: number | string | null
  free_cash_flow?: number | string | null
  operating_income?: number | string | null
  operating_margin?: number | string | null
  diluted_shares?: number | string | null
  shares_outstanding?: number | string | null
  cash?: number | string | null
  short_term_investments?: number | string | null
  total_debt?: number | string | null
  long_term_debt?: number | string | null
  short_term_debt?: number | string | null
  lease_liability?: number | string | null
  lease_liability_current?: number | string | null
  lease_liability_noncurrent?: number | string | null
  stockholders_equity?: number | string | null
}

export type DcfSeed = {
  company: string | null
  fy: number | null
  periodEnd: string | null
  revenue: number | null
  fcf: number | null
  fcfMargin: number | null
  cash: number | null
  grossDebt: number | null
  shares: number | null
  shareBasis: 'diluted' | 'outstanding' | null
  bookEquity: number | null
  operatingMargin: number | null
  growth: number | null
  growthLabel: string | null
  price: number | null
  priceSource: string | null
  gaps: GapId[]
}

export type DcfInputs = {
  revenue: number | null
  growth: number | null
  years: number | null
  fcfMargin: number | null
  wacc: number | null
  terminal: 'growth' | 'exit'
  terminalGrowth: number | null
  exitMultiple: number | null
  netDebt: number | null
  shares: number | null
  price: number | null
}

export type DcfYear = {
  year: number
  revenue: number
  fcff: number
  pv: number
}

export type DcfResult = {
  reason: string | null
  years: DcfYear[]
  explicitPv: number | null
  terminalValue: number | null
  terminalPv: number | null
  enterpriseValue: number | null
  equityValue: number | null
  valuePerShare: number | null
  upside: number | null
}

export type WaccBuild = {
  wacc: number | null
  note: string
}

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function parseInput(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '').replace(/%$/, '')
  if (t === '' || t === '-' || t === '.' || t === '-.' || t === '+') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function formatPlain(n: number, digits: number): string {
  if (!Number.isFinite(n)) return ''
  const neg = n < 0
  const s = Math.abs(n)
    .toFixed(digits)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
  return neg ? `-${s}` : s
}

export function formatMillions(dollars: number): string {
  return formatPlain(dollars / 1e6, 2)
}

export function formatShareMillions(shares: number): string {
  return formatPlain(shares / 1e6, 4)
}

export function formatPercentPoints(rate: number): string {
  return formatPlain(rate * 100, 2)
}

export function parseMillions(raw: string): number | null {
  const n = parseInput(raw)
  return n == null ? null : n * 1e6
}

export function parsePercent(raw: string): number | null {
  const n = parseInput(raw)
  return n == null ? null : n / 100
}

/** Cash plus short-term investments. Same definition as the financials dashboard. */
export function cashOf(row: FinRow): number | null {
  const c = num(row.cash)
  const sti = num(row.short_term_investments)
  if (c == null && sti == null) return null
  return (c ?? 0) + (sti ?? 0)
}

/** Gross debt, preferring total debt. Same definition as the financials dashboard. */
export function debtOf(row: FinRow): number | null {
  const td = num(row.total_debt)
  const ltd = num(row.long_term_debt)
  const std = num(row.short_term_debt)
  const notes = ltd == null && std == null ? null : (ltd ?? 0) + (std ?? 0)
  const lease = num(row.lease_liability)
  const lc = num(row.lease_liability_current)
  const ln = num(row.lease_liability_noncurrent)
  const leases =
    lease != null ? lease : lc == null && ln == null ? null : (lc ?? 0) + (ln ?? 0)
  if (notes != null || leases != null) {
    const summed = (notes ?? 0) + (leases ?? 0)
    if (td == null || td === 0) return summed
    return td
  }
  return td
}

function revenueCagr(rows: FinRow[]): { rate: number; label: string } | null {
  const byFy = new Map<number, number>()
  for (const row of rows) {
    const fy = num(row.fy)
    const rev = num(row.revenue)
    if (fy == null || rev == null || rev <= 0) continue
    if (!byFy.has(fy)) byFy.set(fy, rev)
  }
  const fys = [...byFy.keys()].sort((a, b) => a - b)
  if (fys.length < 2) return null
  const lastFy = fys[fys.length - 1]
  const window = fys.filter((y) => y >= lastFy - 5)
  const firstFy = window[0]
  const span = lastFy - firstFy
  if (span <= 0) return null
  const first = byFy.get(firstFy)
  const last = byFy.get(lastFy)
  if (first == null || last == null || first <= 0) return null
  const rate = (last / first) ** (1 / span) - 1
  if (!Number.isFinite(rate)) return null
  return {
    rate,
    label: `Revenue growth is the FY${firstFy}–FY${lastFy} CAGR from the store (${span} year${span === 1 ? '' : 's'})`,
  }
}

function operatingMarginOf(row: FinRow, revenue: number | null): number | null {
  let om = num(row.operating_margin)
  if (om != null && Math.abs(om) > 2) om = om / 100
  if (om == null && revenue != null && revenue !== 0) {
    const op = num(row.operating_income)
    if (op != null) om = op / revenue
  }
  return om != null && Number.isFinite(om) ? om : null
}

export function seedFromFinancials(
  rows: FinRow[],
  company: string | null,
  price: number | null,
  priceSource: string | null,
): DcfSeed {
  const base = rows.find((row) => {
    const rev = num(row.revenue)
    return rev != null && rev > 0
  })
  const gaps: GapId[] = ['tax', 'costOfDebt']
  const empty: DcfSeed = {
    company: company || numName(rows),
    fy: null,
    periodEnd: null,
    revenue: null,
    fcf: null,
    fcfMargin: null,
    cash: null,
    grossDebt: null,
    shares: null,
    shareBasis: null,
    bookEquity: null,
    operatingMargin: null,
    growth: null,
    growthLabel: null,
    price: price != null && price > 0 ? price : null,
    priceSource,
    gaps,
  }
  if (!base) {
    gaps.unshift('revenue', 'fcf', 'cash', 'debt', 'shares', 'growth', 'equity')
    if (empty.price == null) gaps.push('price')
    return empty
  }

  const revenue = num(base.revenue)
  const fcf = num(base.free_cash_flow)
  const cash = cashOf(base)
  const grossDebt = debtOf(base)
  const diluted = num(base.diluted_shares)
  const basic = num(base.shares_outstanding)
  const shares = diluted != null && diluted > 0 ? diluted : basic != null && basic > 0 ? basic : null
  const shareBasis: DcfSeed['shareBasis'] =
    diluted != null && diluted > 0 ? 'diluted' : basic != null && basic > 0 ? 'outstanding' : null
  const bookEquity = num(base.stockholders_equity)
  const cagr = revenueCagr(rows)
  const fcfMargin = revenue != null && revenue > 0 && fcf != null ? fcf / revenue : null
  const marketEquity =
    empty.price != null && shares != null && shares > 0 ? empty.price * shares : null
  const equityOk = (marketEquity != null && marketEquity > 0) || (bookEquity != null && bookEquity > 0)

  if (revenue == null) gaps.push('revenue')
  if (fcf == null) gaps.push('fcf')
  if (cash == null) gaps.push('cash')
  if (grossDebt == null) gaps.push('debt')
  if (shares == null) gaps.push('shares')
  if (cagr == null) gaps.push('growth')
  if (empty.price == null) gaps.push('price')
  if (!equityOk) gaps.push('equity')

  return {
    company: company || base.entity_name || empty.company,
    fy: num(base.fy),
    periodEnd: base.period_end ? String(base.period_end).slice(0, 10) : null,
    revenue,
    fcf,
    fcfMargin,
    cash,
    grossDebt,
    shares,
    shareBasis,
    bookEquity,
    operatingMargin: operatingMarginOf(base, revenue),
    growth: cagr?.rate ?? null,
    growthLabel: cagr?.label ?? null,
    price: empty.price,
    priceSource,
    gaps,
  }
}

function numName(rows: FinRow[]): string | null {
  for (const row of rows) {
    if (row.entity_name) return String(row.entity_name)
  }
  return null
}

export function suggestWacc(args: {
  equity: number | null
  debt: number | null
  costOfEquity: number | null
  preTaxCostOfDebt: number | null
  tax: number | null
}): WaccBuild {
  const equity = args.equity
  const debt = args.debt
  if (equity == null || equity <= 0) {
    return {
      wacc: null,
      note: 'Equity value in the capital structure is blank, so this WACC is only what you type.',
    }
  }
  if (debt == null) {
    return {
      wacc: null,
      note: 'Gross debt is blank, so the capital-structure WACC is blank.',
    }
  }
  if (args.costOfEquity == null) {
    return { wacc: null, note: 'Cost of equity is blank.' }
  }
  const d = Math.max(debt, 0)
  const cap = equity + d
  if (!(cap > 0)) return { wacc: null, note: 'Capital structure has no positive capital.' }
  const we = equity / cap
  const wd = d / cap
  const weights = `Equity weight ${(we * 100).toFixed(1)}%, debt weight ${(wd * 100).toFixed(1)}%.`
  let kdAt = DASHBOARD_AFTER_TAX_COST_OF_DEBT
  let kdNote =
    'After-tax cost of debt is 4.3%, the financials dashboard assumption, because tax or the pre-tax cost of debt is blank.'
  if (args.preTaxCostOfDebt != null && args.tax != null) {
    if (args.tax < 0 || args.tax >= 1) {
      return { wacc: null, note: 'Tax rate has to be from 0% up to, but not including, 100%.' }
    }
    kdAt = args.preTaxCostOfDebt * (1 - args.tax)
    kdNote = 'After-tax cost of debt is the pre-tax rate times one minus the tax rate you entered.'
  }
  const wacc = args.costOfEquity * we + kdAt * wd
  if (!Number.isFinite(wacc)) return { wacc: null, note: 'WACC did not compute.' }
  return { wacc, note: `${weights} ${kdNote}` }
}

export type DcfDraft = {
  revenue: string
  fcfMargin: string
  cash: string
  grossDebt: string
  netDebt: string
  shares: string
  price: string
  growth: string
  years: string
  costOfEquity: string
  waccEquity: string
  tax: string
  preTaxCostOfDebt: string
  wacc: string
  terminalGrowth: string
  exitMultiple: string
}

export type DcfPins = {
  wacc: boolean
  netDebt: boolean
  equity: boolean
}

export function emptyDraft(): DcfDraft {
  return {
    revenue: '',
    fcfMargin: '',
    cash: '',
    grossDebt: '',
    netDebt: '',
    shares: '',
    price: '',
    growth: '',
    years: String(DEFAULT_EXPLICIT_YEARS),
    costOfEquity: '',
    waccEquity: '',
    tax: '',
    preTaxCostOfDebt: '',
    wacc: '',
    terminalGrowth: formatPercentPoints(DEFAULT_TERMINAL_GROWTH),
    exitMultiple: '',
  }
}

export function draftFromSeed(seed: DcfSeed): DcfDraft {
  const draft = emptyDraft()
  if (seed.revenue != null) draft.revenue = formatMillions(seed.revenue)
  if (seed.fcfMargin != null) draft.fcfMargin = formatPercentPoints(seed.fcfMargin)
  if (seed.cash != null) draft.cash = formatMillions(seed.cash)
  if (seed.grossDebt != null) draft.grossDebt = formatMillions(seed.grossDebt)
  if (seed.shares != null) draft.shares = formatShareMillions(seed.shares)
  if (seed.price != null) draft.price = formatPlain(seed.price, 2)
  if (seed.growth != null) draft.growth = formatPercentPoints(seed.growth)
  const market = seed.price != null && seed.shares != null ? seed.price * seed.shares : null
  const canBuild =
    seed.grossDebt != null && ((market != null && market > 0) || (seed.bookEquity != null && seed.bookEquity > 0))
  if (canBuild) draft.costOfEquity = formatPercentPoints(DASHBOARD_COST_OF_EQUITY)
  return draft
}

/** Fill net debt, WACC equity, and WACC from the other boxes unless the user pinned them. */
export function linkDraft(draft: DcfDraft, pins: DcfPins, bookEquity: number | null): DcfDraft {
  const next = { ...draft }
  if (!pins.equity) {
    const px = parseInput(draft.price)
    const shares = parseMillions(draft.shares)
    if (px != null && px > 0 && shares != null && shares > 0) {
      next.waccEquity = formatMillions(px * shares)
    } else if (bookEquity != null && bookEquity > 0) {
      next.waccEquity = formatMillions(bookEquity)
    } else {
      next.waccEquity = ''
    }
  }
  if (!pins.netDebt) {
    const cash = parseMillions(draft.cash)
    const debt = parseMillions(draft.grossDebt)
    next.netDebt = cash != null && debt != null ? formatMillions(debt - cash) : ''
  }
  if (!pins.wacc) {
    const built = suggestWacc({
      equity: parseMillions(next.waccEquity),
      debt: parseMillions(next.grossDebt),
      costOfEquity: parsePercent(next.costOfEquity),
      preTaxCostOfDebt: parsePercent(next.preTaxCostOfDebt),
      tax: parsePercent(next.tax),
    })
    next.wacc = built.wacc == null ? '' : formatPercentPoints(built.wacc)
  }
  return next
}

export function inputsFromDraft(draft: DcfDraft, terminal: 'growth' | 'exit'): DcfInputs {
  return {
    revenue: parseMillions(draft.revenue),
    growth: parsePercent(draft.growth),
    years: parseInput(draft.years),
    fcfMargin: parsePercent(draft.fcfMargin),
    wacc: parsePercent(draft.wacc),
    terminal,
    terminalGrowth: parsePercent(draft.terminalGrowth),
    exitMultiple: parseInput(draft.exitMultiple),
    netDebt: parseMillions(draft.netDebt),
    shares: parseMillions(draft.shares),
    price: parseInput(draft.price),
  }
}

export function valueDcf(inputs: DcfInputs): DcfResult {
  const blank: DcfResult = {
    reason: null,
    years: [],
    explicitPv: null,
    terminalValue: null,
    terminalPv: null,
    enterpriseValue: null,
    equityValue: null,
    valuePerShare: null,
    upside: null,
  }
  const revenue = inputs.revenue
  const growth = inputs.growth
  const yearsN = inputs.years
  const margin = inputs.fcfMargin
  const wacc = inputs.wacc
  if (revenue == null) return { ...blank, reason: 'Revenue is blank.' }
  if (!(revenue > 0)) return { ...blank, reason: 'Revenue has to be above zero.' }
  if (growth == null) return { ...blank, reason: 'Revenue growth is blank.' }
  if (!(growth > -1)) return { ...blank, reason: 'Revenue growth has to be above −100%.' }
  if (yearsN == null) return { ...blank, reason: 'Explicit years are blank.' }
  if (!Number.isInteger(yearsN) || yearsN < 1 || yearsN > 15) {
    return { ...blank, reason: 'Explicit years have to be a whole number from 1 to 15.' }
  }
  if (margin == null) return { ...blank, reason: 'FCF margin is blank.' }
  if (wacc == null) return { ...blank, reason: 'WACC is blank.' }
  if (!(wacc > 0)) return { ...blank, reason: 'WACC has to be above zero.' }

  let terminalValueAtN: number | null = null
  if (inputs.terminal === 'exit') {
    if (inputs.exitMultiple == null) return { ...blank, reason: 'Exit multiple is blank.' }
    if (!(inputs.exitMultiple > 0)) return { ...blank, reason: 'Exit multiple has to be above zero.' }
  } else {
    if (inputs.terminalGrowth == null) return { ...blank, reason: 'Terminal growth is blank.' }
    if (!(wacc > inputs.terminalGrowth)) {
      return { ...blank, reason: 'WACC has to be higher than terminal growth.' }
    }
  }

  const years: DcfYear[] = []
  let explicitPv = 0
  let fcffN = 0
  for (let t = 1; t <= yearsN; t += 1) {
    const yearRevenue = revenue * (1 + growth) ** t
    const fcff = yearRevenue * margin
    const pv = fcff / (1 + wacc) ** t
    if (!Number.isFinite(yearRevenue) || !Number.isFinite(fcff) || !Number.isFinite(pv)) {
      return { ...blank, reason: 'The cash flows did not stay finite.' }
    }
    years.push({ year: t, revenue: yearRevenue, fcff, pv })
    explicitPv += pv
    fcffN = fcff
  }

  let terminalValue = 0
  if (inputs.terminal === 'exit') {
    terminalValue = fcffN * (inputs.exitMultiple as number)
  } else {
    const g = inputs.terminalGrowth as number
    terminalValue = (fcffN * (1 + g)) / (wacc - g)
  }
  terminalValueAtN = terminalValue
  const terminalPv = terminalValue / (1 + wacc) ** yearsN
  if (!Number.isFinite(explicitPv) || !Number.isFinite(terminalValue) || !Number.isFinite(terminalPv)) {
    return { ...blank, reason: 'The cash flows did not stay finite.' }
  }
  const enterpriseValue = explicitPv + terminalPv
  const result: DcfResult = {
    reason: null,
    years,
    explicitPv,
    terminalValue: terminalValueAtN,
    terminalPv,
    enterpriseValue,
    equityValue: null,
    valuePerShare: null,
    upside: null,
  }
  if (inputs.netDebt == null) {
    result.reason = 'Net debt is blank.'
    return result
  }
  const equityValue = enterpriseValue - inputs.netDebt
  result.equityValue = equityValue
  if (inputs.shares == null) {
    result.reason = 'Shares are blank.'
    return result
  }
  if (!(inputs.shares > 0)) {
    result.reason = 'Shares have to be above zero.'
    return result
  }
  const valuePerShare = equityValue / inputs.shares
  if (!Number.isFinite(valuePerShare)) {
    return { ...blank, reason: 'Value per share did not stay finite.' }
  }
  result.valuePerShare = valuePerShare
  if (inputs.price != null && inputs.price > 0) {
    result.upside = valuePerShare / inputs.price - 1
  }
  return result
}
