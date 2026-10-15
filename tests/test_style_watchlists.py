"""Report style pills land on Growth / Value / Rich Builder watchlists."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _fn_src(path: Path, name: str) -> str:
    src = path.read_text(encoding="utf-8")
    start = src.find(f"def {name}")
    assert start >= 0, name
    nxt = src.find("\ndef ", start + 4)
    return src[start:nxt if nxt >= 0 else start + 8000]


def test_stamp_places_style_watchlists():
    fn = _fn_src(ROOT / "api/server.py", "_stamp_stock_style")
    assert "_place_ticker_on_style_watchlists_all" in fn


def test_local_save_stamps_style():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    fn = _fn_src(ROOT / "api/server.py", "local_save_report")
    assert "_persist_analysis_text" in fn
    assert "_stamp_stock_style(ticker, md_text, summary)" in src
    assert "_place_ticker_on_style_watchlists_all" in src


def test_style_boards_are_named_growth_value_rich():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    assert '_STYLE_WATCHLIST_SOURCE = "stock_style"' in src
    assert '("Value", "Report style VALUE / GARP"' in src
    assert '("Growth", "Report style GROWTH / GARP"' in src
    assert '("Rich", "Report style RICH"' in src


def test_get_lists_ensures_style_boards_without_scoring_universe():
    fn = _fn_src(ROOT / "api/server.py", "builder_lists_get")
    assert "_ensure_style_watchlists" in fn
    assert "_kick_style_watchlist_backfill" in fn
    assert "_builder_sync_dcf_value_board" not in fn
    assert "_builder_sync_dga_scored_board" not in fn
    assert "_dga_score_universe(" not in fn
    backfill = _fn_src(ROOT / "api/server.py", "_backfill_style_watchlists")
    assert "report_md" not in backfill
    assert "stock_style" in backfill
