"""Mobile launch must not mount a support button, and Markets must stay cheap."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_mobile_has_no_support_button():
    app = (ROOT / "mobile" / "App.js").read_text(encoding="utf-8")
    assert "SupportFab" not in app
    assert "checkForOtaUpdate('cold-start')" not in app
    assert "initialWindowMetrics" in app
    assert "FALLBACK_METRICS" in app
    fab = ROOT / "mobile" / "src" / "components" / "SupportFab.js"
    assert not fab.exists()


def test_markets_does_not_block_on_brief():
    src = (ROOT / "mobile" / "src" / "screens" / "MarketsScreen.js").read_text(
        encoding="utf-8"
    )
    fn = src.split("const loadAll")[1].split("useFocusEffect")[0]
    assert "await loadQuotes({ ideas: false })" in fn
    assert "12000" in fn
    assert "loadBriefAndPulse" in fn
    assert "await Promise.all" not in fn
    assert "getLatestDailyBrief" in src
    assert "getLatestScan" in src


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
    assert "checkForOtaUpdate('cold-start')" not in app
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
    assert "/api/v2/lp/me/positions?_=" in pos
    assert "netStamp" in pos
    fin = (ROOT / "mobile" / "src" / "screens" / "FinancialsScreen.js").read_text(
        encoding="utf-8"
    )
    assert "@dga_fin_dash_" in fin
    assert "LAST_KEY" in fin
    client = (ROOT / "mobile" / "src" / "api" / "client.js").read_text(encoding="utf-8")
    assert "getMobileHome" in client
    assert "/api/mobile/home" in client
