"""High-yield screen. Coupons and prices come from the desk, not from a model."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from credit.calc import (
    D,
    expected_loss,
    g_spread_bp,
    hazard_pd,
    interpolate_treasury,
    money,
    verdict,
    years_to_maturity,
    yield_to_worst,
)
from credit.fixture import CIK, build_fixture
from credit.present import FINRA, curve_of
from credit.universe import BOOK, UNIVERSE, YIELD_FLOOR_PCT

SETTLEMENT = date(2026, 10, 5)
FLOOR = D(YIELD_FLOOR_PCT)
_CURVE: dict[str, Decimal] | None = None
_PSKY_COUPON: str | None = None


def _curve() -> dict[str, Decimal]:
    global _CURVE
    if _CURVE is None:
        _CURVE = curve_of(build_fixture())
    return _CURVE


def psky_coupon_high() -> str:
    """Highest filed USD fixed coupon on the Paramount structure. Not a market yield."""
    global _PSKY_COUPON
    if _PSKY_COUPON is not None:
        return _PSKY_COUPON
    best: Decimal | None = None
    for row in build_fixture().get("instruments") or []:
        if row.get("coupon_type") not in (None, "fixed") or row.get("currency") != "USD":
            continue
        value = money((row.get("coupon") or {}).get("value"))
        if value is None:
            continue
        best = value if best is None or value > best else best
    _PSKY_COUPON = "" if best is None else format(best, "f")
    return _PSKY_COUPON


def book_rows(extra: list[dict] | None = None) -> list[dict]:
    rows: list[dict] = [{
        "cik": CIK,
        "legal_name": "Paramount Skydance Corporation",
        "ticker": "PSKY",
        "sector": "TMT",
        "book": BOOK,
        "status": "structure",
        "coupon_high": psky_coupon_high(),
        "floor_pct": YIELD_FLOOR_PCT,
    }]
    seen = {CIK}
    for row in UNIVERSE:
        if row["cik"] in seen:
            continue
        seen.add(row["cik"])
        rows.append({
            "ticker": row["ticker"],
            "cik": row["cik"],
            "legal_name": row["legal_name"],
            "sector": row["sector"],
            "book": BOOK,
            "status": "screen",
            "coupon_high": "",
            "floor_pct": YIELD_FLOOR_PCT,
        })
    for row in extra or []:
        cik = str(row.get("cik") or "")
        if not cik or cik in seen:
            continue
        seen.add(cik)
        rows.append({
            "cik": cik,
            "legal_name": row.get("legal_name") or cik,
            "ticker": row.get("ticker") or "",
            "sector": row.get("sector") or "",
            "book": BOOK,
            "status": row.get("status") or "saved",
            "coupon_high": "",
            "floor_pct": YIELD_FLOOR_PCT,
        })
    rows.sort(key=lambda item: (item.get("legal_name") or "").lower())
    return rows


def _price_one(raw: dict, index: int) -> dict:
    name = str(raw.get("name") or "").strip() or "Bond"
    coupon_pct = money(raw.get("coupon"))
    clean = money(raw.get("clean_price"))
    maturity_raw = str(raw.get("maturity") or "")[:10]
    amount = raw.get("amount")
    base = {
        "id": str(raw.get("id") or f"bond-{index + 1}"),
        "name": name,
        "coupon": None if coupon_pct is None else format(coupon_pct, "f"),
        "maturity": maturity_raw,
        "amount": "" if amount in (None, "") else str(amount),
        "clean_price": None if clean is None else format(clean, "f"),
        "ytm": None,
        "g_spread_bp": None,
        "treasury": None,
        "verdict": "",
        "verdict_reason": "",
        "ytw_note": "",
        "on_book": False,
        "off_book": False,
        "note": "",
    }
    if coupon_pct is None:
        base["note"] = "Coupon is not entered."
        return base
    on_coupon = coupon_pct >= FLOOR
    if clean is None:
        base["on_book"] = bool(on_coupon)
        base["off_book"] = not on_coupon
        base["note"] = (
            "Clean price is not entered."
            if on_coupon
            else "Coupon is under 6%. Off the book until a price shows a higher yield."
        )
        return base
    try:
        maturity = date.fromisoformat(maturity_raw)
    except ValueError:
        base["note"] = "Maturity must be a day, YYYY-MM-DD."
        base["off_book"] = not on_coupon
        return base
    if maturity <= SETTLEMENT:
        base["note"] = "Maturity is not after the settlement day used here, 2026-10-05."
        return base
    solved = yield_to_worst(
        clean=clean,
        coupon=coupon_pct / D("100"),
        maturity=maturity,
        settlement=SETTLEMENT,
        issue=SETTLEMENT,
        frequency=2,
        call_status="not_public",
    )
    ytm = solved["ytm"]
    years = years_to_maturity(SETTLEMENT, maturity)
    treasury = interpolate_treasury(_curve(), years)
    spread_bp = g_spread_bp(ytm, treasury)
    spread_decimal = None if spread_bp is None else spread_bp / D("10000")
    recovery = D("0.40")
    hazard = hazard_pd(spread_decimal, recovery, [D("1"), years]) if spread_decimal is not None else {"ok": False}
    loss = expected_loss((hazard.get("pd") or {}).get("1"), recovery) if hazard.get("ok") else None
    call = verdict(spread=spread_decimal, expected_losses=[loss] if loss is not None else [])
    ytm_pct = None if ytm is None else (ytm * D("100")).quantize(D("0.01"))
    base["ytm"] = None if ytm_pct is None else format(ytm_pct, "f")
    base["g_spread_bp"] = None if spread_bp is None else format(spread_bp, "f")
    base["treasury"] = None if treasury is None else format(treasury, "f")
    base["verdict"] = call["call"]
    base["verdict_reason"] = call["reason"]
    base["ytw_note"] = solved.get("ytw_note") or ""
    if ytm_pct is None:
        base["note"] = "Yield did not solve."
        return base
    base["on_book"] = ytm_pct >= FLOOR
    base["off_book"] = ytm_pct < FLOOR
    base["note"] = "" if base["on_book"] else "Yield is under 6%. Off this book."
    return base


def screen_view(issuer: dict, body: dict | None = None) -> dict:
    body = body or {}
    incoming = body.get("bonds") if isinstance(body.get("bonds"), list) else []
    quotes = [_price_one(raw, index) for index, raw in enumerate(incoming) if isinstance(raw, dict)]
    on_book = [row for row in quotes if row.get("on_book")]
    priced = [row for row in quotes if row.get("ytm")]
    off = [row for row in quotes if row.get("off_book")]
    if not quotes:
        badge = "Not priced"
        reason = "No bond is on the blotter. Type a coupon and a clean price. A yield under 6% leaves this book."
    elif off and not on_book:
        badge = "Off the book"
        reason = "Every entered bond is under 6%. This desk does not work 3–4% coupons."
    elif priced:
        badge = "High yield"
        reason = "At least one bond clears the 6% floor. The call is code, from the G-spread and a 40% recovery assumption."
    else:
        badge = "Coupon only"
        reason = "A coupon is typed. Enter a clean price for a yield and a call."
    cik = issuer["cik"]
    return {
        "mode": "screen",
        "book": BOOK,
        "floor_pct": YIELD_FLOOR_PCT,
        "badge": badge,
        "badge_reason": reason,
        "identity": {
            "name": issuer.get("legal_name"),
            "cik": cik,
            "ticker": issuer.get("ticker"),
            "sector": issuer.get("sector"),
        },
        "sec_url": f"https://www.sec.gov/edgar/browse/?CIK={cik}&owner=exclude",
        "finra_url": FINRA,
        "quotes": quotes,
        "curve_as_of": "2026-10-01",
        "curve_note": (
            "G-spread uses the Treasury close stored on the credit fixture for 2026-10-01. "
            "It is not a live TRACE print."
        ),
        "recovery_note": "The call assumes 40% recovery until a capital structure is loaded. It is not an agency rating.",
    }
