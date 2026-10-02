"""Packet to the page. Every computed number names the inputs it used."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from credit.calc import (
    D,
    expected_loss,
    field_money,
    g_spread_bp,
    hazard_pd,
    coverage,
    interpolate_treasury,
    leverage,
    money,
    usable,
    verdict,
    waterfall,
    years_to_maturity,
    yield_to_worst,
)
from credit.fixture import structure_totals
from credit.scenarios import seed_scenarios

FINRA = "https://www.finra.org/finra-data/fixed-income/corp-and-agency"


def _by_id(packet: dict) -> dict[str, dict]:
    return {row["id"]: row for row in packet.get("fields") or []}


def _text(packet: dict, fid: str, fallback: str = "not found") -> str:
    row = _by_id(packet).get(fid)
    if not row:
        return fallback
    if row.get("status") == "not_public":
        return "not public"
    if row.get("status") == "not_found" or row.get("value") in (None, ""):
        return "not found"
    return str(row.get("value"))


def curve_of(packet: dict) -> dict[str, Decimal]:
    found = {}
    for row in packet.get("fields") or []:
        if row["id"].startswith("curve.") and usable(row):
            value = field_money(row)
            if value is not None:
                found[row["id"].split(".", 1)[1]] = value
    return found


def _instrument_row(row: dict) -> dict:
    amount = row.get("amount") or {}
    coupon = row.get("coupon") or {}
    maturity = row.get("maturity") or {}
    lien = row.get("lien") or {}
    return {
        "id": row["id"],
        "name": row.get("name"),
        "group": row.get("group"),
        "type": row.get("type"),
        "currency": row.get("currency"),
        "priority_rank": row.get("priority_rank"),
        "amount": amount.get("value"),
        "amount_confidence": amount.get("confidence"),
        "coupon": coupon.get("value"),
        "coupon_type": row.get("coupon_type") or "fixed",
        "index": row.get("index") or "",
        "maturity": maturity.get("value"),
        "maturity_confidence": maturity.get("confidence"),
        "maturity_notes": maturity.get("notes") or "",
        "lien": lien.get("value") if usable(lien) else "assumption",
        "lien_notes": lien.get("notes") or "",
        "source_url": (amount.get("source") or {}).get("url") or "",
        "source_name": (amount.get("source") or {}).get("name") or "",
        "call": "not public",
        "in_math": amount.get("confidence") not in {"low", "unconfirmed"} and amount.get("status") == "ok",
    }


def maturity_wall(instruments: list[dict]) -> list[dict]:
    buckets: dict[tuple[str, str], Decimal] = {}
    for row in instruments:
        if not row.get("in_math"):
            continue
        raw = str(row.get("maturity") or "")
        year = raw[:4]
        if not year.isdigit():
            continue
        amount = money(row.get("amount")) or D("0")
        key = (year, str(row.get("priority_rank")))
        buckets[key] = buckets.get(key, D("0")) + amount
    return [
        {"year": year, "priority": rank, "amount": str(amount)}
        for (year, rank), amount in sorted(buckets.items())
    ]


def _metrics(packet: dict) -> dict:
    fields = _by_id(packet)
    debt_lt = field_money(fields.get("pf.long_term_debt"))
    debt_st = field_money(fields.get("pf.current_debt"))
    cash = field_money(fields.get("pf.cash"))
    debt = debt_lt + debt_st if debt_lt is not None and debt_st is not None else None
    ebitda_with = field_money(fields.get("target.ebitda_with_synergies"))
    synergies = field_money(fields.get("target.synergies"))
    ebitda_without = ebitda_with - synergies if ebitda_with is not None and synergies is not None else None
    interest = field_money(fields.get("pf.interest_fy2025"))
    return {
        "debt": None if debt is None else str(debt),
        "cash": None if cash is None else str(cash),
        "bases": [
            {"id": "ltm", "label": "LTM from filings", "ebitda": None,
             "gross": None, "net": None, "reason": "Post-close LTM Adjusted EBITDA is not found. Only the pro forma GAAP lines and the company target are on file."},
            {"id": "no_synergies", "label": "2026E without synergies",
             "ebitda": None if ebitda_without is None else str(ebitda_without),
             "gross": leverage(debt, ebitda_without),
             "net": leverage(debt, ebitda_without, cash),
             "reason": "Derived: company 2026E Adjusted EBITDA minus the $6B synergy figure. Not a fact."},
            {"id": "with_synergies", "label": "2026E with synergies",
             "ebitda": None if ebitda_with is None else str(ebitda_with),
             "gross": leverage(debt, ebitda_with),
             "net": leverage(debt, ebitda_with, cash),
             "reason": "Company target, including synergies. A promise."},
        ],
        "interest": None if interest is None else str(interest),
        "interest_coverage": coverage(ebitda_without, interest),
    }


def _class_claim(rows: list[dict], group: str) -> Decimal:
    total = D("0")
    for row in rows:
        if row.get("group") == group and row.get("currency") == "USD" and row.get("in_math"):
            total += money(row.get("amount")) or D("0")
    return total


def build_view(packet: dict, overrides: dict | None = None) -> dict:
    overrides = overrides or {}
    instruments = [_instrument_row(row) for row in packet.get("instruments") or []]
    prices = overrides.get("prices") or {}
    curve = curve_of(packet)
    settlement = date(2026, 10, 5)
    quotes = []
    for row in instruments:
        if row["coupon_type"] != "fixed" or row["currency"] != "USD":
            quotes.append({**row, "ytm": None, "ytw": None, "g_spread_bp": None, "note": "Yield is computed for dollar fixed notes only."})
            continue
        clean = money((prices.get(row["id"]) or {}).get("clean_price"))
        if clean is None:
            quotes.append({**row, "ytm": None, "g_spread_bp": None, "note": "not found"})
            continue
        maturity_raw = str(row.get("maturity") or "")
        try:
            maturity = date.fromisoformat(maturity_raw[:10])
        except ValueError:
            quotes.append({**row, "ytm": None, "note": "maturity day is not public"})
            continue
        coupon = (money(row.get("coupon")) or D("0")) / D("100")
        solved = yield_to_worst(
            clean=clean, coupon=coupon, maturity=maturity, settlement=settlement,
            issue=settlement, frequency=2, call_status="not_public",
        )
        years = years_to_maturity(settlement, maturity)
        treasury = interpolate_treasury(curve, years)
        g = g_spread_bp(solved["ytm"], treasury)
        spread_decimal = None if g is None else g / D("10000")
        recovery = money(overrides.get("recovery")) or D("0.40")
        hazard = hazard_pd(spread_decimal, recovery, [D("1"), D("3"), D("5"), years]) if spread_decimal is not None else {"ok": False}
        el = expected_loss((hazard.get("pd") or {}).get("1"), recovery) if hazard.get("ok") else None
        call = verdict(spread=spread_decimal, expected_losses=[el] if el is not None else [])
        quotes.append({
            **row,
            "clean_price": str(clean),
            "ytm": None if solved["ytm"] is None else str((solved["ytm"] * D("100")).quantize(D("0.01"))),
            "ytw_note": solved["ytw_note"],
            "g_spread_bp": None if g is None else str(g),
            "treasury": None if treasury is None else str(treasury),
            "market_pd": {key: str(D(str(value)).quantize(D("0.0001"))) for key, value in (hazard.get("pd") or {}).items()} if hazard.get("ok") else {},
            "verdict": call["call"],
            "verdict_reason": call["reason"],
            "buy_spread_bp": None if call.get("buy_spread") is None else str((call["buy_spread"] * D("10000")).quantize(D("1"))),
            "assumption": solved["assumption"],
        })
    multiple = money(overrides.get("ev_multiple")) or D("6")
    admin = money(overrides.get("admin_pct")) or D("0.05")
    stressed = money(overrides.get("stressed_ebitda")) or money(_text(packet, "target.ebitda_with_synergies")) 
    # Default stressed EBITDA is management 2026E without synergies.
    fields = _by_id(packet)
    with_syn = field_money(fields.get("target.ebitda_with_synergies"))
    syn = field_money(fields.get("target.synergies"))
    if overrides.get("stressed_ebitda") in (None, ""):
        stressed = with_syn - syn if with_syn is not None and syn is not None else None
    classes = []
    if stressed is not None:
        classes = [
            {"id": "new_1l", "name": "New 1L notes", "priority_rank": 1,
             "claim": str(_class_claim(instruments, "new_1l")), "accrued": "0"},
            {"id": "tlb", "name": "Term loan B (lien assumed pari passu)", "priority_rank": 1,
             "claim": str(_class_claim(instruments, "tlb")), "accrued": "0",
             "assumption": "Lien versus the 1L notes is not public. Treated as the same class."},
            {"id": "new_2l", "name": "New 2L notes", "priority_rank": 2,
             "claim": str(_class_claim(instruments, "new_2l")), "accrued": "0"},
            {"id": "exchange", "name": "WBD exchange notes (2L)", "priority_rank": 2,
             "claim": str(_class_claim(instruments, "exchange")), "accrued": "0"},
        ]
        fall = waterfall(stressed_ebitda=stressed, multiple=multiple, admin_pct=admin, classes=classes, draw_revolver=True)
    else:
        fall = {"ev": None, "rows": [], "reason": "stressed EBITDA is missing"}
    oas = {
        key.replace("oas.", ""): _text(packet, key)
        for key in ("oas.ig", "oas.bbb", "oas.bb", "oas.b", "oas.hy", "oas.ccc")
    }
    issuer = packet.get("issuer") or {}
    return {
        "issuer": issuer,
        "badge": "Partly stale",
        "badge_reason": "Bond prices are not found and most new-note covenants are not public. The Treasury curve is the 2026-10-01 close.",
        "totals": structure_totals(packet),
        "instruments": instruments,
        "maturity_wall": maturity_wall(instruments),
        "metrics": _metrics(packet),
        "covenants": packet.get("covenants") or [],
        "quotes": quotes,
        "oas": oas,
        "oas_note": "The bond spread is a G-spread, not OAS. The bucket is the FRED ICE BofA series for 2026-10-01. A 3-year percentile is not loaded.",
        "waterfall": fall,
        "pd": {
            "rating": "reference table not loaded",
            "fundamental": "reference table not loaded",
            "market": "Enter a clean price. Market-implied PD uses that bond's G-spread.",
        },
        "scenarios": seed_scenarios(),
        "flags": packet.get("flags") or [],
        "finra_url": FINRA,
        "xbrl_maturities": _text(packet, "xbrl.maturities"),
        "identity": {
            "name": issuer.get("legal_name"),
            "cik": issuer.get("cik"),
            "ticker": _text(packet, "identity.ticker_now"),
            "ticker_next": _text(packet, "identity.ticker_next"),
            "name_change": _text(packet, "identity.name_change"),
            "close": _text(packet, "deal.expected_close"),
        },
    }
