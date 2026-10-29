"""Compact cards for a 10-name book built from saved local notes.

The browser sends these cards to Ollama on this Mac, six names at a time.
The full report never leaves the server in this response.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

CHUNK = 6
SUGGESTED_MODEL = "gemma4:26b"
SUGGESTED_WHY = (
    "Gemma 26B is the model for this card. The job is ten names, weights, "
    "risk against reward, and a 12-month path. It holds that comparison in one answer. "
    "GPT-oss writes a single equity note better. Gemma 12B is the faster screen when "
    "26B is not installed. Each pass reads six saved notes, then the book is written "
    "from the short list and today's prices."
)

_THESIS = re.compile(
    r"^\s{0,3}#{1,4}\s*(?:section\s+)?(?:\d+(?:\.\d+)?[\.\)\s—–-]*)?"
    r"(investment\s+thesis|thesis|executive\s+summary|investment\s+summary|"
    r"why\s+(?:own|buy|this)|bull\s+case)\b",
    re.I,
)
_RISK = re.compile(
    r"^\s{0,3}#{1,4}\s*(?:section\s+)?(?:\d+(?:\.\d+)?[\.\)\s—–-]*)?"
    r"(risks?|key\s+risks|what\s+can\s+go\s+wrong)\b",
    re.I,
)


def _num(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _excerpt(md: str, header: re.Pattern, limit: int) -> str:
    body: list[str] = []
    capturing = False
    for line in (md or "").split("\n"):
        if header.match(line):
            capturing = True
            body = []
            continue
        if not capturing:
            continue
        if re.match(r"^\s{0,3}#{1,4}\s+\S", line):
            break
        text = line.strip()
        if not text or text.startswith("|") or text.startswith("---"):
            continue
        body.append(text)
        if sum(len(part) for part in body) >= limit:
            break
    return " ".join(body)[:limit].strip()


def _money(value) -> str:
    number = _num(value)
    if number is None:
        return "n/a"
    if abs(number) >= 100:
        return f"${number:.0f}"
    return f"${number:.2f}"


def _pct(value) -> str:
    number = _num(value)
    if number is None:
        return "n/a"
    return f"{number:+.1f}%"


def live_upside(target, price):
    """Upside of the saved target against the price on this run."""
    target_n = _num(target)
    price_n = _num(price)
    if target_n is None or price_n in (None, 0):
        return None
    return round((target_n - price_n) / abs(price_n) * 100.0, 1)


def one_card(ticker: str, view: dict, quote: dict | None) -> dict | None:
    """One saved local note, with the price refreshed for this run."""
    text = (view.get("report_md") or "").strip()
    if len(text) < 40:
        return None
    quote = quote or {}
    target = _num(view.get("price_target"))
    note_price = _num(view.get("current_price"))
    live = _num(quote.get("price"))
    price = live if live is not None else note_price
    upside = live_upside(target, price)
    if upside is None:
        upside = _num(view.get("upside_pct"))
    thesis = _excerpt(text, _THESIS, 280)
    risk = _excerpt(text, _RISK, 180)
    generated = view.get("generated_at")
    if hasattr(generated, "isoformat"):
        generated = generated.isoformat()
    card = {
        "ticker": (ticker or "").strip().upper(),
        "model": (view.get("model") or "").strip(),
        "generated_at": str(generated or "") or None,
        "rating": view.get("rating") or None,
        "price_target": target,
        "note_price": note_price,
        "live_price": live,
        "live_pct": _num(quote.get("pct_change")),
        "upside_pct": upside,
        "style": (view.get("style") or "").strip() or None,
        "thesis": thesis,
        "risk": risk,
    }
    card["line"] = card_line(card)
    return card


def card_line(card: dict) -> str:
    """One block the local model can read. No appendix, no filing tables."""
    price = card.get("live_price")
    price_bit = _money(price) if price is not None else _money(card.get("note_price"))
    source = "live" if price is not None else "price in the note"
    day = _pct(card.get("live_pct")) if card.get("live_pct") is not None else "day n/a"
    parts = [
        f"{card.get('ticker')} | {card.get('model') or 'local'} | note {card.get('generated_at') or 'undated'}",
        (
            f"price {price_bit} ({source}, day {day}) | "
            f"rating {card.get('rating') or 'n/a'} | "
            f"12m target {_money(card.get('price_target'))} | "
            f"upside vs that price {_pct(card.get('upside_pct'))}"
        ),
    ]
    if card.get("style"):
        parts.append(f"style {card['style']}")
    if card.get("thesis"):
        parts.append(f"thesis: {card['thesis']}")
    if card.get("risk"):
        parts.append(f"risk: {card['risk']}")
    return "\n".join(parts)


def book_payload(cards: list[dict], *, quoted_at: str | None = None) -> dict:
    ordered = sorted(cards, key=lambda card: card.get("ticker") or "")
    when = quoted_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "ok": True,
        "as_of": when,
        "count": len(ordered),
        "chunk": CHUNK,
        "suggested_model": SUGGESTED_MODEL,
        "suggested_why": SUGGESTED_WHY,
        "cards": ordered,
    }
