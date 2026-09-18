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
    assert "await loadQuotes()" in fn
    assert "await Promise.all" not in fn
    assert "getLatestDailyBrief" in fn
    assert "getLatestScan" in fn
