"""A 10-name local book reads short cards, not the full notes."""
from pathlib import Path

from api.domains.local_book import CHUNK, SUGGESTED_MODEL, book_payload, live_upside, one_card

ROOT = Path(__file__).resolve().parents[1]

NOTE = """
# Cover
| Rating | Buy |
| 12-month price target | 120 |

# Section 1 — Investment summary
The shares are cheap against the cash the business already produces.

# Section 9 — Risks
A single customer is 40 percent of revenue. If that contract is lost, the target breaks.
"""


def test_live_price_resets_upside_and_keeps_the_card_short():
    card = one_card(
        "acme",
        {
            "model": "gpt-oss-20b-finance",
            "generated_at": "2026-10-01",
            "rating": "Buy",
            "price_target": 120,
            "upside_pct": 50,
            "current_price": 80,
            "report_md": NOTE,
        },
        {"price": 100, "pct_change": 1.5},
    )
    assert card is not None
    assert card["ticker"] == "ACME"
    assert card["live_price"] == 100
    assert card["upside_pct"] == live_upside(120, 100) == 20.0
    assert "single customer" in card["risk"]
    assert "cheap against the cash" in card["thesis"]
    assert "report_md" not in card
    assert len(card["line"]) < 1200
    assert "price $100 (live" in card["line"]


def test_book_is_chunked_and_names_the_model():
    payload = book_payload([
        {"ticker": "ZZ", "line": "ZZ"},
        {"ticker": "AA", "line": "AA"},
    ])
    assert payload["chunk"] == CHUNK == 6
    assert payload["suggested_model"] == SUGGESTED_MODEL == "gemma4:26b"
    assert [card["ticker"] for card in payload["cards"]] == ["AA", "ZZ"]
    assert "12-month" in payload["suggested_why"]


def test_local_page_puts_the_book_under_compare():
    page = (ROOT / "web/gp-app/src/pages/LocalPage.tsx").read_text(encoding="utf-8")
    book = (ROOT / "web/gp-app/src/components/local/LocalBook.tsx").read_text(encoding="utf-8")
    compare_at = page.index("<LocalCompare")
    book_at = page.index("<LocalBook")
    assert compare_at >= 0 and book_at > compare_at
    assert "gemma4:26b" in book
    assert "numCtx: 8192" in book
    assert "/api/local/book" in book
    assert "Local 10" in book
    assert "chatAnswer" in book
    assert "modelThink" in book
    assert "did not write the book" not in book
    assert "The sections already written were saved." in book
    ollama = (ROOT / "web/gp-app/src/lib/localOllama.ts").read_text(encoding="utf-8")
    assert "export function chatAnswer" in ollama
    assert "opts.think === false ? false" in ollama
    server = (ROOT / "api/server.py").read_text(encoding="utf-8")
    assert '@app.get("/api/local/book")' in server
