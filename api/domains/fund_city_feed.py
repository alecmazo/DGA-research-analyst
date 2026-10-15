"""Read-only Fund City feed. One row per holding, from the Ship book.

DGA Fund City polls this. It does not build the 3D city scene in
portfolio_city, and it does not regroup the GSE complex into one tower.
Dollars follow decide_privacy. A missing quantity stays null.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from api.domains.portfolio_city import PRIVACY_VALUES, decide_privacy
from api.domains.portfolio_classify import GSE_COMMONS, classify
from api.domains.portfolio_ship import (
    CASH_PART,
    PARTS,
    _is_gse,
    _positions_dict,
    _public_cap,
    _symbol as _ship_symbol,
    part_for,
)

FEED_PATH = "/api/v2/gp/fund-city"
FEED_TOKEN_ENV = "FUND_CITY_FEED_TOKEN"
MIN_TOKEN_LEN = 24
SCHEMA_VERSION = "1.0"
_WEIGHT_SCALE = 1_000_000
_GSE_COMMONS = frozenset(GSE_COMMONS)

# Same index set the ship uses when it asks Nasdaq for an ETF quote.
INDEX_FUNDS = frozenset({"SPY", "IWM", "QQQM", "QQQ", "VOO", "VTI", "IVV"})

_REFUSED_TOKENS = frozenset({
    "changeme",
    "replace-with-a-random-token",
    "your_token_here",
    "fund-city-feed-token",
})

SOURCE = (
    "Positions book across managed accounts and LP funds, stake already applied. "
    "Same book as Portfolio Ship. Sector is GICS from portfolio_classify. "
    "Story part is the Ship grouping. Public market cap is not a position value."
)


def is_feed_path(path: str | None) -> bool:
    return (path or "").rstrip("/") == FEED_PATH


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _ticker(symbol: str | None) -> str:
    text = _ship_symbol(symbol)
    if text.startswith("$"):
        text = text[1:]
    return text


def _header(request: Request, name: str) -> str:
    headers = getattr(request, "headers", None) or {}
    getter = getattr(headers, "get", None)
    if getter is None:
        return ""
    direct = getter(name)
    if direct:
        return str(direct).strip()
    lowered = name.lower()
    try:
        pairs = headers.items()
    except Exception:
        return ""
    for key, value in pairs:
        if str(key).lower() == lowered and value:
            return str(value).strip()
    return ""


def presented_token(request: Request) -> str:
    """Bearer or x-fund-city-token. Query strings are ignored on purpose."""
    direct = _header(request, "x-fund-city-token")
    if direct:
        return direct
    auth = _header(request, "authorization")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def _configured_token() -> str:
    return (os.environ.get(FEED_TOKEN_ENV) or "").strip()


def feed_token_ok(request: Request) -> bool:
    """True when the machine token matches FUND_CITY_FEED_TOKEN.

    Short and placeholder values never match, so an empty Railway variable
    cannot authorize the book. Comparison is on hashes so the secret's
    length is not part of the check.
    """
    secret = _configured_token()
    if len(secret) < MIN_TOKEN_LEN or secret.lower() in _REFUSED_TOKENS:
        return False
    got = presented_token(request)
    if len(got) < MIN_TOKEN_LEN or got.lower() in _REFUSED_TOKENS:
        return False
    return hmac.compare_digest(
        hashlib.sha256(got.encode()).digest(),
        hashlib.sha256(secret.encode()).digest(),
    )


def service_claims() -> dict:
    """GP-equivalent principal for the local Fund City client. Never demo."""
    return {
        "role": "gp",
        "lp_id": "fund-city-feed",
        "sub": "fund-city-feed",
        "email": "",
        "name": "Fund City",
        "demo_mode": False,
        "fund_memberships": {},
        "managed_account_ids": [],
        "service": "fund_city_feed",
    }


def attach_service_claims(request: Request) -> bool:
    if not feed_token_ok(request):
        return False
    claims = service_claims()
    state = getattr(request, "state", None)
    if state is not None:
        try:
            state.auth_claims = claims
        except Exception:
            pass
    return True


def privacy_decision(claims: dict | None, privacy: str) -> tuple[bool, str | None]:
    """Same hide/show as Ship and City. The reason is for the feed only."""
    hide = decide_privacy(claims, privacy)
    if not hide:
        return False, None
    flag = os.environ.get("PORTFOLIO_CITY_PUBLIC", "")
    if str(flag).strip() == "1":
        return True, "PORTFOLIO_CITY_PUBLIC"
    if privacy == "weights":
        return True, "privacy=weights"
    claims = claims or {}
    if claims.get("demo_mode"):
        return True, "demo_mode"
    if claims.get("role") not in ("gp", "admin"):
        return True, "role"
    return True, "privacy"


def _is_bond(symbol: str) -> bool:
    """A leading digit is a CUSIP, matching the positions pricer."""
    return bool(symbol) and symbol[0].isdigit()


def _is_preferred(symbol: str) -> bool:
    """GSE preferreds, plus broker spellings such as NLYPRF, NLYPF, and NLY-PF."""
    if _is_gse_preferred(symbol):
        return True
    if len(symbol) > 3 and symbol.endswith("PF"):
        return True
    if "-P" in symbol:
        return True
    head, sep, tail = symbol.partition("PR")
    return bool(sep) and head.isalpha() and tail.isalpha() and bool(tail)


def _is_gse_preferred(symbol: str) -> bool:
    return _is_gse(symbol) and symbol not in _GSE_COMMONS


def _display_name(symbol: str, book_name: str) -> str:
    info = classify(symbol)
    note = info.get("industry_note") or ""
    mapped = info.get("name") or ""
    if mapped and mapped != symbol and "not on the hand map" not in note:
        return mapped
    cleaned = (book_name or "").strip()
    if cleaned and cleaned.upper() != symbol:
        return cleaned
    return mapped or cleaned or symbol


def _weights(values: list[float]) -> list[float]:
    """Largest remainder so the fractions sum to 1. Empty stays empty."""
    count = len(values)
    if count == 0:
        return []
    total = sum(values)
    if total <= 0:
        return [0.0] * count
    exact = [value / total * _WEIGHT_SCALE for value in values]
    units = [int(piece) for piece in exact]
    residue = _WEIGHT_SCALE - sum(units)
    ranked = sorted(
        range(count),
        key=lambda index: (exact[index] - units[index], values[index]),
        reverse=True,
    )
    for step in range(max(0, residue)):
        units[ranked[step % count]] += 1
    return [unit / _WEIGHT_SCALE for unit in units]


def _flags(symbol: str, story_part: str) -> dict[str, bool]:
    cash = symbol in CASH_PART or story_part == "anchor"
    index_fund = symbol in INDEX_FUNDS or story_part == "market"
    gse_preferred = _is_gse_preferred(symbol)
    gse_common = symbol in _GSE_COMMONS
    bond = _is_bond(symbol)
    preferred = (not gse_common) and _is_preferred(symbol)
    return {
        "cash": cash,
        "index_fund": index_fund,
        "gse_preferred": gse_preferred,
        "gse_common": gse_common,
        "bond_cusip": bond,
        "preferred": preferred,
        "non_equity": bool(cash or bond or preferred),
    }


def _iso_now(now: datetime | str | None) -> str:
    if isinstance(now, str) and now:
        return now
    moment = now if isinstance(now, datetime) else datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_fund_city(
    book: dict | None,
    *,
    privacy: bool,
    caps: dict | None = None,
    sector_fn=None,
    is_demo: bool = False,
    book_ok: bool = True,
    withheld_reason: str | None = None,
    generated_at: str | datetime | None = None,
) -> dict:
    """Roll the open book up by symbol. Drop a line with no positive value.

    privacy=True withholds position dollars and share counts. Public market
    cap stays, matching Portfolio Ship. Weights are fractions of the book.
    """
    book = book or {}
    if not book_ok:
        book = {
            "as_of": book.get("as_of"),
            "book_as_of": book.get("book_as_of"),
            "positions": [],
        }
    rolled: dict[str, dict] = {}
    order: list[str] = []
    for row in book.get("positions") or []:
        if not isinstance(row, dict):
            continue
        symbol = _ticker(row.get("symbol"))
        if not symbol:
            continue
        value = _num(row.get("market_value"))
        if value is None or value <= 0:
            continue
        slot = rolled.get(symbol)
        if slot is None:
            slot = {
                "ticker": symbol,
                "name": "",
                "market_value": 0.0,
                "shares": 0.0,
                "shares_known": False,
            }
            rolled[symbol] = slot
            order.append(symbol)
        slot["market_value"] += value
        name = (row.get("name") or "").strip()
        if name and not slot["name"]:
            slot["name"] = name
        qty = _num(row.get("total_qty"))
        if qty is not None:
            slot["shares"] += qty
            slot["shares_known"] = True

    drafted = []
    for symbol in order:
        slot = rolled[symbol]
        info = classify(symbol)
        story_part = part_for(symbol, sector_fn)
        if story_part not in PARTS:
            story_part = "deck"
        flags = _flags(symbol, story_part)
        # Cash and CUSIPs are not an equity market cap. A quote miss stays null.
        cap = None
        if not flags["cash"] and not flags["bond_cusip"]:
            cap = _public_cap(caps, symbol)
        market_value = round(slot["market_value"], 2)
        shares = None
        if slot["shares_known"] and slot["shares"] > 0:
            shares = round(slot["shares"], 6)
        drafted.append({
            "ticker": symbol,
            "name": _display_name(symbol, slot["name"]),
            "sector": info["sector"],
            "story_part": story_part,
            "story_name": PARTS[story_part]["name"],
            "shares": shares,
            "market_value": market_value,
            "weight": 0.0,
            "currency": "USD",
            "market_cap": cap,
            "flags": flags,
        })

    fractions = _weights([row["market_value"] for row in drafted])
    for row, weight in zip(drafted, fractions):
        row["weight"] = weight
    drafted.sort(key=lambda row: (-row["weight"], row["ticker"]))

    show_dollars = bool(book_ok and not privacy)
    nav = round(sum(row["market_value"] for row in drafted), 2) if show_dollars else None
    cash = None
    if show_dollars:
        cash = round(sum(
            row["market_value"] for row in drafted if row["flags"]["cash"]
        ), 2)
    cash_weight = round(sum(
        row["weight"] for row in drafted if row["flags"]["cash"]
    ), 6)
    if not show_dollars:
        for row in drafted:
            row["market_value"] = None
            row["shares"] = None

    if not book_ok:
        status = "unavailable"
    elif drafted:
        status = "ok"
    else:
        status = "empty"
    # An outage nulls dollars without changing the privacy decision. The
    # game keeps the last good snapshot when book_status is unavailable.
    reason = (withheld_reason or "privacy") if privacy else None

    return {
        "schema_version": SCHEMA_VERSION,
        "ok": True,
        "fund": {
            "as_of": book.get("as_of"),
            "book_as_of": book.get("book_as_of"),
            "generated_at": _iso_now(generated_at),
            "nav": nav,
            "cash": cash,
            "cash_weight": cash_weight,
            "currency": "USD",
            "holdings_count": len(drafted),
        },
        "holdings": drafted,
        "provenance": {
            "source": SOURCE,
            "is_live": bool(book_ok and not is_demo),
            "is_demo": bool(is_demo),
            "privacy": "weights" if privacy else "dollars",
            "show_dollars": show_dollars,
            "withheld_reason": reason,
            "book_status": status,
        },
    }


def _resolve_claims(request: Request, claims_fn) -> dict:
    if feed_token_ok(request):
        claims = service_claims()
        state = getattr(request, "state", None)
        if state is not None:
            try:
                state.auth_claims = claims
            except Exception:
                pass
        return claims
    claims = claims_fn(request) or {}
    if claims.get("role") not in ("gp", "admin"):
        raise HTTPException(403, "GP session or fund-city feed token required")
    return claims


def create_router(claims_fn, *, positions_fn=None, caps_fn=None, sector_fn=None) -> APIRouter:
    router = APIRouter(tags=["fund-city"])

    @router.get(FEED_PATH)
    def fund_city(request: Request, privacy: str = "auto"):
        if privacy not in PRIVACY_VALUES:
            raise HTTPException(400, "privacy must be auto, weights, or dollars")
        claims = _resolve_claims(request, claims_fn)
        hide, reason = privacy_decision(claims, privacy)
        key = None
        if positions_fn is None:
            from api.server import _user_cache_get, _user_cache_put, lp_me_positions
            user = str(claims.get("sub") or claims.get("lp_id") or claims.get("email") or "")
            key = ("fund-city-feed", user, "weights" if hide else "dollars")
            cached = _user_cache_get(key)
            if cached is not None:
                return cached
            book = _positions_dict(lp_me_positions(request))
        else:
            book = _positions_dict(positions_fn(request))
        book_ok = not (isinstance(book, dict) and book.get("error"))
        found = None
        if caps_fn is not None and book_ok:
            symbols = []
            seen: set[str] = set()
            for row in book.get("positions") or []:
                if not isinstance(row, dict):
                    continue
                symbol = _ticker(row.get("symbol"))
                if symbol and symbol not in seen:
                    seen.add(symbol)
                    symbols.append(symbol)
            try:
                found = caps_fn(symbols)
            except Exception as exc:
                print(f"[fund-city] caps failed: {exc!s:.140}", flush=True)
                found = None
            if not isinstance(found, dict):
                found = None
        payload = build_fund_city(
            book,
            privacy=hide,
            caps=found,
            sector_fn=sector_fn,
            is_demo=bool(claims.get("demo_mode")),
            book_ok=book_ok,
            withheld_reason=reason,
        )
        if positions_fn is None and key is not None:
            from api.server import _user_cache_put
            _user_cache_put(key, payload)
        return payload

    return router
