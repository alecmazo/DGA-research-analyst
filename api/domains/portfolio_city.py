"""Portfolio City payload. Positions come from the existing book. Dollars are not invented.

Market cap is last price times the SEC common-share count. A missing fact stays null.
Book equity is the SEC stockholders-equity fact. The client draws the glass band
from `equity_band` and does not divide.
"""
from __future__ import annotations

import math
import os
import threading
import time
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

from api.domains.portfolio_classify import (
    CASH_SYMBOLS,
    DISTRICTS,
    GSE_COMMONS,
    GSE_SYMBOLS,
    SHIP_DOTS,
    classify,
    colors,
    normalize_symbol,
)

H_MIN = 8.0
H_MAX = 120.0
FOOT_MIN = 6.0
FOOT_SPAN = 8.0
CASH_CIVIC_FOOTPRINT = 12.0
EQUITY_DOWN_CAP = 0.45
METRICS = ("market_cap", "position_value", "total_assets")
PRIVACY_VALUES = ("auto", "weights", "dollars")

_SHARE_TAGS = ("CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding")
_EQUITY_TAGS = (
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
)
_ASSET_TAGS = ("Assets",)
_FORMS = frozenset({"10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "20-F/A"})

SOURCE = (
    "Positions book across managed accounts and LP funds, stake already applied. "
    "Market cap is the position mark times SEC common shares outstanding. "
    "Book equity and total assets are SEC companyfacts. A missing fact stays empty."
)


def _num(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(out) or math.isinf(out):
        return None
    return out


def _latest_fact(companyfacts: dict | None, tags: tuple[str, ...], units: tuple[str, ...]) -> dict | None:
    """Latest instant on a 10-K or 10-Q. Newer period end wins, then the later filing."""
    if not isinstance(companyfacts, dict):
        return None
    try:
        from sec_edgar_xbrl import _iter_facts
    except Exception:
        return None
    best = None
    best_key = ("", "")
    for tag in tags:
        try:
            rows = _iter_facts(companyfacts, tag, units)
        except Exception:
            continue
        for row in rows:
            if row.get("form") not in _FORMS:
                continue
            end = str(row.get("end") or "")
            filed = str(row.get("filed") or "")
            if (end, filed) < best_key:
                continue
            val = _num(row.get("val"))
            if val is None:
                continue
            best_key = (end, filed)
            best = {"value": val, "as_of": end or None, "tag": tag}
    return best


def snapshot_from_facts(companyfacts: dict | None) -> dict:
    """Pull share count, stockholders' equity, and assets off one companyfacts payload.

    Share count is the raw SEC `shares` unit. It is not rescaled into millions.
    """
    shares = _latest_fact(companyfacts, _SHARE_TAGS, ("shares",))
    equity = _latest_fact(companyfacts, _EQUITY_TAGS, ("USD",))
    assets = _latest_fact(companyfacts, _ASSET_TAGS, ("USD",))
    return {
        "shares": None if shares is None else shares["value"],
        "shares_as_of": None if shares is None else shares["as_of"],
        "book_equity": None if equity is None else equity["value"],
        "book_equity_as_of": None if equity is None else equity["as_of"],
        "total_assets": None if assets is None else assets["value"],
        "total_assets_as_of": None if assets is None else assets["as_of"],
    }


class SecCache:
    """24h companyfacts cache. At most 10 requests a second. A failure is cached as null."""

    def __init__(
        self,
        fetch: Callable[[str], dict | None],
        *,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
        min_interval: float = 0.1,
        ttl: float = 24 * 3600,
    ):
        self._fetch = fetch
        self._clock = clock
        self._sleep = sleep
        self._min_interval = min_interval
        self._ttl = ttl
        self._lock = threading.Lock()
        self._store: dict[str, tuple[float, dict | None]] = {}
        self._next_ok = 0.0

    def facts(self, cik: str) -> dict | None:
        key = str(cik or "").strip()
        if not key:
            return None
        now = self._clock()
        hit = self._store.get(key)
        if hit and now - hit[0] < self._ttl:
            return hit[1]
        with self._lock:
            now = self._clock()
            hit = self._store.get(key)
            if hit and now - hit[0] < self._ttl:
                return hit[1]
            wait = self._next_ok - now
            if wait > 0:
                self._sleep(wait)
            try:
                payload = self._fetch(key)
                if not isinstance(payload, dict):
                    payload = None
            except Exception:
                payload = None
            self._next_ok = self._clock() + self._min_interval
            self._store[key] = (self._clock(), payload)
            return payload


def _sqrt_size(value: float, vmax: float) -> float:
    if vmax <= 0 or value <= 0:
        return H_MIN
    return H_MIN + (H_MAX - H_MIN) * math.sqrt(value / vmax)


def _foot(fraction: float) -> float:
    return FOOT_MIN + FOOT_SPAN * max(0.0, min(1.0, fraction))


def _log_heights(values: dict[str, float]) -> dict[str, float]:
    positive = {k: v for k, v in values.items() if v and v > 0}
    if not positive:
        return {}
    if len(positive) == 1 or min(positive.values()) == max(positive.values()):
        return {k: H_MAX for k in positive}
    lo = math.log10(min(positive.values()))
    hi = math.log10(max(positive.values()))
    span = hi - lo
    if span <= 0:
        return {k: H_MAX for k in positive}
    return {
        k: H_MIN + (H_MAX - H_MIN) * (math.log10(v) - lo) / span
        for k, v in positive.items()
    }


def _equity_band(book: float | None, cap: float | None) -> tuple[float | None, dict | None]:
    if book is None or cap is None or cap <= 0:
        return None, None
    ratio = book / cap
    if ratio > 0:
        return ratio, {"side": "up", "fraction": min(ratio, 1.0)}
    if ratio < 0:
        return ratio, {"side": "down", "fraction": min(abs(ratio), EQUITY_DOWN_CAP)}
    return 0.0, None


def _round_size(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 1)


def _weighted_change(lots: list[dict]) -> float | None:
    num = 0.0
    den = 0.0
    for lot in lots:
        pct = _num(lot.get("day_change_pct"))
        val = _num(lot.get("market_value"))
        if pct is None or val is None or val <= 0:
            continue
        num += pct * val
        den += val
    if den <= 0:
        return None
    return round(num / den, 4)


def _holder(lot: dict, book_total: float, *, privacy: bool) -> dict:
    val = _num(lot.get("market_value")) or 0.0
    return {
        "ticker": normalize_symbol(lot.get("symbol")),
        "account_name": lot.get("account_name") or "",
        "account_short": lot.get("account_short") or "",
        "source_type": lot.get("source_type") or "managed_account",
        "position_value": None if privacy else round(val, 2),
        "weight": (val / book_total) if book_total > 0 else 0.0,
        "stake_pct": _num(lot.get("stake_pct")),
    }


def _bands(holders: list[dict]) -> list[dict]:
    """One edge per account, largest share of the tower at the base."""
    groups: dict[tuple, float] = {}
    order: list[tuple] = []
    total = 0.0
    for holder in holders:
        val = holder.get("position_value")
        # Privacy nulls dollars. Fall back to book weight, which is still the share.
        weight = _num(holder.get("weight")) or 0.0
        amount = _num(val) if val is not None else weight
        if amount is None or amount <= 0:
            continue
        key = (
            holder.get("account_name") or "",
            holder.get("source_type") or "managed_account",
        )
        if key not in groups:
            order.append(key)
        groups[key] = groups.get(key, 0.0) + amount
        total += amount
    if total <= 0:
        return []
    rows = [
        {
            "account_name": name,
            "source_type": source,
            "share": groups[(name, source)] / total,
        }
        for name, source in order
    ]
    rows.sort(key=lambda row: row["share"], reverse=True)
    return rows


def _market_cap(price: float | None, snap: dict) -> tuple[float | None, str | None]:
    shares = _num(snap.get("shares"))
    if price is not None and price > 0 and shares is not None and shares > 0:
        return price * shares, snap.get("shares_as_of")
    fallback = _num(snap.get("market_cap_fallback"))
    if fallback is not None and fallback > 0:
        return fallback, snap.get("market_cap_as_of")
    return None, None


def _price_of(lots: list[dict], snap: dict) -> float | None:
    quoted = _num(snap.get("price"))
    if quoted is not None and quoted > 0:
        return quoted
    for lot in lots:
        px = _num(lot.get("last_price"))
        if px is not None and px > 0:
            return px
    return None


def _empty_snap() -> dict:
    return {
        "shares": None,
        "shares_as_of": None,
        "book_equity": None,
        "book_equity_as_of": None,
        "total_assets": None,
        "total_assets_as_of": None,
        "price": None,
        "market_cap_fallback": None,
        "market_cap_as_of": None,
    }


def _combine_gse(fundamentals: dict, lots: list[dict]) -> dict:
    """Freddie common plus Fannie common. A missing half blanks that field.

    Preferred lots stay in the position. Their prices are not a market cap.
    """
    lot_px: dict[str, float] = {}
    for lot in lots:
        sym = lot["symbol"]
        if sym not in GSE_COMMONS:
            continue
        px = _num(lot.get("last_price"))
        if px is not None and px > 0:
            lot_px[sym] = px
    parts = [fundamentals.get(sym) or {} for sym in GSE_COMMONS]
    out = _empty_snap()
    caps: list[float] | None = []
    books: list[float] | None = []
    assets: list[float] | None = []
    cap_as_of = []
    book_as_of = []
    asset_as_of = []
    for sym, snap in zip(GSE_COMMONS, parts):
        px = _num(snap.get("price")) or lot_px.get(sym)
        cap, as_of = _market_cap(px, snap)
        if cap is None:
            caps = None
        elif caps is not None:
            caps.append(cap)
            cap_as_of.append(f"{sym} {as_of or 'n/a'}")
        book = _num(snap.get("book_equity"))
        if book is None:
            books = None
        elif books is not None:
            books.append(book)
            book_as_of.append(f"{sym} {snap.get('book_equity_as_of') or 'n/a'}")
        asset = _num(snap.get("total_assets"))
        if asset is None:
            assets = None
        elif assets is not None:
            assets.append(asset)
            asset_as_of.append(f"{sym} {snap.get('total_assets_as_of') or 'n/a'}")
    if caps is not None and len(caps) == len(GSE_COMMONS):
        out["market_cap_fallback"] = sum(caps)
        out["market_cap_as_of"] = " / ".join(cap_as_of)
    if books is not None and len(books) == len(GSE_COMMONS):
        out["book_equity"] = sum(books)
        out["book_equity_as_of"] = " / ".join(book_as_of)
    if assets is not None and len(assets) == len(GSE_COMMONS):
        out["total_assets"] = sum(assets)
        out["total_assets_as_of"] = " / ".join(asset_as_of)
    return out


def build_city(positions: dict, fundamentals: dict | None, *, privacy: bool) -> dict:
    """Group the caller's position rows into one tower per company."""
    fundamentals = fundamentals or {}
    rows = []
    for raw in positions.get("positions") or []:
        if not isinstance(raw, dict):
            continue
        val = _num(raw.get("market_value"))
        if val is None or val <= 0:
            continue
        item = dict(raw)
        item["symbol"] = normalize_symbol(raw.get("symbol"))
        item["market_value"] = val
        rows.append(item)

    book_total = round(sum(row["market_value"] for row in rows), 2)
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for row in rows:
        sym = row["symbol"]
        if sym in GSE_SYMBOLS:
            key = "gse"
        elif sym in CASH_SYMBOLS:
            key = "cash"
        else:
            key = sym
        if key not in groups:
            order.append(key)
            groups[key] = []
        groups[key].append(row)

    companies = []
    for key in order:
        lots = groups[key]
        value = sum(lot["market_value"] for lot in lots)
        if key == "gse":
            ident = {
                "name": "Freddie/Fannie complex",
                "sector": "Financials",
                "archetype": "speculative_beacon",
                "industry_note": (
                    "One tower for FMCC common and the preferred lots. "
                    "Market cap is Freddie common plus Fannie common, not the preferreds."
                ),
                "archetype_override": True,
            }
            snap = _combine_gse(fundamentals, lots)
            ticker = "GSE"
            price = None
        elif key == "cash":
            ident = {
                "name": "Cash reserve",
                "sector": "Cash",
                "archetype": "cash_plaza",
                "industry_note": "Money market. Central plaza, not a tower.",
                "archetype_override": False,
            }
            snap = _empty_snap()
            ticker = "CASH"
            price = None
        else:
            ident = classify(key)
            snap = dict(_empty_snap())
            snap.update(fundamentals.get(key) or {})
            ticker = key
            price = _price_of(lots, snap)
        holders = [_holder(lot, book_total, privacy=False) for lot in lots]
        members = [
            {"ticker": lot["symbol"], "position_value": round(lot["market_value"], 2)}
            for lot in lots
        ]
        if key == "gse":
            cap = _num(snap.get("market_cap_fallback"))
            cap_as_of = snap.get("market_cap_as_of")
        elif key == "cash":
            cap, cap_as_of = None, None
        else:
            cap, cap_as_of = _market_cap(price, snap)
        book = None if key == "cash" else _num(snap.get("book_equity"))
        assets = None if key == "cash" else _num(snap.get("total_assets"))
        ratio, band = _equity_band(book, cap)
        companies.append({
            "id": key.lower(),
            "ticker": ticker,
            "name": ident["name"] if key in ("gse", "cash") else (ident["name"] if ident["name"] != key else (lots[0].get("name") or key)),
            "sector": ident["sector"],
            "industry_note": ident["industry_note"],
            "archetype": ident["archetype"],
            "archetype_override": ident["archetype_override"],
            "position_value": round(value, 2),
            "weight": (value / book_total) if book_total > 0 else 0.0,
            "total_assets": assets,
            "total_assets_as_of": None if assets is None else snap.get("total_assets_as_of"),
            "total_assets_source": None if assets is None else "SEC XBRL companyfacts us-gaap:Assets",
            "market_cap": cap,
            "market_cap_as_of": cap_as_of,
            "book_equity": book,
            "book_equity_as_of": None if book is None else snap.get("book_equity_as_of"),
            "equity_to_market_cap": ratio,
            "equity_band": band,
            "members": members if len(members) > 1 or key in ("gse", "cash") else None,
            "holders": holders,
            "bands": _bands(holders),
            "daily_change_pct": _weighted_change(lots),
            "volatility_1y": None,
            "colors": colors(ident["archetype"]),
            "ship_dot": SHIP_DOTS.get(ident["sector"], "#9aa7b4"),
            "animation": {
                "flicker": 0.6 if ident["archetype"] == "speculative_beacon" else 0.0,
                "sway": 0.0,
            },
            "emissive_intensity": 2.2 if ident["archetype"] in ("speculative_beacon", "tech_neon") else 1.4,
        })

    # Cent rounding can miss the row total by a penny. Put it back on the first tower.
    if companies and book_total > 0:
        drift = sum(company["position_value"] for company in companies) - book_total
        if abs(drift) >= 0.005:
            companies[0]["position_value"] = round(companies[0]["position_value"] - drift, 2)
        raw_weights = [company["position_value"] / book_total for company in companies]
        residue = 1.0 - sum(raw_weights)
        heaviest = max(range(len(companies)), key=lambda i: companies[i]["position_value"])
        for i, company in enumerate(companies):
            company["weight"] = raw_weights[i] + (residue if i == heaviest else 0.0)

    cap_values = {
        company["id"]: company["market_cap"]
        for company in companies
        if company["market_cap"]
    }
    pos_values = {company["id"]: company["position_value"] for company in companies}
    asset_values = {
        company["id"]: company["total_assets"]
        for company in companies
        if company["total_assets"]
    }
    cap_max = max(cap_values.values()) if cap_values else 0.0
    pos_max = max(pos_values.values()) if pos_values else 0.0
    asset_heights = _log_heights(asset_values)

    placed: dict[str, int] = {}
    for company in companies:
        cap = company["market_cap"]
        pos = company["position_value"]
        if company["id"] == "cash":
            h_cap = None
            f_cap = CASH_CIVIC_FOOTPRINT
        elif cap:
            h_cap = _sqrt_size(cap, cap_max)
            f_cap = _foot(math.sqrt(cap / cap_max) if cap_max else 0.0)
        else:
            h_cap = None
            f_cap = None
        h_pos = _sqrt_size(pos, pos_max) if pos else None
        f_pos = _foot(math.sqrt(pos / pos_max) if pos and pos_max else 0.0)
        h_assets = asset_heights.get(company["id"])
        if h_assets is not None and asset_values:
            amax = max(asset_values.values())
            frac = (h_assets - H_MIN) / (H_MAX - H_MIN) if H_MAX > H_MIN else 1.0
            f_assets = _foot(frac)
        else:
            f_assets = None
        company["size"] = {
            "metric_default": "market_cap",
            "height_by_position_value": _round_size(h_pos),
            "height_by_total_assets": _round_size(h_assets),
            "height_by_market_cap": _round_size(h_cap),
            "footprint": _round_size(f_pos) or FOOT_MIN,
            "footprint_by_position_value": _round_size(f_pos),
            "footprint_by_total_assets": _round_size(f_assets),
            "footprint_by_market_cap": _round_size(f_cap),
        }
        dx, dz = DISTRICTS.get(company["sector"], (0.0, 0.0))
        i = placed.get(company["sector"], 0)
        placed[company["sector"]] = i + 1
        company["district"] = company["sector"]
        company["position"] = {
            "x": round(dx * 70 + (i % 2) * 28, 1),
            "z": round(dz * 70 + (i // 2) * 28, 1),
            "rotation_y": 0,
        }
        company["tooltip"] = _tooltip(company, privacy=False)

    missing = sum(
        1 for company in companies
        if company["id"] != "cash" and not company["market_cap"]
    )
    as_of = positions.get("book_as_of") or positions.get("as_of") or ""
    payload = {
        "schema_version": "1.0",
        "metric": "market_cap",
        "portfolio": {
            "total_value": book_total,
            "currency": "USD",
            "accounts": positions.get("account_count"),
            "raw_positions": len(rows),
            "as_of": str(as_of),
            "source": SOURCE,
            "market_cap_missing": missing,
        },
        "scale": {
            "height_min": H_MIN,
            "height_max": H_MAX,
            "position_value": "sqrt",
            "total_assets": "log10",
            "market_cap": "sqrt",
        },
        "companies": companies,
    }
    if privacy:
        _strip_dollars(payload)
    return payload


def _tooltip(company: dict, *, privacy: bool) -> str:
    weight = (company.get("weight") or 0) * 100
    parts = [f"{company['name']} · {weight:.1f}%"]
    if not privacy and company.get("position_value") is not None:
        parts.append(f"${company['position_value']:,.0f}")
    ratio = company.get("equity_to_market_cap")
    if ratio is None:
        parts.append("book equity n/a")
    else:
        parts.append(f"book equity {ratio * 100:.1f}% of market cap")
    return " · ".join(parts)


def _strip_dollars(payload: dict) -> None:
    payload["portfolio"]["total_value"] = None
    payload["portfolio"]["accounts"] = None
    for company in payload["companies"]:
        company["position_value"] = None
        company["tooltip"] = _tooltip(company, privacy=True)
        for holder in company.get("holders") or []:
            holder["position_value"] = None
        for member in company.get("members") or []:
            member["position_value"] = None
        # Bands were built from dollars. Rebuild from book weights so the edges survive.
        company["bands"] = _bands(company.get("holders") or [])


def decide_privacy(claims: dict | None, privacy: str, *, public_flag: str | None = None) -> bool:
    """Demo, a non-GP, weights mode, and the public flag never receive position dollars."""
    claims = claims or {}
    flag = public_flag if public_flag is not None else os.environ.get("PORTFOLIO_CITY_PUBLIC", "")
    if str(flag).strip() == "1":
        return True
    if privacy == "weights":
        return True
    if claims.get("demo_mode"):
        return True
    if claims.get("role") not in ("gp", "admin"):
        return True
    return False


def _positions_dict(response) -> dict:
    if isinstance(response, dict):
        return response
    raw = getattr(response, "body", None)
    if isinstance(raw, bytes):
        import json
        return json.loads(raw.decode() or "{}")
    if isinstance(raw, str):
        import json
        return json.loads(raw or "{}")
    return {"positions": []}


def _default_fundamentals(symbols: list[str]) -> dict:
    """SEC first. Yahoo market cap only when the share count is missing."""
    out: dict[str, dict] = {}
    try:
        from sec_edgar_xbrl import fetch_company_facts, resolve_cik
    except Exception:
        return out
    cache = _shared_sec_cache(fetch_company_facts)
    for sym in symbols:
        snap = _empty_snap()
        try:
            cik = resolve_cik(sym)
        except Exception:
            cik = None
        facts = cache.facts(cik) if cik else None
        if facts:
            snap.update(snapshot_from_facts(facts))
        if not snap.get("shares"):
            fallback = _yahoo_market_cap(sym)
            if fallback:
                snap["market_cap_fallback"] = fallback
                snap["market_cap_as_of"] = "yahoo"
        out[sym] = snap
    return out


_SEC_CACHE: SecCache | None = None
_SEC_GUARD = threading.Lock()
_YAHOO_CACHE: dict[str, tuple[float, float | None]] = {}


def _shared_sec_cache(fetch) -> SecCache:
    global _SEC_CACHE
    with _SEC_GUARD:
        if _SEC_CACHE is None:
            _SEC_CACHE = SecCache(fetch)
        return _SEC_CACHE


def _yahoo_market_cap(symbol: str) -> float | None:
    now = time.time()
    hit = _YAHOO_CACHE.get(symbol)
    if hit and now - hit[0] < 24 * 3600:
        return hit[1]
    value = None
    try:
        import yfinance as yf
        info = getattr(yf.Ticker(symbol), "info", {}) or {}
        raw = info.get("marketCap")
        num = _num(raw)
        if num and num > 0:
            value = num
    except Exception:
        value = None
    _YAHOO_CACHE[symbol] = (now, value)
    return value


def create_router(claims_fn, *, positions_fn=None, fundamentals_fn=None) -> APIRouter:
    router = APIRouter(tags=["portfolio-city"])

    @router.get("/api/v2/gp/portfolio-city")
    def portfolio_city(request: Request, metric: str = "market_cap", privacy: str = "auto"):
        if metric not in METRICS:
            raise HTTPException(400, "metric must be market_cap, position_value, or total_assets")
        if privacy not in PRIVACY_VALUES:
            raise HTTPException(400, "privacy must be auto, weights, or dollars")
        claims = claims_fn(request)
        hide = decide_privacy(claims, privacy)
        if positions_fn is None:
            from api.server import _user_cache_get, _user_cache_put, lp_me_positions
            user = str(claims.get("sub") or claims.get("email") or "")
            key = ("portfolio-city", user, "weights" if hide else "dollars")
            cached = _user_cache_get(key)
            if cached is not None:
                return cached
            book = _positions_dict(lp_me_positions(request))
        else:
            book = _positions_dict(positions_fn(request))
            key = None
        symbols = sorted({
            normalize_symbol(row.get("symbol"))
            for row in (book.get("positions") or [])
            if isinstance(row, dict) and normalize_symbol(row.get("symbol"))
        })
        if any(sym in GSE_SYMBOLS for sym in symbols):
            for common in GSE_COMMONS:
                if common not in symbols:
                    symbols.append(common)
        loader = fundamentals_fn or _default_fundamentals
        try:
            facts = loader(symbols) or {}
        except Exception:
            facts = {}
        payload = build_city(book, facts, privacy=hide)
        payload["metric"] = metric
        if positions_fn is None and key is not None:
            from api.server import _user_cache_put
            _user_cache_put(key, payload)
        return payload

    return router
