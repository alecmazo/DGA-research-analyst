export type OverviewFund = {
  fund_id: string
  fund_name?: string
  short_name?: string
  effective_nav?: number | null
  fund_nav?: number | null
  fund_nav_as_of?: string | null
  market_nav?: number | null
  lp_count?: number
  commitment?: number | null
  status?: string
}

export type OverviewAcct = {
  fund_id: string
  account_name?: string
  short_name?: string
  nav?: number | null
  nav_as_of?: string | null
  market_nav?: number | null
  ytd_pos_pct?: number | null
  ytd_pct?: number | null
  status?: string
}

export type FundOverview = {
  funds?: OverviewFund[]
  managed_accounts?: OverviewAcct[]
}

export type FundDetail = {
  fund_id?: string
  fund_name?: string
  short_name?: string
  fund_type?: string
  status?: string
  nav?: number | null
  market_nav?: number | null
  nav_as_of?: string | null
  lp_count?: number
  total_committed?: number
  inception_date?: string | null
  mgmt_fee_pct?: number | null
  carry_pct?: number | null
  hurdle_pct?: number | null
  lps?: Array<{
    legal_name?: string
    primary_email?: string
    commitment_amount?: number
    name?: string
    committed?: number
    ownership_pct?: number
  }>
}

export type FundPosition = {
  symbol?: string
  name?: string
  asset_class?: string
  total_qty?: number
  avg_cost?: number | null
  last_price?: number | null
  market_value?: number | null
  unrealized_gain?: number | null
  market_weight_pct?: number | null
  weight_pct?: number | null
}

export type Waterfall = {
  high_watermark?: number | null
  hurdle_cleared?: boolean | null
  gp_accrued_carry?: number | null
  gp_equity_pct?: number | null
  lp_nav_after_carry?: number | null
  data_source_warning?: string
  annual_snapshots?: Array<{
    year?: number
    start_nav?: number
    end_nav?: number
    gross_profit?: number
    hwm_threshold?: number
    hurdle_amount?: number
    carry_earned?: number
    gp_equity_end?: number
    accum_gp_pct?: number
  }>
  per_lp?: Array<{
    legal_name?: string
    commitment?: number
    share_pct?: number
    carry_charge?: number
    nav_after_carry?: number
  }>
}

export type AttributionRow = {
  ticker?: string
  end_shares?: number | null
  jan1_price?: number | null
  end_price?: number | null
  dollar_gain?: number | null
  ticker_return_pct?: number | null
  contribution_pct?: number | null
  closed?: boolean
  predecessor?: boolean
  origin_transfer?: boolean
  origin_buy?: boolean
}

export type CashFlow = {
  date?: string
  action?: string
  type?: string
  symbol?: string
  ticker?: string
  amount?: number | null
}

export type MonthlyChartPoint = {
  label?: string
  month?: string | number
  end_balance?: number | null
  return_pct?: number | null
  beg_balance?: number | null
  spy_ytd_pct?: number | null
  skip?: boolean
  deposits?: number
  withdrawals?: number
  dividends?: number
  cash_only_balance?: number | null
  movers?: Array<{ ticker?: string; contrib?: number }>
  perf_detail?: Record<string, number>
}

export type YtdResult = {
  twrr_return_pct?: number | null
  md_return_pct?: number | null
  xirr_return_pct?: number | null
  xirr_note?: string
  attribution?: AttributionRow[]
  attribution_contrib_sum?: number | null
  attribution_estimated?: boolean
  flows?: CashFlow[]
  spy_monthly?: { points?: Array<{ ytd_pct?: number; month?: string }> }
  monthly_chart?: {
    monthly?: MonthlyChartPoint[]
  }
  ytd_beg_balance?: number
  begin_value?: number
  ytd_total_deposits?: number
  ytd_total_withdrawals?: number
}

export type BalanceHistoryAnnual = {
  year?: number
  label?: string
  return_pct?: number | null
  beg_balance?: number | null
  end_balance?: number | null
  deposits?: number
  withdrawals?: number
  data_months?: number
  benchmark_return_pct?: number | null
  return_source?: string
  inception_month?: number
  cash_only_balance?: number | null
}

export type BalanceHistoryPoint = {
  label?: string
  year?: number
  return_pct?: number | null
  end_balance?: number | null
  beg_balance?: number | null
  cash_only_balance?: number | null
  deposits?: number
  withdrawals?: number
  dividends?: number
  skip?: boolean
  data_months?: number
  benchmark_return_pct?: number | null
}

export type BalanceHistory = {
  ok?: boolean
  monthly?: BalanceHistoryPoint[]
  quarterly?: BalanceHistoryPoint[]
  annual?: BalanceHistoryAnnual[]
  benchmark_key?: string
  benchmark_label?: string
  period?: string
}

export type YtdCache = {
  result_json?: YtdResult | string | null
  ytd_pct?: number | null
}

export type RebalanceRow = {
  ticker?: string
  rating?: string
  upside_pct?: number | null
  price_target?: number | null
  target_provider?: string | null
  price?: number | null
  current_pct?: number
  suggested_pct?: number
  shares_delta?: number | null
  score?: number
}

export type RebalanceResult = {
  ok?: boolean
  rows?: RebalanceRow[]
  run_at?: string
  current_ev?: number
  suggested_ev?: number
  equity_count?: number
  detail?: string
}
