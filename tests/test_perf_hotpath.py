"""Hot-path performance contracts — no live Railway, no full-store walk."""
from __future__ import annotations

import ast
import inspect
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _fn_src(path: Path, name: str) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.AsyncFunctionDef) and node.name == name:
            return ast.get_source_segment(path.read_text(encoding="utf-8"), node) or ""
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(path.read_text(encoding="utf-8"), node) or ""
    raise AssertionError(f"{name} not found in {path}")


def test_health_and_build_are_async():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    kinds = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in (
            "health", "build_version",
        ):
            kinds[node.name] = type(node).__name__
    assert kinds.get("health") == "AsyncFunctionDef", kinds
    assert kinds.get("build_version") == "AsyncFunctionDef", kinds


def test_list_reports_sql_skips_valuation_json():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    fn = _fn_src(ROOT / "api/server.py", "list_reports")
    # The list SELECT must not detoast valuation_approaches JSONB.
    assert "FROM analyst_reports" in fn
    sel = fn.split("FROM analyst_reports")[0]
    assert "valuation_approaches," not in sel
    assert "dcf_user_fcf" not in sel
    assert "excel_model" not in fn
    assert "_batch_quotes_fast" not in fn
    assert "yf.Ticker" not in fn
    fill = _fn_src(ROOT / "api/server.py", "_reports_attach_store_prices")
    assert "_db_quotes(want, max_age_s=5 * 86400)" in fill
    assert "_quote_from_current_session" in fill
    assert "_batch_quotes_fast" not in fill
    assert "_reports_attach_store_prices(out)" in fn
    assert 'WEB_BUILD_VERSION = "ui731-20261008-city-view"' in src


def test_positions_use_newest_print_not_yahoo():
    fn = _fn_src(ROOT / "api/server.py", "lp_me_positions")
    fill = _fn_src(ROOT / "api/server.py", "_positions_quote_book")
    marks = _fn_src(ROOT / "api/server.py", "_positions_snap_marks")
    assert "_positions_quote_book(" in fn
    assert "_positions_snap_marks(" in fn
    assert "batch_quotes(" not in fn
    assert "yf.Ticker" not in fn
    assert "LIKE" not in marks.split("cur.execute", 1)[1]
    assert "holdings_json" in marks
    assert "_resolve_ticker_alias" in fill
    assert "_quote_from_current_session" in fill
    assert "_db_quotes(want, max_age_s=None)" in fill
    assert "batch_quotes(" not in fill
    assert "Cache-Control" in _fn_src(ROOT / "api/server.py", "_positions_json")


def test_watchlist_has_sub_2s_paint_wall():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    start = src.find("def watchlist_get")
    chunk = src[start : start + 8000]
    assert "_WL_PAINT_S = 1.2" in chunk
    assert "budget_s=2.0" not in chunk


def test_financials_settings_cached():
    body = (ROOT / "api/domains/_financials_body.py").read_text(encoding="utf-8")
    assert "_FIN_SETTINGS_CACHE" in body
    assert "_FIN_SETTINGS_TTL_S" in body


def test_builder_lists_get_does_not_block_on_named_board_sync():
    fn = _fn_src(ROOT / "api/server.py", "builder_lists_get")
    assert "_kick_builder_named_board_refresh" not in fn
    assert "_builder_sync_dcf_value_board" not in fn
    assert "_builder_sync_dga_scored_board" not in fn


def test_builder_board_get_skips_dcf_rebuild():
    fn = _fn_src(ROOT / "api/server.py", "builder_list_board_get")
    assert "_builder_sync_dcf_value_board" not in fn
    assert "_builder_list_board" in fn


def test_builder_board_quotes_fill_blanks():
    fn = _fn_src(ROOT / "api/server.py", "_builder_board_quotes")
    assert "_db_quotes(misses)" in fn
    assert "max_age_s=4 * 86400" not in fn
    assert "_batch_quotes_fast" in fn


def test_builder_candidates_sql_skips_report_md():
    fn = _fn_src(ROOT / "api/server.py", "_builder_fetch_candidates")
    assert "SELECT ticker, report_md" not in fn
    assert 'r.get("report_md")' not in fn
    assert "_BUILDER_COMPS_CACHE" in fn


def test_gurus_fill_skips_network_on_get():
    src = (ROOT / "api/domains/gurus.py").read_text(encoding="utf-8")
    assert "allow_network: bool = False" in src
    assert "if still and allow_network:" in src
    assert "_GURUS_LIST_TTL_S" in src
    book = _fn_src(ROOT / "api/domains/gurus.py", "_book_hist")
    assert "GROUP BY portdate" in book


def test_fin_dashboard_hot_path_is_store_only():
    body = (ROOT / "api/domains/_financials_body.py").read_text(encoding="utf-8")
    assert "_FIN_DASH_TTL_S = 600" in body
    dash = body.split("def financials_dashboard")[1].split("def _vl_f")[0]
    assert "_fin_recent_earnings_8k(" not in dash
    peers = body.split("def _build_peer_comps")[1].split("def financials_dashboard")[0]
    assert "_warm_quotes_for_comps" not in peers
    assert "_db_quotes(quote_syms)" in peers


def test_builder_page_does_not_prefetch_all_boards():
    src = (ROOT / "web/gp-app/src/pages/BuilderPage.tsx").read_text(encoding="utf-8")
    assert "workers = 3" not in src
    assert "fetchBoard(active, false)" in src


def test_gurus_page_paints_summary_before_history():
    src = (ROOT / "web/gp-app/src/pages/GurusPage.tsx").read_text(encoding="utf-8")
    load = src.split("const loadGuru")[1].split("useEffect")[0]
    assert "setSum(s)" in load
    assert load.find("setSum(s)") < load.find("/activity")
    assert load.find("setLoading(false)") < load.find("/history")


def test_market_indices_never_loops_yfinance_tickers():
    fn = _fn_src(ROOT / "api/server.py", "market_indices")
    assert "yf.Ticker" not in fn
    assert "_db_quotes" in fn
    assert "_batch_quotes_fast" in fn
    assert "_INDICES_TTL" in fn
    assert "_INDEX_ALIASES" in fn


def test_mobile_home_is_cheap_bootstrap():
    fn = _fn_src(ROOT / "api/server.py", "mobile_home")
    body = fn.split('"""', 2)[-1]
    assert "market_indices(store_only=True)" in body
    assert "_MOBILE_HOME_CACHE" in body
    assert "watchlist_get(" in body
    assert "fresh=False" in body
    assert "lite=True" in body
    wl = _fn_src(ROOT / "api/server.py", "watchlist_get")
    assert "if need and (not lite)" in wl
    rep = _fn_src(ROOT / "api/server.py", "get_report")
    assert "as_stored" in rep
    assert "if not as_stored" in rep
    assert "get_idea" not in body.lower()
    assert "daily_brief" not in body.lower()
    assert "latest_scan" not in body.lower()
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    assert 'WEB_BUILD_VERSION = "ui731-20261008-city-view"' in src
    assert "if (not lite) and _wl_left()" in wl


def test_mobile_fund_bars_have_yaxis():
    src = (ROOT / "mobile/src/screens/FinancialsScreen.js").read_text(encoding="utf-8")
    mini = src.split("function MiniBars")[1].split("function FundChart")[0]
    assert "axisW" in mini
    assert "ticks" in mini
    assert "fmt" in mini
    assert "<MiniBars series={series} width={width} height={72} t={t} fmt={fmt} />" in src
