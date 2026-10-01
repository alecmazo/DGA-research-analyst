"""Scan-table spreads. Decimal, cash stock and mixed only. Collars are not computed."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from merger_arb.scanner.extract import close_from_phrase


def _dec(value) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value).replace(",", "").replace("$", "").strip())
    except Exception:
        return None


def _as_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "")[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


@dataclass
class Spread:
    offer_value: Decimal | None
    gross_spread: Decimal | None
    gross_spread_pct: Decimal | None
    annualized_pct: Decimal | None
    annualized_assumption: str
    needs_manual_terms: bool
    spread_with_cvr_max: Decimal | None
    consideration: str


def consideration_of(*, cash: Decimal | None, ratio: Decimal | None) -> str:
    if cash is not None and ratio is not None:
        return "mixed"
    if ratio is not None:
        return "stock"
    if cash is not None:
        return "cash"
    return ""


def offer_terms(*, cash: Decimal | None, ratio: Decimal | None) -> str:
    parts = []
    if cash is not None:
        parts.append(f"${cash} cash")
    if ratio is not None:
        parts.append(f"{ratio} shares")
    return " + ".join(parts)


def compute_spread(
    *,
    cash=None,
    ratio=None,
    target_price=None,
    acquirer_price=None,
    close_date=None,
    close_text: str = "",
    as_of=None,
    cvr_max=None,
    collar: bool = False,
    election: bool = False,
    proration: bool = False,
) -> Spread:
    cash_d = _dec(cash)
    ratio_d = _dec(ratio)
    target = _dec(target_price)
    acquirer = _dec(acquirer_price)
    cvr = _dec(cvr_max)
    kind = consideration_of(cash=cash_d, ratio=ratio_d)
    assumption = ""
    resolved = _as_date(close_date)
    if resolved is None and close_text:
        iso, assumption, _phrase = close_from_phrase(close_text)
        resolved = _as_date(iso)
    elif resolved is not None and close_text:
        _iso, assumption, _phrase = close_from_phrase(close_text)
        if not assumption:
            assumption = resolved.isoformat()
    elif resolved is not None:
        assumption = resolved.isoformat()

    manual = bool(collar or election or proration)
    if manual or kind not in {"cash", "stock", "mixed"}:
        return Spread(None, None, None, None, assumption, manual or kind == "", None, kind)

    offer: Decimal | None
    if kind == "cash":
        offer = cash_d
    elif kind == "stock":
        offer = None if acquirer is None or ratio_d is None else ratio_d * acquirer
    else:
        if acquirer is None or ratio_d is None or cash_d is None:
            offer = None
        else:
            offer = cash_d + (ratio_d * acquirer)

    if offer is None or target is None or target == 0:
        cvr_spread = None
        if offer is not None and target not in (None, 0) and cvr is not None:
            cvr_spread = (offer + cvr) - target
        return Spread(offer, None, None, None, assumption, False, cvr_spread, kind)

    gross = offer - target
    pct = gross / target
    cvr_spread = (offer + cvr - target) if cvr is not None else None
    annualized = None
    as_of_date = _as_date(as_of) or date.today()
    if resolved is not None:
        days = (resolved - as_of_date).days
        if days <= 0:
            assumption = (assumption + "; " if assumption else "") + "past due; annualized not computed"
        elif (Decimal(1) + pct) > 0:
            annualized = (Decimal(1) + pct) ** (Decimal(365) / Decimal(days)) - Decimal(1)
    return Spread(offer, gross, pct, annualized, assumption, False, cvr_spread, kind)
