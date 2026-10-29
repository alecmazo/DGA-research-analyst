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
    assert "fontSize={25}" in src
    css = (ROOT / "web/gp-app/src/pages/FinancialsPage.module.css").read_text(
        encoding="utf-8",
    )
    assert "minmax(min(230px, 100%), 230px)" in css
    title = css[css.find(".chartTitle"): css.find(".chartTitle") + 180]
    assert "font-size: 13px" in title
    dash = (ROOT / "web/gp-app/src/pages/financials/CompanyDashboard.tsx").read_text(
        encoding="utf-8",
    )
    assert "nextEarningsDate={dash.next_earnings_date}" in dash
