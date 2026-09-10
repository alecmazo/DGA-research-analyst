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
