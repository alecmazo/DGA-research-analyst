"""GuruFocus-style 3-year unfilled forecast bars on the Financials revenue card."""
from pathlib import Path

import market_data as md

ROOT = Path(__file__).resolve().parents[1]


def test_fwd_annuals_three_years_and_synth():
    out = md.fwd_annuals_from_estimates(
        {"0y": 110e9, "+1y": 121e9},
        {"0y": 6.0, "+1y": 6.6},
        last_fy=2025,
        last_rev=100e9,
        last_ni=20e9,
        last_ebitda=30e9,
        shares=15e9,
        today_year=2026,
        next_earnings_date="2026-11-16",
    )
    pts = out["points"]
    assert len(pts) == 3
    assert [p["label"] for p in pts] == ["FY2026", "FY2027", "FY2028"]
    assert all(p["forecast"] is True for p in pts)
    assert abs(pts[0]["revenue"] - 110e9) < 1
    assert abs(pts[1]["revenue"] - 121e9) < 1
    # +2y synthesized at 0y→+1y growth (10%)
    assert abs(pts[2]["revenue"] - 133.1e9) < 1e6
    assert abs(pts[0]["net_income"] - 6.0 * 15e9) < 1
    assert abs(pts[0]["ebitda"] - 110e9 * 0.30) < 1
    assert out["next_earnings_date"] == "2026-11-16"


def test_fwd_skips_0y_when_last_fy_is_current_year():
    out = md.fwd_annuals_from_estimates(
        {"0y": 100e9, "+1y": 110e9},
        None,
        last_fy=2026,
        last_rev=100e9,
        last_ni=20e9,
        last_ebitda=30e9,
        shares=1e9,
        today_year=2026,
    )
    pts = out["points"]
    assert pts[0]["label"] == "FY2027"
    assert abs(pts[0]["revenue"] - 110e9) < 1
    assert len(pts) == 3


def test_fwd_empty_without_estimates():
    out = md.fwd_annuals_from_estimates(
        {},
        {},
        last_fy=2025,
        last_rev=100e9,
        today_year=2026,
    )
    assert out["points"] == []


def test_fwd_scales_millions_to_dollars():
    out = md.fwd_annuals_from_estimates(
        {"0y": 110_000.0, "+1y": 121_000.0},  # millions
        None,
        last_fy=2025,
        last_rev=100e9,
        last_ni=20e9,
        last_ebitda=30e9,
        shares=1e9,
        today_year=2026,
    )
    assert abs(out["points"][0]["revenue"] - 110e9) < 1


def test_yahoo_fwd_if_cached_does_not_hit_network():
    import time
    src = Path(md.__file__).read_text(encoding="utf-8")
    fn = src.split("def yahoo_fwd_if_cached")[1].split("\ndef ")[0]
    assert "_yahoo_fwd_raw" not in fn
    assert "_FWD_ANN_RAW_CACHE" in fn
    md._FWD_ANN_RAW_CACHE.pop("ZZZZ", None)
    assert md.yahoo_fwd_if_cached("ZZZZ", last_fy=2024, last_rev=9) is None
    md._FWD_ANN_RAW_CACHE["ZZZZ"] = (
        time.time(),
        {"rev": {"0y": 10.0}, "eps": {}, "next_earnings_date": "2026-08-01"},
    )
    try:
        out = md.yahoo_fwd_if_cached(
            "ZZZZ", last_fy=2024, last_rev=9, last_ni=1, last_ebitda=2, shares=1,
        )
        assert out is not None
        assert out["points"]
        assert out["next_earnings_date"] == "2026-08-01"
    finally:
        md._FWD_ANN_RAW_CACHE.pop("ZZZZ", None)


def test_fin_rows_all_read_fills_annual_and_quarter_cache():
    from api.domains import financials_series as fs
    fs._FIN_ROWS_CACHE.clear()
    annual = {"period_type": "annual", "fy": 2025, "period_end": "2025-09-27", "revenue": 100}
    quarter = {"period_type": "quarter", "fy": 2026, "period_end": "2026-06-27", "revenue": 20}
    fs._fin_rows_cache_put("AAPL", "all", [quarter, annual])
    fs._fin_rows_cache_put("AAPL", "annual", fs._fin_dedupe_annual_rows([annual]))
    fs._fin_rows_cache_put("AAPL", "quarter", [quarter])
    assert fs._fin_rows_for_ticker("AAPL", "annual")[0]["revenue"] == 100
    assert fs._fin_rows_for_ticker("AAPL", "quarter")[0]["period_type"] == "quarter"
    fs._fin_rows_cache_drop("AAPL")
    assert fs._fin_rows_cache_get("AAPL", "all") is None


def test_dashboard_appends_forecast_points():
    body = (ROOT / "api/domains/_financials_body.py").read_text(encoding="utf-8")
    assert "yahoo_fwd_annuals" in body
    assert '"forecast": True' in body
    assert '"next_earnings_date": next_earnings_date' in body
    dash = body[body.find("def financials_dashboard"): body.find("def financials_dashboard") + 400]
    assert "no LLM" in dash.lower() or "No LLM" in dash


def test_fundcharts_hollow_forecast_bars():
    src = (ROOT / "web/gp-app/src/pages/financials/FundCharts.tsx").read_text(
        encoding="utf-8",
    )
    assert "hollow" in src
    assert "{s.name} Forecast" in src
    assert "Next Earnings Date" in src
    assert "chartSwatchHollow" in src
    assert "fill={isHollow ? 'none' : col}" in src
    assert "function yearLines" in src
    assert "showYear" in src
    assert "fontSize={21}" in src
    css = (ROOT / "web/gp-app/src/pages/FinancialsPage.module.css").read_text(
        encoding="utf-8",
    )
    assert "repeat(12, minmax(0, 1fr))" in css
    assert "grid-column: span 3" in css
    assert "grid-column: span 4" not in css
    assert "nth-child(n + 5)" not in css
    title = css[css.find(".chartTitle"): css.find(".chartTitle") + 180]
    assert "font-size: 14px" in title
    dash = (ROOT / "web/gp-app/src/pages/financials/CompanyDashboard.tsx").read_text(
        encoding="utf-8",
    )
    assert "nextEarningsDate={dash.next_earnings_date}" in dash
    assert "trailing={valueCard}" in dash
    assert "<PriceChart ticker={dash.ticker || ticker} compact />" in dash
    assert "price_change_pct" in dash
