export type PeriodType = 'annual' | 'quarter'

export type CoverageRow = {
  ticker?: string
  entity_name?: string
  quarters?: number
  annuals?: number
  earliest?: string
  latest?: string
}

export type SheetLink = {
  ticker?: string
  name?: string
  annuals?: number
  quarters?: number
  followed?: boolean
}

export type DashSeriesPoint = {
  label?: string
  period_end?: string | null
  revenue?: number | null
  net_income?: number | null
  ebitda?: number | null
  cash?: number | null
  debt?: number | null
  ocf?: number | null
  fcf?: number | null
  dividends?: number | null
  buybacks?: number | null
  shares?: number | null
  buyback_ratio_pct?: number | null
  equity?: number | null
  assets?: number | null
  gross_margin_pct?: number | null
  operating_margin_pct?: number | null
  net_margin_pct?: number | null
  roic_pct?: number | null
  wacc_pct?: number | null
}

export type RankMetric = {
  name?: string
  value?: number | null
  fmt?: string
  hist_pct?: number | null
  hist_color?: string
  ind_pct?: number | null
  ind_color?: string
  note?: string
}

export type RankCard = {
  title?: string
  rank?: number | null
  peer_count?: number
  peer_scope?: string
  metrics?: RankMetric[]
}

export type RankCards = {
  financial_strength?: RankCard
  profitability?: RankCard
  value?: RankCard
  peer_scope?: string
  peer_count?: number
}

export type PeerRow = {
  ticker?: string
  name?: string
  price?: number | null
  market_cap?: number | null
  pe?: number | null
  pe_nm?: boolean
  ev_ebitda?: number | null
  net_margin_pct?: number | null
  rev_yoy_pct?: number | null
  is_subject?: boolean
}

export type PeersBlock = {
  peers?: PeerRow[]
  industry?: string
  sector?: string
  group_id?: string
  note?: string
  peer_count?: number
}

export type ValuationAnchor = {
  label?: string
  value?: number
  kind?: string
}

export type MetricHistPoint = { as_of?: string; value?: number | null }

export type Dashboard = {
  ok?: boolean
  error?: string
  ticker?: string
  entity_name?: string
  sector?: string
  industry?: string
  period_type?: string
  series?: DashSeriesPoint[]
  price?: number | null
  rating?: string | null
  dga_value?: number | null
  verdict?: string | null
  targets?: { grok?: number | null; claude?: number | null; as_of?: string | null }
  key_metrics?: Record<string, number | null | undefined> & {
    pe_basis?: string
    market_cap?: number | null
    pe?: number | null
    ev_ebitda?: number | null
    enterprise_value?: number | null
    pb?: number | null
    fcf_yield_pct?: number | null
    rev_yoy_pct?: number | null
    roic_pct?: number | null
  }
  ttm?: {
    periods?: number
    period_end?: string
    revenue?: number | null
    net_income?: number | null
    free_cash_flow?: number | null
    eps?: number | null
    net_margin?: number | null
    fcf_margin?: number | null
    gross_margin?: number | null
    gross_margin_pct?: number | null
    operating_margin?: number | null
    op_margin_pct?: number | null
  }
  peers?: PeersBlock | PeerRow[]
  rank_cards?: RankCards
  dga_score?: {
    total?: number | null
    components?: Record<string, number | null | undefined>
    weights?: Record<string, number>
  }
  valuation?: ValuationAnchor[]
  metric_history?: Record<string, MetricHistPoint[]>
  latest_period?: { period_end?: string; fp?: string }
  earnings_8k_pending_10q?: { filed?: string } | null
  notes?: Record<string, string> | string | string[] | null
}

export type SheetBlock = {
  labels?: string[]
  rows?: Array<{
    label?: string
    unit?: string
    values?: Array<number | null | undefined>
  }>
}

export type SheetData = {
  ok?: boolean
  error?: string
  ticker?: string
  entity_name?: string
  industry?: string
  sector?: string
  price?: number | null
  capital?: Record<string, number | string | null | undefined>
  annual?: SheetBlock
  quarterly?: SheetBlock
  source?: string
  cost?: string
}

export type HistoryRow = {
  fy?: number | string
  fp?: string
  period_end?: string
  derived?: boolean
  revenue?: number | null
  gross_margin?: number | null
  operating_income?: number | null
  operating_margin?: number | null
  net_income?: number | null
  net_margin?: number | null
  comprehensive_income?: number | null
  diluted_eps?: number | null
  operating_cash_flow?: number | null
  free_cash_flow?: number | null
  cash?: number | null
  total_debt?: number | null
  total_assets?: number | null
  stockholders_equity?: number | null
  [k: string]: unknown
}

export type ScreenRow = HistoryRow & {
  ticker?: string
  entity_name?: string
}

export type SyncJob = {
  ok?: boolean
  status?: string
  label?: string
  error?: string
  detail?: string
  done?: number
  total?: number
  names_ok?: number
  names_fail?: number
  resumable?: boolean
  result?: { periods_stored?: number }
  job_id?: string
}

export type FinSettings = {
  ok?: boolean
  followed_count?: number
  fin_nightly?: {
    enabled?: boolean
    last?: NightlyLast
  }
  fin_monthly?: {
    enabled?: boolean
    last?: NightlyLast
  }
  fin_us_backfill?: { enabled?: boolean }
}

export type NightlyLast = {
  ts?: string
  at?: string
  updated_count?: number
  updated?: Array<{
    ticker?: string
    latest_period_end?: string
    excel_quarter_end?: string
    fp?: string
    prior_period_end?: string
  }>
  updated_tickers?: string[]
}

export type UniversesMeta = {
  ok?: boolean
  followed?: { count?: number }
  stored_tickers?: number
  stored_bytes?: number
  nightly?: { enabled?: boolean; last?: NightlyLast }
  monthly?: { enabled?: boolean; last?: NightlyLast }
  us_backfill?: { enabled?: boolean }
}

export type PriceHistory = {
  ok?: boolean
  error?: string
  points?: Array<{ t?: string; c?: number }>
  stats?: {
    change_pct?: number | null
    above_low_pct?: number | null
    below_high_pct?: number | null
    last?: number | null
    change_label?: string
  }
}

export type UniverseKey =
  | 'followed'
  | 'reports'
  | 'custom'
  | 'sp500_nasdaq100'
  | 'sp500'
  | 'nasdaq100'

export const FIN_COLS: Array<{ k: string; l: string; kind: 'm' | 'pct' | 'eps' }> = [
  { k: 'revenue', l: 'Revenue', kind: 'm' },
  { k: 'gross_margin', l: 'GM%', kind: 'pct' },
  { k: 'operating_income', l: 'OpInc', kind: 'm' },
  { k: 'operating_margin', l: 'OpM%', kind: 'pct' },
  { k: 'net_income', l: 'NetInc', kind: 'm' },
  { k: 'net_margin', l: 'NetM%', kind: 'pct' },
  { k: 'comprehensive_income', l: 'CompInc', kind: 'm' },
  { k: 'diluted_eps', l: 'DilEPS', kind: 'eps' },
  { k: 'operating_cash_flow', l: 'OCF', kind: 'm' },
  { k: 'free_cash_flow', l: 'FCF', kind: 'm' },
  { k: 'cash', l: 'Cash', kind: 'm' },
  { k: 'total_debt', l: 'Debt', kind: 'm' },
  { k: 'total_assets', l: 'Assets', kind: 'm' },
  { k: 'stockholders_equity', l: 'Equity', kind: 'm' },
]

export const SCREEN_ORDERS = [
  'revenue',
  'net_income',
  'net_margin',
  'gross_margin',
  'operating_margin',
  'ebitda_margin',
  'free_cash_flow',
  'total_assets',
  'total_debt',
  'diluted_eps',
] as const

export const PRICE_RANGES = [
  '5D',
  '1M',
  '3M',
  'YTD',
  '1Y',
  '3Y',
  '5Y',
  '10Y',
  'All',
] as const

export const LS_LAST_TICKER = 'dga_fin_dash_last'
