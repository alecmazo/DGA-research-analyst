"""On this Mac, Compare reads frontier and local targets and theses."""
from pathlib import Path

from api.domains.report_compare_pack import build_compare_pack

ROOT = Path(__file__).resolve().parents[1]


def test_compare_pack_keeps_targets_and_thesis_excerpts():
    row = {
        "ticker": "AAPL",
        "report_md": "# Investment thesis\n\nFrontier says the multiple stays rich.\n",
        "rating": "Buy",
        "price_target": 210,
        "upside_pct": 12,
        "generated_at": "2026-10-01T00:00:00Z",
        "report_md_claude": "# Investment thesis\n\nClaude wants a faster fade in growth.\n",
        "claude_rating": "Hold",
        "claude_price_target": 190,
        "claude_upside_pct": 1,
        "report_md_local": "# Investment thesis\n\nLocal says growth is priced in.\n",
        "local_model": "gpt-oss-20b-finance",
        "local_rating": "Hold",
        "local_price_target": 180,
        "local_upside_pct": -3,
        "local_generated_at": "2026-10-26T00:00:00Z",
        "local_runs": {
            "gemma4:26b": {
                "model": "gemma4:26b",
                "report_md": "# Investment thesis\n\nGemma wants a lower multiple.\n",
                "generated_at": "2026-10-26T12:00:00Z",
                "rating": "Sell",
                "price_target": 150,
                "upside_pct": -20,
            }
        },
    }
    pack = build_compare_pack("aapl", row)
    assert pack["ticker"] == "AAPL"
    assert [side["label"] for side in pack["frontier"]] == ["Grok", "Claude"]
    assert pack["frontier"][0]["price_target"] == 210
    assert "rich" in pack["frontier"][0]["thesis"]
    assert "fade" in pack["frontier"][1]["thesis"]
    ids = [side["id"] for side in pack["local"]]
    assert "gpt-oss-20b-finance" in ids
    assert "gemma4:26b" in ids
    assert "priced in" in pack["packet"]
    assert "FRONTIER" in pack["packet"]
    assert "LOCAL" in pack["packet"]
    assert "report_md" not in pack["packet"]
    assert len(pack["packet"]) < 8000


def test_compare_card_sits_under_ask_and_lists_collapse():
    page = (ROOT / "web/gp-app/src/pages/LocalPage.tsx").read_text(encoding="utf-8")
    card = (ROOT / "web/gp-app/src/components/local/LocalCompare.tsx").read_text(encoding="utf-8")
    server = (ROOT / "api/server.py").read_text(encoding="utf-8")
    assert page.index("<h2>Ask</h2>") < page.index("<LocalCompare")
    assert page.index("<LocalCompare") < page.index("Desk saved reports")
    assert "Explain differences" in card
    assert "/api/local/compare/" in card
    assert "ollamaChat" in card
    assert '@app.get("/api/local/compare/{ticker}")' in server
