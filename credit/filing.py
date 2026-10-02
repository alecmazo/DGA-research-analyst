"""Annual-report debt detail for a high-yield name. No named bond is invented.

SEC companyfacts has balance-sheet totals and the contractual maturity
schedule. It does not name each note, so a coupon, a rating, and a TRACE
price stay "not found". The desk still types those.
"""

from __future__ import annotations

import os
import threading
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from credit.market import current_benchmarks
from credit.present import FINRA
from credit.screen import screen_view
from credit.universe import BOOK, YIELD_FLOOR_PCT

FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
UA = "DGA-Capital-Research/credit (portfolio.dgacapital.com)"
NOT_LOADED = "SEC companyfacts did not load."

# (tag, label, current portion is additive)
_LONG = (
    ("LongTermDebtNoncurrent", "Long-term borrowings", True),
    ("LongTermDebt", "Long-term debt", False),
    ("LongTermNotesAndLoans", "Long-term notes and loans", False),
    ("LongTermNotesPayable", "Long-term notes payable", False),
    ("SeniorNotes", "Senior notes", False),
    ("NotesPayable", "Notes payable", False),
    ("UnsecuredDebt", "Unsecured debt", False),
    ("SecuredDebt", "Secured debt", False),
)
_CURRENT = (
    ("LongTermDebtCurrent", "Current portion of long-term debt"),
    ("DebtCurrent", "Debt, current"),
    ("ShortTermBorrowings", "Short-term borrowings"),
    ("CommercialPaper", "Commercial paper"),
    ("LinesOfCreditCurrent", "Line of credit, current"),
    ("OtherShortTermBorrowings", "Other short-term borrowings"),
    ("ConvertibleDebtCurrent", "Convertible debt, current"),
)
_CASH = (
    ("CashAndCashEquivalentsAtCarryingValue", "Cash and cash equivalents"),
    ("CashAndCashEquivalents", "Cash and cash equivalents"),
    ("Cash", "Cash"),
    ("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash, restricted cash, and equivalents"),
)
_INTEREST = (
    ("InterestExpense", "Interest expense"),
    ("InterestPaidNet", "Interest paid, net"),
    ("InterestIncomeExpenseNet", "Interest income (expense), net"),
)
_BUCKETS = (
    ("Within 1 year", (
        "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths",
        "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearOne",
    )),
    ("Year 2", ("LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo",)),
    ("Year 3", ("LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree",)),
    ("Year 4", ("LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour",)),
    ("Year 5", ("LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive",)),
    ("Thereafter", (
        "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive",
        "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearSixAndBeyond",
    )),
)
_MONEY_UNITS = ("USD", "EUR")

_lock = threading.Lock()
_cache: dict[str, tuple[str, dict]] = {}


def clear_filing_cache() -> None:
    with _lock:
        _cache.clear()


def _cik(value: str) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits.zfill(10)[-10:]


def _dec(value) -> Decimal | None:
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _text_amount(value: Decimal) -> str:
    quant = value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    text = format(quant, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def millions(value: Decimal) -> str:
    return _text_amount(value / Decimal("1000000"))


def _annual_form(row: dict) -> bool:
    form = str(row.get("form") or "")
    return form.startswith(("10-K", "20-F", "40-F")) and row.get("fp") == "FY"


def _duration_days(row: dict) -> int | None:
    try:
        start = date.fromisoformat(str(row.get("start"))[:10])
        end = date.fromisoformat(str(row.get("end"))[:10])
    except ValueError:
        return None
    return (end - start).days


def _rows(facts: dict | None, tag: str) -> tuple[str, list[dict]]:
    units = (((facts or {}).get("facts") or {}).get("us-gaap") or {}).get(tag, {}).get("units") or {}
    for unit in _MONEY_UNITS:
        rows = units.get(unit)
        if rows:
            return unit, list(rows)
    return "", []


def _index_url(cik: str, accn: str) -> str:
    accn = str(accn or "").strip()
    if not accn or not cik:
        return ""
    try:
        cik_n = str(int(cik))
    except ValueError:
        return ""
    return (
        f"https://www.sec.gov/Archives/edgar/data/{cik_n}/"
        f"{accn.replace('-', '')}/{accn}-index.html"
    )


def _pick(facts: dict | None, tag: str, as_of: str, *, duration: bool = False) -> dict | None:
    """Latest annual fact on as_of. A later filing replaces an earlier one.

    Two different values filed on the same day are a conflict, not an average.
    """
    unit, rows = _rows(facts, tag)
    chosen = []
    for row in rows:
        if not _annual_form(row):
            continue
        end = str(row.get("end") or "")[:10]
        if end != as_of:
            continue
        if duration:
            days = _duration_days(row)
            if days is None or not 340 <= days <= 380:
                continue
        val = _dec(row.get("val"))
        if val is None:
            continue
        chosen.append((row, val))
    if not chosen:
        return None
    latest = max(str(row.get("filed") or "") for row, _val in chosen)
    current = [(row, val) for row, val in chosen if str(row.get("filed") or "") == latest]
    values = {val for _row, val in current}
    if len(values) != 1:
        return {"conflict": True, "tag": tag, "end": as_of}
    row, val = current[-1]
    if not duration and val < 0:
        return {"negative": True, "tag": tag, "end": as_of}
    return {
        "tag": tag,
        "val": val,
        "unit": unit,
        "end": as_of,
        "form": str(row.get("form") or ""),
        "filed": str(row.get("filed") or ""),
        "accn": str(row.get("accn") or ""),
    }


def _latest_end(facts: dict | None, tags: tuple[str, ...]) -> str:
    found = ""
    for tag in tags:
        _unit, rows = _rows(facts, tag)
        for row in rows:
            if not _annual_form(row):
                continue
            end = str(row.get("end") or "")[:10]
            if len(end) == 10 and end > found and _dec(row.get("val")) is not None:
                found = end
    return found


def _source(cik: str, hit: dict) -> dict:
    url = _index_url(cik, hit.get("accn") or "")
    form = hit.get("form") or "Annual report"
    filed = hit.get("filed") or ""
    name = f"{form} filed {filed}" if filed else form
    return {"url": url, "name": name}


def _line(cik: str, row_id: str, name: str, hit: dict, *, in_total: bool, maturity_note: str, note: str = "") -> dict:
    source = _source(cik, hit)
    return {
        "id": row_id,
        "name": name,
        "amount": millions(hit["val"]),
        "currency": hit.get("unit") or "USD",
        "coupon_note": "not found",
        "maturity_note": maturity_note,
        "as_of": hit.get("end") or "",
        "form": hit.get("form") or "",
        "filed": hit.get("filed") or "",
        "tag": hit.get("tag") or "",
        "source_url": source["url"],
        "source_name": source["name"],
        "note": note,
        "in_total": in_total,
    }


def _skip_flag(label: str, as_of: str, hit: dict) -> dict:
    if hit.get("negative"):
        why = "is negative"
    else:
        why = "has more than one value"
    return {
        "flag_type": "conflict",
        "details": f"{label} {why} on {as_of}, so it is not shown.",
    }


def _alt_note(facts, tags, as_of, skip: set[str], match: set[str]) -> str:
    parts = []
    for tag, label, *_rest in tags:
        if tag in skip:
            continue
        hit = _pick(facts, tag, as_of)
        if not hit or hit.get("conflict") or hit.get("negative"):
            continue
        amount = millions(hit["val"])
        if amount in match:
            continue
        parts.append(f"{label} ${amount}m")
        if len(parts) == 3:
            break
    if not parts:
        return ""
    return "Also tagged and not added: " + "; ".join(parts) + "."


def _lease(facts, cik: str, as_of: str, total_tag: str, current_tag: str, long_tag: str, name: str, row_id: str) -> dict | None:
    hit = _pick(facts, total_tag, as_of)
    if hit and not hit.get("conflict") and not hit.get("negative"):
        return _line(
            cik, row_id, name, hit, in_total=False,
            maturity_note="A lease liability is not a bond maturity.",
            note="Not borrowings.",
        )
    current = _pick(facts, current_tag, as_of)
    long = _pick(facts, long_tag, as_of)
    if not current or not long or current.get("conflict") or long.get("conflict") or current.get("negative") or long.get("negative"):
        return None
    if current.get("unit") != long.get("unit"):
        return None
    combined = dict(long)
    combined["val"] = current["val"] + long["val"]
    combined["tag"] = total_tag
    return _line(
        cik, row_id, name, combined, in_total=False,
        maturity_note="A lease liability is not a bond maturity.",
        note="Current plus noncurrent. Not borrowings.",
    )


def parse_companyfacts(facts: dict | None, cik: str = "") -> dict:
    """Turn one companyfacts payload into filing lines. No network."""
    cik = _cik(cik)
    flags = []
    long_tags = tuple(tag for tag, _label, _add in _LONG)
    current_tags = tuple(tag for tag, _label in _CURRENT)
    as_of = _latest_end(facts, long_tags + current_tags)
    lines = []
    long_hit = None
    long_label = ""
    long_additive = False
    used_long = ""
    if as_of:
        for tag, label, additive in _LONG:
            hit = _pick(facts, tag, as_of)
            if hit and (hit.get("conflict") or hit.get("negative")):
                flags.append(_skip_flag(label, as_of, hit))
                continue
            if not hit:
                continue
            long_hit = hit
            long_label = label
            long_additive = additive
            used_long = tag
            break
        current_hit = None
        current_label = ""
        used_current = ""
        for tag, label in _CURRENT:
            hit = _pick(facts, tag, as_of)
            if hit and (hit.get("conflict") or hit.get("negative")):
                flags.append(_skip_flag(label, as_of, hit))
                continue
            if not hit:
                continue
            current_hit = hit
            current_label = label
            used_current = tag
            break
        if long_hit and current_hit and long_hit.get("unit") != current_hit.get("unit"):
            long_additive = False
        shown = set()
        if long_hit:
            shown.add(millions(long_hit["val"]))
            if current_hit and long_additive:
                shown.add(millions(long_hit["val"] + current_hit["val"]))
            note = _alt_note(facts, _LONG, as_of, {used_long}, shown)
            lines.append(_line(
                cik, "borrow.long", long_label, long_hit, in_total=True,
                maturity_note="This total has no single maturity. The schedule below is the contractual repayments.",
                note=note,
            ))
        if current_hit:
            add_current = bool(long_hit and long_additive)
            amount = millions(current_hit["val"])
            note = _alt_note(facts, tuple((tag, label) for tag, label in _CURRENT), as_of, {used_current}, {amount})
            if long_hit and not add_current:
                extra = "Not added to the long-term total. That total may already include the current portion."
                note = f"{extra} {note}".strip()
            lines.append(_line(
                cik, "borrow.current", current_label, current_hit, in_total=add_current or not long_hit,
                maturity_note="Current portion. Not a named bond.",
                note=note,
            ))
        lease = _lease(
            facts, cik, as_of,
            "OperatingLeaseLiability", "OperatingLeaseLiabilityCurrent", "OperatingLeaseLiabilityNoncurrent",
            "Operating lease liability", "lease.operating",
        )
        if lease:
            lines.append(lease)
        finance = _lease(
            facts, cik, as_of,
            "FinanceLeaseLiability", "FinanceLeaseLiabilityCurrent", "FinanceLeaseLiabilityNoncurrent",
            "Finance lease liability", "lease.finance",
        )
        if finance:
            lines.append(finance)
        for tag, label, note in (
            ("LineOfCreditFacilityRemainingBorrowingCapacity", "Revolving credit, undrawn capacity", "Unused capacity, not debt outstanding."),
            ("LineOfCreditFacilityMaximumBorrowingCapacity", "Revolving credit, commitment", "Commitment size, not debt outstanding."),
        ):
            hit = _pick(facts, tag, as_of)
            if not hit or hit.get("conflict") or hit.get("negative"):
                continue
            lines.append(_line(
                cik, "facility." + tag, label, hit, in_total=False,
                maturity_note="Not a bond maturity.",
                note=note,
            ))

    schedule = []
    schedule_end = as_of
    if not schedule_end:
        schedule_end = _latest_end(facts, tuple(tag for _label, tags in _BUCKETS for tag in tags))
    if schedule_end:
        for label, tags in _BUCKETS:
            hit = None
            conflicted = False
            for tag in tags:
                found = _pick(facts, tag, schedule_end)
                if found and found.get("conflict"):
                    conflicted = True
                    continue
                if found and not found.get("negative"):
                    hit = found
                    break
            if not hit:
                if conflicted:
                    flags.append({
                        "flag_type": "conflict",
                        "details": f"The {label.lower()} maturity bucket has more than one value on {schedule_end}, so it is not shown.",
                    })
                continue
            schedule.append({
                "label": label,
                "amount": millions(hit["val"]),
                "end": schedule_end,
                "currency": hit.get("unit") or "USD",
            })

    debt = None
    debt_note = ""
    borrowed = [row for row in lines if row.get("in_total")]
    if borrowed:
        debt = _text_amount(sum((Decimal(row["amount"]) for row in borrowed), Decimal("0")))
        if any(row["id"] == "borrow.long" for row in borrowed) and any(row["id"] == "borrow.current" for row in borrowed):
            debt_note = "Long-term borrowings plus the current portion."
        elif any(row["id"] == "borrow.current" for row in borrowed) and not any(row["id"] == "borrow.long" for row in borrowed):
            debt_note = "Only a current portion is tagged. Long-term borrowings were not tagged on this date."
        elif any(row.get("note") and "Not added" in row["note"] for row in lines):
            debt_note = "The current portion is shown and is not added."

    cash = None
    cash_label = ""
    if as_of:
        for tag, label in _CASH:
            hit = _pick(facts, tag, as_of)
            if not hit or hit.get("conflict") or hit.get("negative"):
                continue
            cash = millions(hit["val"])
            cash_label = label
            break

    interest = []
    if as_of:
        for tag, label in _INTEREST:
            hit = _pick(facts, tag, as_of, duration=True)
            if not hit or hit.get("conflict"):
                continue
            interest.append({
                "label": label,
                "amount": millions(hit["val"]),
                "as_of": as_of,
                "currency": hit.get("unit") or "USD",
            })

    anchor = None
    for row in lines:
        if row["id"] in {"borrow.long", "borrow.current"}:
            anchor = row
            break
    if anchor is None and schedule:
        anchor = {"form": "", "filed": "", "source_url": "", "source_name": "", "tag": ""}
    source = {
        "url": (anchor or {}).get("source_url") or (f"https://www.sec.gov/edgar/browse/?CIK={cik}&owner=exclude" if cik else ""),
        "name": (anchor or {}).get("source_name") or "EDGAR",
        "form": (anchor or {}).get("form") or "",
        "filed": (anchor or {}).get("filed") or "",
        "as_of": as_of or schedule_end or "",
    }
    return {
        "as_of": as_of or schedule_end or "",
        "lines": lines,
        "schedule": schedule,
        "schedule_complete": len(schedule) == len(_BUCKETS),
        "metrics": {
            "debt": debt,
            "debt_note": debt_note,
            "cash": cash,
            "cash_label": cash_label,
            "interest": interest,
        },
        "source": source,
        "flags": flags,
    }


def _default_fetch(url: str) -> dict:
    import requests
    agent = os.environ.get("SEC_USER_AGENT", "").strip() or UA
    response = requests.get(
        url,
        headers={"User-Agent": agent, "Accept": "application/json"},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("companyfacts was not an object")
    return payload


def load_filing(cik: str, *, fetch=None, today: date | None = None) -> dict:
    """Parsed annual-report detail. A success is cached for that calendar day."""
    key = _cik(cik)
    day = (today or date.today()).isoformat()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] == day:
            return hit[1]
    try:
        raw = (fetch or _default_fetch)(FACTS_URL.format(cik=key))
    except Exception:
        return {"ok": False, "parsed": None, "note": NOT_LOADED}
    if not isinstance(raw, dict):
        return {"ok": False, "parsed": None, "note": NOT_LOADED}
    result = {"ok": True, "parsed": parse_companyfacts(raw, key), "note": ""}
    with _lock:
        _cache[key] = (day, result)
    return result


def _oas(benchmarks: dict) -> dict:
    values = benchmarks.get("oas") or {}
    return {key: str(values.get(key) or "not loaded") for key in ("ig", "bbb", "bb", "b", "hy", "ccc")}


def filing_view(issuer: dict, parsed: dict | None, body: dict | None = None, load_note: str = "") -> dict:
    """Same desk cards as a loaded structure, filled only with filing facts."""
    body = body or {}
    base = screen_view(issuer, body)
    parsed = parsed or {}
    lines = list(parsed.get("lines") or [])
    schedule = list(parsed.get("schedule") or [])
    metrics = parsed.get("metrics") or {}
    source = parsed.get("source") or {}
    loaded = bool(lines or schedule or metrics.get("debt") or metrics.get("cash") or metrics.get("interest"))
    if load_note:
        badge = "Filing unavailable"
        reason = load_note
    elif loaded:
        badge = "Filing details"
        reason = (
            "Balances and the contractual maturity schedule are from the annual report. "
            "A named bond coupon, a rating, and a TRACE price are not in that file."
        )
    else:
        badge = "No debt balance tagged"
        reason = "The annual report in companyfacts did not tag a long-term debt balance or a maturity schedule."
    if base.get("badge") == "High yield":
        reason += " A typed bond clears the 6% floor."
    elif base.get("badge") == "Off the book":
        reason += " Every typed bond is under 6%."
    benchmarks = body.get("benchmarks") if isinstance(body.get("benchmarks"), dict) else current_benchmarks()
    curve_note = str(benchmarks.get("note") or base.get("curve_note") or "Treasury curve is not loaded.")
    sec_url = source.get("url") or base.get("sec_url")
    return {
        "mode": "filing",
        "book": BOOK,
        "floor_pct": YIELD_FLOOR_PCT,
        "badge": badge,
        "badge_reason": reason,
        "identity": base.get("identity") or {},
        "sec_url": sec_url,
        "finra_url": FINRA,
        "as_of": parsed.get("as_of") or "",
        "lines": lines,
        "schedule": schedule,
        "schedule_complete": bool(parsed.get("schedule_complete")),
        "source": source,
        "metrics": {
            "debt": metrics.get("debt"),
            "debt_note": metrics.get("debt_note") or "",
            "cash": metrics.get("cash"),
            "cash_label": metrics.get("cash_label") or "Cash",
            "interest": metrics.get("interest") or [],
            "interest_coverage": None,
        },
        "quotes": base.get("quotes") or [],
        "settlement": base.get("settlement"),
        "curve_as_of": base.get("curve_as_of") or "",
        "curve_note": curve_note,
        "oas": _oas(benchmarks),
        "oas_as_of": str(benchmarks.get("oas_as_of") or ""),
        "oas_note": "The bond spread is a G-spread, not OAS. " + curve_note,
        "recovery_note": "A typed bond uses a 40% recovery assumption. It is not an agency rating.",
        "covenants": [{
            "key": "debt_footnote",
            "label": "Debt footnote",
            "status": "not_found",
            "summary": "Covenant terms are not in the companyfacts file. Open the annual report for the note.",
            "source": {"url": sec_url, "name": source.get("name") or "EDGAR"},
        }],
        "waterfall": {
            "ev": None,
            "rows": [],
            "reason": "No named claim is in the companyfacts file, so no recovery is calculated.",
        },
        "pd": {
            "rating": "not found",
            "fundamental": "not found",
            "market": "Type a bond to see a market-implied figure. The filing does not include a TRACE price.",
        },
        "scenarios": [],
        "flags": parsed.get("flags") or [],
        "filing_note": "Figures are from the annual report, not a later quarterly filing.",
    }
