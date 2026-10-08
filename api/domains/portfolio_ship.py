"""Portfolio Ship. The live book paints the vessel. The sea follows the S&P.

+2% on the S&P 500, or better, is perfect weather. −3%, or worse, is the worst.
Between those prints the sea moves in a straight line. A missing print is the
flat-day sea (the same picture as a 0% day) and is marked unknown.

This does not write portfolio rows, and it does not call the SEC. Story groups
live here. GICS classification stays in portfolio_classify.
"""
from __future__ import annotations

import json
import threading
import time
from urllib.parse import quote

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
# Preferreds beyond the original commons. Each symbol stays its own line.
_GSE_PREFIXES = ("FMCC", "FMCK", "FNMA", "FNMF", "FREG", "FREJ")
# Sleeves the ship draws that are not the GICS sector.
STORY_PART = {
    "UBER": "cargo",
    "NKE": "staples",
    "SPY": "market",
    "IWM": "market",
    "QQQM": "market",
    "36966TKX9": "aero",
}

PERFECT_PCT = 2.0
WORST_PCT = -3.0

# Draw big plates first so the small ones stay on top.
DRAW_ORDER = (
    "keel",
    "engine",
    "cargo",
    "staples",
    "bow",
    "stern",
    "midship",
    "bridge",
    "mast",
    "market",
    "deck",
    "aero",
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
        "name": "Industrials",
        "color": "#f2c14e",
        "rationale": "The crane. Machines, construction, and equipment.",
    },
    "aero": {
        "id": "aero",
        "name": "Aerospace",
        "color": "#d6c4ff",
        "rationale": "The gantry. Space and aerospace, off the industrial crane.",
    },
    "staples": {
        "id": "staples",
        "name": "Consumer Staples",
        "color": "#1f8a4c",
        "rationale": "The stores. Everyday brands.",
    },
    "market": {
        "id": "market",
        "name": "Index funds",
        "color": "#dfe8f2",
        "rationale": "The flag. Broad index funds, not a single industry.",
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
        "name": "Consumer Discretionary",
        "color": "#7fc97f",
        "rationale": "The deck load. Spending that can wait. Bridge names stay on the bridge.",
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
    "Consumer Staples": "staples",
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


def _is_gse(sym: str) -> bool:
    return sym in GSE_SYMBOLS or sym in GSE_COMMONS or sym.startswith(_GSE_PREFIXES)


def _is_stern(sym: str) -> bool:
    return sym in STERN or _is_gse(sym)


def part_for(symbol: str | None) -> str:
    """Story part. This is not a GICS assignment."""
    sym = _symbol(symbol)
    if not sym:
        return "deck"
    if sym in CASH_PART:
        return "anchor"
    if sym in TECH_CORE:
        return "bridge"
    if _is_stern(sym):
        return "stern"
    if sym in STORY_PART:
        return STORY_PART[sym]
    info = classify(sym)
    if info.get("archetype") == "aero_gantry":
        return "aero"
    return SECTOR_PART.get(info["sector"], "deck")


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


def _public_cap(caps: dict | None, symbol: str) -> int | None:
    """Public market cap in dollars. Missing and non-positive stay None."""
    if not caps:
        return None
    number = _num(caps.get(symbol))
    if number is None or number <= 0:
        return None
    return int(round(number))


def build_ship(
    book: dict | None,
    spx_pct: float | None,
    *,
    privacy: bool,
    caps: dict | None = None,
) -> dict:
    """Group the open book onto the ship. Drop a part with no weight.

    caps maps a symbol to a public market cap. It is not a position value.
    A symbol left out of caps is drawn as a modest building.
    """
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
            "market_cap": _public_cap(caps, slot["symbol"]),
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


def parse_market_cap(raw) -> float | None:
    """Accept 4946697311000, '4,946,697,311,000', or '$1.2T'."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        number = float(raw)
        if number != number or number <= 0:
            return None
        return number
    text = str(raw).strip().replace("$", "").replace(",", "").replace(" ", "")
    if not text or text.upper() in {"N/A", "NA", "NONE", "--"}:
        return None
    mult = 1.0
    suffix = text[-1:].upper()
    if suffix in {"T", "B", "M"} and len(text) > 1:
        text = text[:-1]
        mult = {"T": 1e12, "B": 1e9, "M": 1e6}[suffix]
    try:
        number = float(text) * mult
    except ValueError:
        return None
    if number != number or number <= 0:
        return None
    return number


def market_cap_from_nasdaq(payload) -> float | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    summary = data.get("summaryData")
    if not isinstance(summary, dict):
        return None
    field = summary.get("MarketCap")
    if not isinstance(field, dict):
        return None
    return parse_market_cap(field.get("value"))


_ETF = frozenset({"SPY", "IWM", "QQQM", "QQQ", "VOO", "VTI", "IVV"})
_CAP_CACHE: dict[str, tuple[float, float | None]] = {}
_CAP_LOCK = threading.Lock()
_CAP_TTL = 6 * 3600
_CAP_DOWN_UNTIL = 0.0


def _nasdaq_symbol(symbol: str) -> str:
    try:
        from api.server import _resolve_ticker_alias
        aliased = _resolve_ticker_alias(symbol) or symbol
    except Exception:
        aliased = symbol
    return str(aliased).replace("-", ".")


def _symbols_in(book: dict) -> list[str]:
    seen: list[str] = []
    found: set[str] = set()
    for row in book.get("positions") or []:
        if not isinstance(row, dict):
            continue
        sym = _symbol(row.get("symbol"))
        if sym and sym not in found:
            found.add(sym)
            seen.append(sym)
    return seen


def _fetch_one_cap(symbol: str) -> tuple[str, float | None, bool]:
    """Return symbol, cap, and whether the answer is worth caching."""
    asset = "etf" if symbol in _ETF else "stocks"
    nasdaq = quote(_nasdaq_symbol(symbol), safe=".")
    url = f"https://api.nasdaq.com/api/quote/{nasdaq}/summary?assetclass={asset}"
    try:
        import requests
        response = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=(1.2, 2.0),
        )
    except Exception:
        return symbol, None, False
    if response.status_code == 404:
        return symbol, None, True
    if response.status_code != 200:
        return symbol, None, False
    try:
        value = market_cap_from_nasdaq(response.json())
    except Exception:
        return symbol, None, False
    return symbol, value, True


def fetch_market_caps(symbols: list[str]) -> dict[str, float | None]:
    """Best-effort public market caps. Never raises. Missing stays None.

    Yahoo's quote endpoint rejects this host. Nasdaq's summary field is the
    public cap. Cash is skipped. A failed batch does not cache, so the next
    page load can try again. A process-wide pause avoids stalling every
    request when Nasdaq is down.
    """
    global _CAP_DOWN_UNTIL
    now = time.time()
    out: dict[str, float | None] = {}
    need: list[str] = []
    with _CAP_LOCK:
        if now < _CAP_DOWN_UNTIL:
            return {sym: None for sym in symbols}
        for sym in symbols:
            if not sym or sym in CASH_PART:
                out[sym] = None
                continue
            hit = _CAP_CACHE.get(sym)
            if hit and now - hit[0] < _CAP_TTL:
                out[sym] = hit[1]
            elif sym not in need:
                need.append(sym)
    if not need:
        return out
    from concurrent.futures import ThreadPoolExecutor, as_completed
    errors = 0
    found = 0
    attempts = 0
    pool = ThreadPoolExecutor(max_workers=6)
    futures = [pool.submit(_fetch_one_cap, sym) for sym in need]
    try:
        for fut in as_completed(futures, timeout=3.5):
            sym, value, cacheable = fut.result()
            attempts += 1
            out[sym] = value
            if value:
                found += 1
            if not cacheable:
                errors += 1
            elif cacheable:
                with _CAP_LOCK:
                    _CAP_CACHE[sym] = (time.time(), value)
    except TimeoutError:
        pass
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    if need and found == 0 and attempts and errors == attempts:
        _CAP_DOWN_UNTIL = time.time() + 600
    for sym in need:
        out.setdefault(sym, None)
    return out


def create_router(claims_fn, *, positions_fn=None, spx_fn=None, caps_fn=None) -> APIRouter:
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
            key = ("portfolio-ship", user, "weights" if hide else "dollars", spx_key, "cap")
            cached = _user_cache_get(key)
            if cached is not None:
                return cached
            book = _positions_dict(lp_me_positions(request))
        else:
            book = _positions_dict(positions_fn(request))
            key = None
        found = None
        if caps_fn is not None:
            try:
                found = caps_fn(_symbols_in(book))
            except Exception as exc:
                print(f"[portfolio-ship] caps failed: {exc!s:.140}", flush=True)
                found = None
            if not isinstance(found, dict):
                found = None
        payload = build_ship(book, _num(spx), privacy=hide, caps=found)
        if positions_fn is None and key is not None:
            from api.server import _user_cache_put
            _user_cache_put(key, payload)
        return payload

    return router
