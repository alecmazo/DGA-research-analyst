"""Portfolio Ship. The live book paints the vessel. The sea follows the S&P.

+2% on the S&P 500, or better, is perfect weather. −3%, or worse, is the worst.
Between those prints the sea moves in a straight line. A missing print is the
flat-day sea (the same picture as a 0% day) and is marked unknown.

This does not write portfolio rows, and it does not call the SEC. Story groups
live here. GICS classification stays in portfolio_classify.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request

from api.domains.portfolio_city import decide_privacy
from api.domains.portfolio_classify import (
    CASH_SYMBOLS,
    GSE_COMMONS,
    GSE_SYMBOLS,
    classify,
    normalize_symbol,
)

# Money-market symbols already priced at par in the positions book.
CASH_PART = CASH_SYMBOLS | frozenset({
    "FDRXX", "FDLXX", "FZFXX", "SPRXX", "VMFXX", "CASH", "USD", "FCASH",
})
TECH_CORE = frozenset({"TSLA", "META", "AMZN"})
STERN = frozenset({"IBRX"}) | GSE_SYMBOLS | frozenset(GSE_COMMONS)

PERFECT_PCT = 2.0
WORST_PCT = -3.0

# Draw big plates first so the small ones stay on top.
DRAW_ORDER = (
    "keel",
    "engine",
    "cargo",
    "bow",
    "stern",
    "midship",
    "bridge",
    "mast",
    "deck",
    "hull",
    "anchor",
    "cabins",
)

PARTS: dict[str, dict[str, str]] = {
    "bridge": {
        "id": "tech",
        "name": "Technology (core)",
        "color": "#5b8cff",
        "rationale": "The helm. These names steer the book.",
    },
    "bow": {
        "id": "fin",
        "name": "Financials",
        "color": "#2ec4a6",
        "rationale": "The bow. The banks cut the water.",
    },
    "stern": {
        "id": "stern",
        "name": "Asymmetric bets",
        "color": "#ff7a3d",
        "rationale": "The stern. GSE names, each on its own line, and the biotech bet.",
    },
    "deck": {
        "id": "ind",
        "name": "Industrials / Aerospace",
        "color": "#f2c14e",
        "rationale": "The deck crane. Builders and networks.",
    },
    "hull": {
        "id": "hc",
        "name": "Healthcare",
        "color": "#ef5d7a",
        "rationale": "The boats. Demand that holds up in heavy water.",
    },
    "keel": {
        "id": "util",
        "name": "Utilities / Power",
        "color": "#8a6cff",
        "rationale": "The keel. Power keeps the ship upright.",
    },
    "anchor": {
        "id": "cash",
        "name": "Cash / Money market",
        "color": "#9aa7b4",
        "rationale": "The anchor. Dry powder.",
    },
    "midship": {
        "id": "mat",
        "name": "Materials",
        "color": "#c98b4a",
        "rationale": "Midship hatches. Raw materials, when the book holds them.",
    },
    "engine": {
        "id": "energy",
        "name": "Energy",
        "color": "#4a4f63",
        "rationale": "The stack. Fuel producers, when the book holds them.",
    },
    "cargo": {
        "id": "cons",
        "name": "Consumer",
        "color": "#7fc97f",
        "rationale": "The containers. Everyday spending. Bridge names stay on the bridge.",
    },
    "mast": {
        "id": "comm",
        "name": "Communication Services",
        "color": "#38b6ff",
        "rationale": "The mast. Networks other than the names on the bridge.",
    },
    "cabins": {
        "id": "re",
        "name": "Real Estate",
        "color": "#c4a882",
        "rationale": "The cabins. Property, when the book holds it.",
    },
}

SECTOR_PART = {
    "Information Technology": "bridge",
    "Communication Services": "mast",
    "Consumer Discretionary": "cargo",
    "Consumer Staples": "cargo",
    "Financials": "bow",
    "Health Care": "hull",
    "Energy": "engine",
    "Utilities": "keel",
    "Industrials": "deck",
    "Materials": "midship",
    "Real Estate": "cabins",
    "Cash": "anchor",
}


def _symbol(symbol: str | None) -> str:
    return normalize_symbol(symbol).rstrip("*")


def weather_t(pct: float | None) -> float:
    """1 at +2% or better, 0 at −3% or worse, a straight line between.

    None and NaN are the flat-day sea, the same t as a 0% print (0.6).
    """
    if pct is None:
        return 0.6
    try:
        value = float(pct)
    except (TypeError, ValueError):
        return 0.6
    if value != value:
        return 0.6
    if value >= PERFECT_PCT:
        return 1.0
    if value <= WORST_PCT:
        return 0.0
    return (value - WORST_PCT) / (PERFECT_PCT - WORST_PCT)


def part_for(symbol: str | None) -> str:
    """Story part. This is not a GICS assignment."""
    sym = _symbol(symbol)
    if not sym:
        return "deck"
    if sym in CASH_PART:
        return "anchor"
    if sym in TECH_CORE:
        return "bridge"
    if sym in STERN:
        return "stern"
    sector = classify(sym)["sector"]
    return SECTOR_PART.get(sector, "deck")


def _num(value) -> float | None:
    if value is None or value is False:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _positions_dict(response) -> dict:
    if isinstance(response, dict):
        return response
    raw = getattr(response, "body", None)
    if isinstance(raw, bytes):
        return json.loads(raw.decode() or "{}")
    if isinstance(raw, str):
        return json.loads(raw or "{}")
    return {"positions": []}


def _live_spx_pct() -> float | None:
    """Same S&P day percent the index ribbon uses. None when the print is missing."""
    try:
        from api.server import market_indices
        data = market_indices() or {}
    except Exception:
        return None
    for row in data.get("indices") or []:
        if not isinstance(row, dict):
            continue
        if row.get("symbol") != "^GSPC" and row.get("label") != "S&P 500":
            continue
        return _num(row.get("pct"))
    return None


def build_ship(book: dict | None, spx_pct: float | None, *, privacy: bool) -> dict:
    """Group the open book onto the ship. Drop a part with no weight."""
    book = book or {}
    rolled: dict[str, dict] = {}
    for row in book.get("positions") or []:
        if not isinstance(row, dict):
            continue
        sym = _symbol(row.get("symbol"))
        if not sym:
            continue
        value = _num(row.get("market_value"))
        if value is None or value <= 0:
            continue
        slot = rolled.setdefault(sym, {"symbol": sym, "name": "", "market_value": 0.0})
        slot["market_value"] += value
        name = (row.get("name") or "").strip()
        if name and not slot["name"]:
            slot["name"] = name
    total = sum(slot["market_value"] for slot in rolled.values())
    grouped: dict[str, list[dict]] = {part: [] for part in PARTS}
    for slot in rolled.values():
        weight = (slot["market_value"] / total * 100.0) if total else 0.0
        grouped[part_for(slot["symbol"])].append({
            "symbol": slot["symbol"],
            "name": slot["name"] or slot["symbol"],
            "weight_pct": round(weight, 2),
            "market_value": None if privacy else round(slot["market_value"], 2),
        })

    sectors = []
    for part in DRAW_ORDER:
        holdings = sorted(grouped[part], key=lambda item: item["weight_pct"], reverse=True)
        if not holdings:
            continue
        meta = PARTS[part]
        part_value = sum(
            slot["market_value"]
            for slot in rolled.values()
            if part_for(slot["symbol"]) == part
        )
        sectors.append({
            "id": meta["id"],
            "part": part,
            "name": meta["name"],
            "color": meta["color"],
            "weight_pct": round(part_value / total * 100.0, 2) if total else 0.0,
            "market_value": None if privacy else round(part_value, 2),
            "rationale": meta["rationale"],
            "holdings": holdings,
        })
    sectors.sort(key=lambda item: item["weight_pct"], reverse=True)

    known = spx_pct is not None and _num(spx_pct) is not None
    pct = _num(spx_pct) if known else None
    return {
        "ok": True,
        "as_of": book.get("as_of"),
        "book_as_of": book.get("book_as_of"),
        "show_dollars": not privacy,
        "total_value": None if privacy or not total else round(total, 2),
        "spx": {
            "symbol": "^GSPC",
            "label": "S&P 500",
            "change_pct": None if pct is None else round(pct, 4),
            "known": bool(known and pct is not None),
        },
        "weather": {
            "t": weather_t(pct),
            "perfect_pct": PERFECT_PCT,
            "worst_pct": WORST_PCT,
        },
        "sectors": sectors,
    }


def create_router(claims_fn, *, positions_fn=None, spx_fn=None) -> APIRouter:
    router = APIRouter(tags=["portfolio-ship"])

    @router.get("/api/v2/gp/portfolio-ship")
    def portfolio_ship(request: Request, privacy: str = "auto"):
        if privacy not in ("auto", "weights", "dollars"):
            raise HTTPException(400, "privacy must be auto, weights, or dollars")
        claims = claims_fn(request) or {}
        hide = decide_privacy(claims, privacy)
        try:
            spx = _live_spx_pct() if spx_fn is None else spx_fn()
        except Exception:
            spx = None
        spx_key = None if _num(spx) is None else round(float(spx), 2)
        if positions_fn is None:
            from api.server import _user_cache_get, _user_cache_put, lp_me_positions
            user = str(claims.get("sub") or claims.get("email") or "")
            key = ("portfolio-ship", user, "weights" if hide else "dollars", spx_key)
            cached = _user_cache_get(key)
            if cached is not None:
                return cached
            book = _positions_dict(lp_me_positions(request))
        else:
            book = _positions_dict(positions_fn(request))
            key = None
        payload = build_ship(book, _num(spx), privacy=hide)
        if positions_fn is None and key is not None:
            from api.server import _user_cache_put
            _user_cache_put(key, payload)
        return payload

    return router
