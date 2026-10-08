"""Portfolio Ship. The live book paints the vessel. The sea follows the S&P.

+2% on the S&P 500, or better, is perfect weather. −3%, or worse, is the worst.
Between those prints the sea moves in a straight line. A missing print is the
flat-day sea (the same picture as a 0% day) and is marked unknown.

This does not write portfolio rows, and it does not call the SEC. Story groups
live here. GICS classification stays in portfolio_classify.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import date, datetime
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


# Yahoo's sector names, used only when a new symbol is not on the hand map.
_YAHOO_SECTOR = {
    "Technology": "Information Technology",
    "Information Technology": "Information Technology",
    "Financial Services": "Financials",
    "Financials": "Financials",
    "Healthcare": "Health Care",
    "Health Care": "Health Care",
    "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Discretionary": "Consumer Discretionary",
    "Consumer Defensive": "Consumer Staples",
    "Consumer Staples": "Consumer Staples",
    "Basic Materials": "Materials",
    "Materials": "Materials",
    "Real Estate": "Real Estate",
    "Communication Services": "Communication Services",
    "Energy": "Energy",
    "Utilities": "Utilities",
    "Industrials": "Industrials",
}


def part_for(symbol: str | None, sector_fn=None) -> str:
    """Story part. This is not a GICS assignment.

    sector_fn is asked only for a symbol the hand map does not know.
    A known sleeve never moves because a lookup returned something else.
    """
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
    note = info.get("industry_note") or ""
    if sector_fn is not None and "not on the hand map" in note:
        try:
            looked = sector_fn(sym)
        except Exception:
            looked = None
        mapped = SECTOR_PART.get(_YAHOO_SECTOR.get(str(looked or ""), looked or ""))
        if mapped:
            return mapped
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
    sector_fn=None,
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
    for slot in rolled.values():
        slot["part"] = part_for(slot["symbol"], sector_fn)
    grouped: dict[str, list[dict]] = {part: [] for part in PARTS}
    for slot in rolled.values():
        weight = (slot["market_value"] / total * 100.0) if total else 0.0
        grouped[slot["part"]].append({
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
            if slot.get("part") == part
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
_CAP_TTL_HIT = 6 * 3600
_CAP_TTL_MISS = 15 * 60
_SECTOR_CACHE: dict[str, tuple[float, str | None]] = {}


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


def _quote_symbols(symbol: str) -> list[str]:
    """Broker spelling first, then the quote symbol a preferred actually trades under."""
    sym = _symbol(symbol)
    found: list[str] = []

    def add(item: str | None) -> None:
        text = _symbol(item)
        if text and text not in found:
            found.append(text)

    add(sym)
    try:
        from api.server import _resolve_ticker_alias
        add(_resolve_ticker_alias(sym))
    except Exception:
        pass
    preferred = re.fullmatch(r"([A-Z]{1,5})PR([A-Z])", sym)
    if preferred:
        add(f"{preferred.group(1)}-P{preferred.group(2)}")
    if sym.endswith("PF") and len(sym) > 3:
        add(f"{sym[:-2]}-PF")
    return found


def _nasdaq_cap(symbol: str) -> float | None:
    asset = "etf" if symbol in _ETF else "stocks"
    nasdaq = quote(_nasdaq_symbol(symbol), safe=".")
    url = f"https://api.nasdaq.com/api/quote/{nasdaq}/summary?assetclass={asset}"
    try:
        import requests
        response = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=(1.2, 2.2),
        )
    except Exception:
        return None
    if response.status_code != 200:
        return None
    try:
        return market_cap_from_nasdaq(response.json())
    except Exception:
        return None


def _yahoo_cap(symbol: str) -> float | None:
    """Public market cap when Nasdaq has no field. Never raises."""
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        raw = None
        info = getattr(ticker, "fast_info", None)
        if info is not None:
            raw = info.get("market_cap") if hasattr(info, "get") else getattr(info, "market_cap", None)
        if not raw:
            slow = getattr(ticker, "info", None) or {}
            raw = slow.get("marketCap")
        return parse_market_cap(raw)
    except Exception:
        return None


def _fetch_one_cap(symbol: str) -> tuple[str, float | None]:
    """Try the broker symbol and its quote alias. A miss is cached only briefly."""
    for quote_sym in _quote_symbols(symbol):
        value = _nasdaq_cap(quote_sym)
        if value:
            return symbol, value
    for quote_sym in _quote_symbols(symbol):
        value = _yahoo_cap(quote_sym)
        if value:
            return symbol, value
    return symbol, None


def fetch_market_caps(symbols: list[str]) -> dict[str, float | None]:
    """Best-effort public market caps. Never raises. Missing stays None.

    Cash is skipped. A found cap is kept for hours. A miss is kept for a
    short while so the next page load can try again. One slow quote does
    not blank the caps that already came back.
    """
    now = time.time()
    out: dict[str, float | None] = {}
    need: list[str] = []
    with _CAP_LOCK:
        for sym in symbols:
            if not sym or sym in CASH_PART:
                out[sym] = None
                continue
            hit = _CAP_CACHE.get(sym)
            ttl = _CAP_TTL_HIT if hit and hit[1] else _CAP_TTL_MISS
            if hit and now - hit[0] < ttl:
                out[sym] = hit[1]
            elif sym not in need:
                need.append(sym)
    if not need:
        return out
    from concurrent.futures import ThreadPoolExecutor, as_completed
    pool = ThreadPoolExecutor(max_workers=8)
    futures = [pool.submit(_fetch_one_cap, sym) for sym in need]
    try:
        for fut in as_completed(futures, timeout=12):
            sym, value = fut.result()
            out[sym] = value
            with _CAP_LOCK:
                _CAP_CACHE[sym] = (time.time(), value)
    except TimeoutError:
        pass
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    for sym in need:
        out.setdefault(sym, None)
    return out


def _yahoo_sector(symbol: str) -> str | None:
    """Sector for a symbol the hand map does not list. Cached. Never raises."""
    sym = _symbol(symbol)
    if not sym:
        return None
    now = time.time()
    hit = _SECTOR_CACHE.get(sym)
    if hit and now - hit[0] < _CAP_TTL_HIT:
        return hit[1]
    sector = None
    try:
        import yfinance as yf
        quote_sym = _quote_symbols(sym)[-1]
        info = yf.Ticker(quote_sym).info or {}
        raw = str(info.get("sector") or "")
        sector = _YAHOO_SECTOR.get(raw)
    except Exception:
        sector = None
    _SECTOR_CACHE[sym] = (now, sector)
    return sector


_STATEMENT_FIELDS = (
    "revenue", "operating_income", "net_income",
    "operating_cash_flow", "capex", "free_cash_flow",
    "cash", "total_assets", "total_liabilities",
    "stockholders_equity", "total_debt", "long_term_debt", "short_term_debt",
)


def statement_candidates(symbol: str | None) -> list[str]:
    """Ticker to look up, then the common stock when this line is a preferred."""
    sym = _symbol(symbol)
    found: list[str] = []

    def add(item: str | None) -> None:
        text = _symbol(item)
        if text and text not in found:
            found.append(text)

    add(sym)
    preferred = re.fullmatch(r"([A-Z]{1,5})PR[A-Z]", sym)
    if preferred:
        add(preferred.group(1))
    dashed = re.fullmatch(r"([A-Z]{1,5})-P[A-Z]+", sym)
    if dashed:
        add(dashed.group(1))
    if sym.endswith("PF") and len(sym) > 3:
        add(sym[:-2])
    return found


def choose_statement_row(rows: list | None) -> dict | None:
    """Prefer a complete annual statement. Skip a row with no figures."""
    pool = [row for row in (rows or []) if isinstance(row, dict)]
    annual = [row for row in pool if str(row.get("period_type") or "") == "annual"]
    if annual:
        pool = annual

    def score(row: dict) -> int:
        return sum(1 for key in _STATEMENT_FIELDS if _num(row.get(key)) is not None)

    best = None
    best_score = 0
    for row in pool:
        ranked = score(row)
        if ranked > best_score:
            best = row
            best_score = ranked
    return best


def _iso_day(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    return text[:10] if text else None


def build_company_card(symbol: str | None, rows_fn) -> dict:
    """Public statements for one building. No position value is included."""
    sym = _symbol(symbol)
    for candidate in statement_candidates(sym):
        try:
            rows = rows_fn(candidate) if rows_fn else None
        except Exception:
            rows = None
        chosen = choose_statement_row(rows)
        if not chosen:
            continue
        debt = _num(chosen.get("total_debt"))
        if debt is None:
            long_debt = _num(chosen.get("long_term_debt"))
            short_debt = _num(chosen.get("short_term_debt"))
            if long_debt is not None or short_debt is not None:
                debt = (long_debt or 0.0) + (short_debt or 0.0)
        return {
            "ok": True,
            "symbol": sym,
            "statement_symbol": candidate,
            "name": (chosen.get("entity_name") or "").strip() or None,
            "period_end": _iso_day(chosen.get("period_end")),
            "balance_sheet": {
                "cash": _money(chosen.get("cash")),
                "total_assets": _money(chosen.get("total_assets")),
                "total_liabilities": _money(chosen.get("total_liabilities")),
                "equity": _money(chosen.get("stockholders_equity")),
                "debt": _money(debt),
            },
            "income": {
                "revenue": _money(chosen.get("revenue")),
                "operating_income": _money(chosen.get("operating_income")),
                "net_income": _money(chosen.get("net_income")),
            },
            "cash_flow": {
                "operating": _money(chosen.get("operating_cash_flow")),
                "capex": _money(chosen.get("capex")),
                "free_cash_flow": _money(chosen.get("free_cash_flow")),
            },
        }
    return {
        "ok": True,
        "symbol": sym,
        "statement_symbol": None,
        "name": None,
        "period_end": None,
        "balance_sheet": None,
        "income": None,
        "cash_flow": None,
    }


def _money(value) -> float | None:
    number = _num(value)
    if number is None:
        return None
    return round(number, 2)


def _statement_rows(ticker: str) -> list[dict]:
    from api.server import _RealDictCursor, _fund_conn
    with _fund_conn() as conn, conn.cursor(cursor_factory=_RealDictCursor) as cur:
        cur.execute(
            """
            SELECT entity_name, period_type, period_end,
                   revenue, operating_income, net_income,
                   operating_cash_flow, capex, free_cash_flow,
                   cash, total_assets, total_liabilities,
                   stockholders_equity, total_debt,
                   long_term_debt, short_term_debt
              FROM company_financials
             WHERE ticker = %s
             ORDER BY period_end DESC
             LIMIT 12
            """,
            (ticker,),
        )
        return [dict(row) for row in (cur.fetchall() or [])]


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
        payload = build_ship(book, _num(spx), privacy=hide, caps=found, sector_fn=_yahoo_sector)
        if positions_fn is None and key is not None:
            from api.server import _user_cache_put
            _user_cache_put(key, payload)
        return payload

    @router.get("/api/v2/gp/portfolio-ship/company/{symbol}")
    def portfolio_ship_company(symbol: str, request: Request):
        claims_fn(request)
        try:
            card = build_company_card(symbol, _statement_rows)
        except Exception:
            card = build_company_card(symbol, lambda _ticker: [])
        return card

    return router
