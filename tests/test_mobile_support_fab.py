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
    assert "loadDeskNews" in fn
    assert "await Promise.all" not in fn
    assert "getLatestDailyBrief" not in src
    assert "getLatestScan" not in src
    assert "startScan" not in src
    assert "getMarketPulse" in src
    assert "getMarketWire" in src
    assert "getEarningsBatch" in src
    assert "Math.abs(pct)" in src
    client = (ROOT / "mobile" / "src" / "api" / "client.js").read_text(
        encoding="utf-8"
    )
    assert "/api/market/pulse" in client
    home = (ROOT / "mobile" / "src" / "screens" / "HomeScreen.js").read_text(
        encoding="utf-8"
    )
    assert "MARKET WIRE" not in home
    assert "getEarningsBatch" not in home
    assert "loadMarketWire" not in home


def test_markets_uses_mobile_home_and_skips_idea_feed_on_poll():
    src = (ROOT / "mobile" / "src" / "screens" / "MarketsScreen.js").read_text(
        encoding="utf-8"
    )
    shared = (ROOT / "mobile" / "src" / "screens" / "marketsShared.js").read_text(
        encoding="utf-8"
    )
    assert "getMobileHome" in src
    assert "QUOTE_POLL_MS = 60_000" in shared
    assert "QUOTE_POLL_MS" in src
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
    assert "APP_BUILD = 'mobile-ui36-swipe-commit-20261028'" in settings


def test_gp_tabs_split_markets_and_watchlist():
    app = (ROOT / "mobile" / "App.js").read_text(encoding="utf-8")
    gp = app.split("function GPTabs")[1].split("function LPTabs")[0]
    assert '<Tab.Screen name="Markets"' in gp
    assert '<Tab.Screen name="Watchlist"' in gp
    assert "WatchlistBoardScreen" in gp
    assert '<Tab.Screen name="Fund"' not in gp
    assert '<Tab.Screen name="Positions"' in gp
    more = app.split("function MoreStack")[1].split("function GPTabs")[0]
    assert '<Stack.Screen name="Fund"' in more
    bar = (ROOT / "mobile" / "src" / "components" / "CustomTabBar.js").read_text(
        encoding="utf-8"
    )
    assert "Watchlist:" in bar
    more_src = (ROOT / "mobile" / "src" / "screens" / "MoreScreen.js").read_text(
        encoding="utf-8"
    )
    assert "route: 'Fund'" in more_src
    lp = app.split("function LPTabs")[1].split("function applyPendingUpdate")[0]
    assert '<Tab.Screen name="Watchlist"' not in lp
    assert '<Tab.Screen name="Positions"' in lp


def test_markets_is_index_board_watchlist_is_koyfin_rows():
    mkt = (ROOT / "mobile" / "src" / "screens" / "MarketsScreen.js").read_text(
        encoding="utf-8"
    )
    assert "paintMarketIndices" in mkt
    assert "idxGrid" in mkt
    assert "wlYtd" not in mkt
    assert "getIdeaFeed" not in mkt
    assert "navigate('Watchlist')" in mkt
    shared = (ROOT / "mobile" / "src" / "screens" / "marketsShared.js").read_text(
        encoding="utf-8"
    )
    assert "S&P 500" in shared
    assert "^GSPC" in shared
    board = (ROOT / "mobile" / "src" / "screens" / "WatchlistBoardScreen.js").read_text(
        encoding="utf-8"
    )
    assert "setPeekTk" in board
    assert "caret={false}" in board
    assert "getIdeaFeed" in board
    assert "wlYtd" not in board
    assert "companyName" in board
    poll = board.split("pollRef.current = setInterval")[1].split("QUOTE_POLL_MS")[0]
    assert "ideas: false" in poll
    assert "getIdeaFeed" not in poll


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


def test_phone_podcast_has_both_shows():
    screen = (ROOT / "mobile" / "src" / "screens" / "PodcastScreen.js").read_text(
        encoding="utf-8"
    )
    client = (ROOT / "mobile" / "src" / "api" / "client.js").read_text(encoding="utf-8")
    more = (ROOT / "mobile" / "src" / "screens" / "MoreScreen.js").read_text(encoding="utf-8")
    assert "systems-over-goals" in screen
    assert "dga-hitech" in screen
    assert "episode_guid" in screen
    assert "audio_url" in screen
    assert "resolvePodcastMediaUrl" in screen
    assert "resolvePodcastMediaUrl" in client
    assert "Systems Over Goals Daily" in more
