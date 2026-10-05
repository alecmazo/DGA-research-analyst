"""Opening a high-yield name loads annual-report facts, not a made-up bond."""

from datetime import date
from decimal import Decimal

from api.domains.credit_analysis import _view_for
from credit.filing import (
    clear_filing_cache,
    filing_view,
    load_filing,
    parse_companyfacts,
)
from credit.fixture import CIK
from credit.screen import book_rows
from credit.universe import by_cik

CURVE = {
    "ok": True,
    "curve": {"10Y": Decimal("1.00")},
    "oas": {"hy": "3.10"},
    "treasury_as_of": "2026-10-02",
    "oas_as_of": "2026-10-02",
    "note": "Test curve as of 2026-10-02.",
}
ACCN = "0001193125-26-078266"
AS_OF = "2025-12-31"
FILED = "2026-02-27"


def _fact(val, end=AS_OF, form="10-K", fp="FY", fy=2025, filed=FILED, start=None, accn=ACCN):
    row = {"end": end, "val": val, "form": form, "fp": fp, "fy": fy, "filed": filed, "accn": accn}
    if start:
        row["start"] = start
    return row


def _facts(mapping: dict) -> dict:
    gaap = {}
    for tag, rows in mapping.items():
        unit = "pure" if not isinstance(rows, list) else "USD"
        if isinstance(rows, tuple):
            unit, rows = rows
        gaap[tag] = {"units": {unit: rows}}
    return {"facts": {"us-gaap": gaap}}


def _achc() -> dict:
    return _facts({
        "LongTermDebtNoncurrent": [_fact(2471529000)],
        "LongTermDebt": [_fact(2499967000)],
        "LongTermDebtCurrent": [_fact(28438000)],
        "CashAndCashEquivalentsAtCarryingValue": [_fact(133242000)],
        "InterestPaidNet": [_fact(124663000, start="2025-01-01")],
        "InterestExpense": [_fact(29769000, end="2012-12-31", fy=2012, filed="2013-03-01", start="2012-01-01")],
        "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo": [_fact(32500000)],
        "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree": [
            _fact(1000, end="2020-12-31", fy=2020, filed="2021-02-26"),
        ],
        "OperatingLeaseLiability": [_fact(143121000)],
        "LineOfCreditFacilityRemainingBorrowingCapacity": [
            _fact(46100000, end="2013-12-31", fy=2013, filed="2014-02-21"),
        ],
    })


def test_book_opens_a_filing_not_a_blank_screen():
    achc = next(row for row in book_rows() if row["ticker"] == "ACHC")
    assert achc["status"] == "filing"
    assert achc["coupon_high"] == ""
    assert next(row for row in book_rows() if row["ticker"] == "PSKY")["status"] == "structure"


def test_annual_report_lines_keep_missing_coupons_not_found():
    parsed = parse_companyfacts(_achc(), "0001520697")
    view = filing_view(by_cik("0001520697"), parsed, {"benchmarks": CURVE, "settlement": "2026-10-05"})
    assert view["mode"] == "filing"
    assert view["badge"] == "Filing details"
    assert view["metrics"]["debt"] == "2499.967"
    assert view["metrics"]["cash"] == "133.242"
    assert view["metrics"]["interest"] == [{
        "label": "Interest paid, net",
        "amount": "124.663",
        "as_of": AS_OF,
        "currency": "USD",
    }]
    assert view["metrics"]["interest_coverage"] is None
    names = [row["name"] for row in view["lines"]]
    assert names[:2] == ["Long-term borrowings", "Current portion of long-term debt"]
    assert "Operating lease liability" in names
    assert "Revolving credit, undrawn capacity" not in names
    assert all(row["coupon_note"] == "not found" for row in view["lines"])
    long = view["lines"][0]
    assert long["amount"] == "2471.529"
    assert long["in_total"] is True
    assert "Also tagged" not in long["note"]
    assert view["lines"][1]["amount"] == "28.438"
    assert view["lines"][1]["in_total"] is True
    assert view["schedule"] == [{
        "label": "Year 2",
        "amount": "32.5",
        "end": AS_OF,
        "currency": "USD",
    }]
    assert view["schedule_complete"] is False
    assert ACCN in view["lines"][0]["source_url"]
    assert view["waterfall"]["rows"] == []
    assert view["scenarios"] == []
    assert view["covenants"][0]["status"] == "not_found"
    assert "2026-10-01" not in view["curve_note"]
    assert view["oas"]["hy"] == "3.10"


def test_a_later_filing_replaces_the_earlier_value():
    facts = _facts({
        "LongTermDebtNoncurrent": [
            _fact(100000000, accn="0000000000-25-000001"),
            _fact(110000000, form="10-K/A", filed="2026-04-01", accn="0000000000-26-000002"),
        ],
    })
    parsed = parse_companyfacts(facts, "0001520697")
    assert parsed["lines"][0]["amount"] == "110"
    assert "0000000000-26-000002" in parsed["lines"][0]["source_url"]
    assert parsed["flags"] == []


def test_two_values_on_the_same_filing_day_are_not_averaged():
    facts = _facts({
        "LongTermDebtNoncurrent": [
            _fact(100000000),
            _fact(180000000),
        ],
        "LongTermDebt": [_fact(150000000)],
    })
    parsed = parse_companyfacts(facts, "0001108109")
    assert parsed["lines"][0]["name"] == "Long-term debt"
    assert parsed["lines"][0]["amount"] == "150"
    assert parsed["flags"][0]["flag_type"] == "conflict"
    assert "not shown" in parsed["flags"][0]["details"]


def test_another_tagged_total_is_named_and_not_added():
    facts = _facts({
        "LongTermNotesAndLoans": [_fact(14986000000)],
        "SeniorNotes": [_fact(16850000000)],
        "LongTermDebtCurrent": [_fact(1798000000)],
    })
    parsed = parse_companyfacts(facts, "0000818686")
    assert parsed["metrics"]["debt"] == "14986"
    assert parsed["lines"][0]["name"] == "Long-term notes and loans"
    assert "Senior notes $16850m" in parsed["lines"][0]["note"]
    assert parsed["lines"][1]["in_total"] is False
    assert "Not added" in parsed["lines"][1]["note"]


def test_twenty_f_is_an_annual_report():
    facts = _facts({
        "LongTermDebtNoncurrent": [_fact(500000000, form="20-F")],
    })
    parsed = parse_companyfacts(facts, "0000818686")
    assert parsed["lines"][0]["amount"] == "500"
    assert parsed["lines"][0]["form"] == "20-F"


def test_typed_bond_still_uses_the_floor():
    issuer = by_cik("0001108109")
    view = filing_view(issuer, parse_companyfacts(_achc(), issuer["cik"]), {
        "bonds": [{
            "id": "ig-1",
            "name": "Low coupon",
            "coupon": "3.40",
            "maturity": "2031-10-15",
            "clean_price": "100",
        }],
        "settlement": "2026-10-05",
        "benchmarks": CURVE,
    })
    assert view["mode"] == "filing"
    assert view["quotes"][0]["off_book"] is True
    assert "under 6%" in view["badge_reason"]
    assert view["lines"]


def test_failed_fetch_does_not_invent_a_bond(monkeypatch):
    def explode(_url):
        raise RuntimeError("down")

    clear_filing_cache()
    loaded = load_filing("0001520697", fetch=explode, today=date(2026, 10, 2))
    assert loaded["ok"] is False
    view = filing_view(by_cik("0001520697"), loaded["parsed"], load_note=loaded["note"])
    assert view["badge"] == "Filing unavailable"
    assert view["lines"] == []
    assert view["schedule"] == []
    assert "not found" in view["covenants"][0]["summary"] or view["covenants"][0]["status"] == "not_found"


def test_a_loaded_filing_is_cached_for_the_day():
    calls = {"n": 0}

    def fetch(_url):
        calls["n"] += 1
        return _achc()

    clear_filing_cache()
    day = date(2026, 10, 2)
    first = load_filing("0001520697", fetch=fetch, today=day)
    second = load_filing("0001520697", fetch=fetch, today=day)
    assert calls["n"] == 1
    assert first["parsed"]["metrics"]["debt"] == second["parsed"]["metrics"]["debt"] == "2499.967"
    load_filing("0001520697", fetch=fetch, today=date(2026, 10, 3))
    assert calls["n"] == 2
    clear_filing_cache()


def test_combined_debt_and_capital_lease_tag_is_the_long_term_line():
    """Transocean tags this line and does not tag LongTermDebt."""
    facts = _facts({
        "LongTermDebtAndCapitalLeaseObligations": [_fact(5212000000, filed="2026-02-23")],
        "LongTermDebtAndCapitalLeaseObligationsCurrent": [_fact(445000000, filed="2026-02-23")],
        "DebtAndCapitalLeaseObligations": [_fact(5657000000, filed="2026-02-23")],
        "DebtCurrent": [_fact(445000000, filed="2026-02-23")],
        "FinanceLeaseLiability": [_fact(220000000, filed="2026-02-23")],
        "OperatingLeaseLiability": [_fact(94000000, filed="2026-02-23")],
        "CashAndCashEquivalentsAtCarryingValue": [_fact(620000000, filed="2026-02-23")],
        "InterestPaidNet": [_fact(538000000, start="2025-01-01", filed="2026-02-23")],
    })
    parsed = parse_companyfacts(facts, "0001451505")
    view = filing_view(by_cik("0001451505"), parsed, {"benchmarks": CURVE, "settlement": "2026-10-06"})
    assert view["metrics"]["debt"] == "5657"
    assert "capital lease obligations plus the current portion" in view["metrics"]["debt_note"]
    long = view["lines"][0]
    current = view["lines"][1]
    assert long["name"] == "Long-term debt and capital lease obligations"
    assert long["amount"] == "5212"
    assert long["in_total"] is True
    assert long["coupon_note"] == "not found"
    assert "not added again" in long["note"]
    assert "5657" not in long["note"]
    assert current["name"] == "Current portion of long-term debt and capital lease obligations"
    assert current["amount"] == "445"
    assert current["in_total"] is True
    finance = next(row for row in view["lines"] if row["id"] == "lease.finance")
    assert finance["in_total"] is False
    assert view["schedule"] == []
    assert "did not tag a contractual maturity schedule" in view["badge_reason"]
    assert view["covenants"][0]["status"] == "not_found"


def test_a_pure_long_term_tag_still_wins_over_the_combined_line():
    facts = _facts({
        "LongTermDebtNoncurrent": [_fact(4000000000)],
        "LongTermDebtAndCapitalLeaseObligations": [_fact(4200000000)],
        "LongTermDebtCurrent": [_fact(100000000)],
    })
    parsed = parse_companyfacts(facts, "0001451505")
    assert parsed["lines"][0]["name"] == "Long-term borrowings"
    assert parsed["lines"][0]["amount"] == "4000"
    assert "Long-term debt and capital lease obligations $4200m" in parsed["lines"][0]["note"]
    assert parsed["metrics"]["debt"] == "4100"


def test_current_is_not_added_when_the_combined_line_already_is_the_total():
    facts = _facts({
        "LongTermDebtAndCapitalLeaseObligations": [_fact(5657000000)],
        "DebtAndCapitalLeaseObligations": [_fact(5657000000)],
        "DebtCurrent": [_fact(445000000)],
    })
    parsed = parse_companyfacts(facts, "0001451505")
    assert parsed["metrics"]["debt"] == "5657"
    assert parsed["lines"][1]["in_total"] is False
    assert parsed["flags"] == []


def test_paramount_stays_on_its_structure_and_other_names_load_the_filing(monkeypatch):
    def boom(_cik):
        raise AssertionError("companyfacts")

    monkeypatch.setattr("api.domains.credit_analysis.load_filing", boom)
    paramount = _view_for(CIK)
    assert paramount.get("mode") != "filing"
    assert paramount["identity"]["cik"] == CIK

    monkeypatch.setattr(
        "api.domains.credit_analysis.load_filing",
        lambda _cik: {"ok": True, "parsed": parse_companyfacts(_achc(), "0001520697"), "note": ""},
    )
    opened = _view_for("0001520697")
    assert opened["mode"] == "filing"
    assert opened["metrics"]["debt"] == "2499.967"
    assert opened["quotes"] == []
