"""GuruFocus desk + valuation-bridge UI contracts."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _fn_src(name: str) -> str:
    text = (ROOT / "api" / "server.py").read_text()
    needle = name if name.startswith("def ") else f"def {name}"
    start = text.index(needle)
    nxt = text.find("\ndef ", start + 1)
    return text[start:nxt]


def test_financials_open_in_new_tab():
    nav = (ROOT / "web/gp-app/src/lib/financialsNav.ts").read_text()
    assert "window.open" in nav
    assert "_blank" in nav
    assert "/gp/financials?ticker=" in nav
    builder = (ROOT / "web/gp-app/src/pages/BuilderPage.tsx").read_text()
    assert "openFinancialsPage" in builder
    assert "navigate(`/financials?ticker=" not in builder
    peek = (ROOT / "web/gp-app/src/components/layout/StockPeek.tsx").read_text()
    assert "openFinancialsPage" in peek
    assert "navigate(`/financials?ticker=" not in peek


def test_gf_watchlist_dropdown_and_compact_rows():
    tsx = (ROOT / "web/gp-app/src/pages/builder/GuruFocusTab.tsx").read_text()
    assert 'aria-label="Select watchlist"' in tsx
    assert "<select" in tsx
    css = (ROOT / "web/gp-app/src/pages/builder/GuruFocusTab.module.css").read_text()
    assert ".picker" in css
    td = css.split(".table td", 1)[1].split("}", 1)[0]
    assert "3px 6px" in td
    note = css.split(".editNote", 1)[1].split("}", 1)[0]
    assert "22px" in note


def test_split_perf_uses_adj_history():
    body = _fn_src("_gf_apply_split_perf")
    assert "_adj_closes_on_dates" in body
    assert "pct_since_first" in body
    assert "ann_gain" in body
    assert "rel_spy" in body
    get = _fn_src("builder_gurufocus_list(")
    assert "_gf_apply_split_perf" in get
    close = _fn_src("_builder_close_on_or_before")
    assert "price_history" in close
    assert 'yahoo_history(tku, "max")' in close
    assert 'yahoo_history(tku, "1y")' not in close


def test_tsla_snapshot_date_is_pre_split():
    import json
    data = json.loads((ROOT / "api/data/gurufocus_watchlists.json").read_text())
    tech = next(x for x in data["lists"] if x["name"] == "tech")
    tsla = next(s for s in tech["stocks"] if s["symbol"] == "TSLA")
    assert tsla["date_first_added"] <= "2020-08-31"
    # Snapshot cost is not split-adjusted vs 2018; live overlay must recompute.
    assert tsla["cost_per_share"] > 100


def test_valuation_bridge_window_wired():
    page = (ROOT / "web/gp-app/src/pages/ValuationBridgePage.tsx").read_text()
    assert "openValuationWindow" in page
    assert "DCF User" in page
    assert "FCF multiple" in page
    app = (ROOT / "web/gp-app/src/App.tsx").read_text()
    assert "path=\"valuation\"" in app
    saved = (ROOT / "web/gp-app/src/components/desk/SavedReports.tsx").read_text()
    assert "openValuationWindow" in saved
    pulse = (ROOT / "web/gp-app/src/components/desk/MarketPulse.tsx").read_text()
    assert "openValuationWindow" in pulse
    api = (ROOT / "api" / "server.py").read_text()
    assert "/api/reports/{ticker}/valuation" in api
    assert "/api/reports/{ticker}/dcf-user" in api
    xls = (ROOT / "excel_model.py").read_text()
    assert "DCF USER" in xls
    assert "FCF multiple" in xls


def test_pulse_three_chips_dcf_comps_street():
    pulse = (ROOT / "web/gp-app/src/components/desk/MarketPulse.tsx").read_text()
    assert "function pulseChips" in pulse
    assert "kind: 'dcf'" in pulse
    assert "kind: 'comps'" in pulse
    assert "kind: 'street'" in pulse
    assert "openCompsWindow" in pulse
    assert "openValuationWindow" in pulse
    assert ".slice(0, 6)" not in pulse
    assert "HIDE_CHIP_IDS" not in pulse
    assert "dcf_user" in pulse
    assert "approachChips" not in pulse
    app = (ROOT / "web/gp-app/src/App.tsx").read_text()
    assert 'path="comps"' in app
    comps = (ROOT / "web/gp-app/src/pages/CompsPage.tsx").read_text()
    assert "openCompsWindow" in comps
    assert "/api/financials/" in comps and "/comps" in comps
    assert "n/a" in comps
    assert "EV/EBITDA" in comps
    assert "P/S" in comps
    assert "EBITDA margin" in comps
    body = (ROOT / "api/domains/_financials_body.py").read_text()
    assert '/api/financials/{ticker}/comps' in body
    assert "research_comps" in body
    assert "def financials_comps" in body


def test_pulse_windows_support_export_and_stats():
    val = (ROOT / "web/gp-app/src/pages/ValuationBridgePage.tsx").read_text()
    comps = (ROOT / "web/gp-app/src/pages/CompsPage.tsx").read_text()
    chrome = (ROOT / "web/gp-app/src/components/desk/WindowChrome.tsx").read_text()
    for src in (val, comps):
        assert "SupportFab" in src
        assert "WindowExportMenu" in src
        assert "TickerStatsLine" in src
        assert "window.print" in src
        assert "/api/desk/window-email" in src
    assert "Print PDF" in chrome
    assert "Excel" in chrome
    assert "Email" in chrome
    assert "Mkt cap" in chrome
    assert "EV/EBITDA" in chrome
    api = (ROOT / "api" / "server.py").read_text()
    assert "/api/reports/{ticker}/valuation.xlsx" in api
    assert "/api/financials/{ticker}/comps.xlsx" in api
    assert "/api/desk/window-email" in api
    assert "A valid recipient email is required" in api
