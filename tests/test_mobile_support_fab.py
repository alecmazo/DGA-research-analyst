"""GP mobile must expose the same support FAB as LP so Alec can file tickets."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_gp_tabs_include_support_fab():
    app = (ROOT / "mobile" / "App.js").read_text(encoding="utf-8")
    assert "function GPTabs" in app
    gp = app.split("function GPTabs")[1].split("function LPTabs")[0]
    assert "<SupportFab" in gp
    assert "mobile-gp/" in gp
    lp = app.split("function LPTabs")[1].split("function applyPendingUpdate")[0]
    assert "<SupportFab" in lp


def test_support_fab_posts_tickets():
    fab = (ROOT / "mobile" / "src" / "components" / "SupportFab.js").read_text(
        encoding="utf-8"
    )
    assert "fileSupportTicket" in fab
    assert "screenshot_b64" in fab
    assert "help-buoy" in fab
    client = (ROOT / "mobile" / "src" / "api" / "client.js").read_text(encoding="utf-8")
    assert "fileSupportTicket" in client
    assert "/api/support/tickets" in client


def test_markets_does_not_block_on_brief():
    src = (ROOT / "mobile" / "src" / "screens" / "MarketsScreen.js").read_text(
        encoding="utf-8"
    )
    fn = src.split("const loadAll")[1].split("useFocusEffect")[0]
    assert "await loadQuotes({ ideas: true })" in fn
    assert "await Promise.all" not in fn
    assert "getLatestDailyBrief" in fn
    assert "getLatestScan" in fn


def test_markets_uses_mobile_home_and_skips_idea_feed_on_poll():
    src = (ROOT / "mobile" / "src" / "screens" / "MarketsScreen.js").read_text(
        encoding="utf-8"
    )
    assert "getMobileHome" in src
    assert "QUOTE_POLL_MS = 60_000" in src
    poll = src.split("pollRef.current = setInterval")[1].split("QUOTE_POLL_MS")[0]
    assert "loadQuotes({ ideas: false })" in poll
    assert "getIdeaFeed" not in poll


def test_research_does_not_batch_quote_all_reports():
    src = (ROOT / "mobile" / "src" / "screens" / "HomeScreen.js").read_text(
        encoding="utf-8"
    )
    assert "getBatchQuotes" not in src
    assert "peekWatchlist" in src


def test_ota_cold_start_never_reloads():
    app = (ROOT / "mobile" / "App.js").read_text(encoding="utf-8")
    cold = app.split("if (reason === 'cold-start')")[1].split("if (now - _otaLastCheckMs")[0]
    assert "fetchOtaOnly" in cold
    assert "reloadAsync" not in cold
    assert "applyPendingUpdate" not in cold
    assert "checkForOtaUpdate('cold-start')" in app
    settings = (ROOT / "mobile" / "src" / "screens" / "SettingsScreen.js").read_text(
        encoding="utf-8"
    )
    assert "APP_BUILD = 'mobile-ui31-fast-20260918'" in settings


def test_positions_and_financials_paint_from_cache():
    pos = (ROOT / "mobile" / "src" / "screens" / "WatchlistScreen.js").read_text(
        encoding="utf-8"
    )
    assert "POS_DATA_KEY" in pos
    assert "commitPositions" in pos
    assert "paintedRef" in pos
    fin = (ROOT / "mobile" / "src" / "screens" / "FinancialsScreen.js").read_text(
        encoding="utf-8"
    )
    assert "@dga_fin_dash_" in fin
    assert "LAST_KEY" in fin
    client = (ROOT / "mobile" / "src" / "api" / "client.js").read_text(encoding="utf-8")
    assert "getMobileHome" in client
    assert "/api/mobile/home" in client
