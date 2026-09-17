"""LULU-style debt: $0 notes + ASC 842 operating leases must fill Total/LTD.

Yahoo/GF report ~$1.8–2.1B of LULU "debt" that is entirely operating-lease
liabilities. Mapping only LongTermDebt / ShortTermBorrowings left the
financials sheet blank.
"""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sec_edgar_xbrl as edgar


def _facts(**tags):
    us = {}
    for tag, val in tags.items():
        us[tag] = {
            "units": {"USD": [{"end": "2026-02-01", "val": val, "filed": "2026-03-17"}]},
        }
    return {"facts": {"us-gaap": us}}


def _fill(facts):
    row = {}
    edgar._fill_debt_metrics(
        row, facts, lambda f: edgar._pick_instant_near(f, "2026-02-01"))
    return row


def test_lulu_zero_revolver_plus_leases():
    # FY2026 10-K: current lease 298.7m + noncurrent 1,499.7m; borrowings 0.
    facts = _facts(
        ShortTermBorrowings=0,
        OperatingLeaseLiabilityCurrent=298_724_000,
        OperatingLeaseLiabilityNoncurrent=1_499_717_000,
        OperatingLeaseLiability=1_798_441_000,
    )
    row = _fill(facts)
    assert row["LongTermDebt"] == 0.0
    assert row["ShortTermDebt"] == 0.0
    assert row["LeaseLiabilityNoncurrent"] == 1_499_717_000
    assert row["LeaseLiabilityCurrent"] == 298_724_000
    assert row["LeaseLiability"] == 1_798_441_000
    assert row["TotalDebt"] == 1_798_441_000


def test_notes_only_unchanged():
    facts = _facts(LongTermDebtNoncurrent=10_000_000_000, LongTermDebtCurrent=500_000_000)
    row = _fill(facts)
    assert row["LongTermDebt"] == 10_000_000_000
    assert row["ShortTermDebt"] == 500_000_000
    assert row["TotalDebt"] == 10_500_000_000


def test_notes_plus_leases_are_summed():
    facts = _facts(
        LongTermDebtNoncurrent=1_000_000_000,
        OperatingLeaseLiabilityNoncurrent=400_000_000,
        LongTermDebtCurrent=50_000_000,
        OperatingLeaseLiabilityCurrent=20_000_000,
    )
    row = _fill(facts)
    assert row["LongTermDebt"] == 1_000_000_000
    assert row["ShortTermDebt"] == 50_000_000
    assert row["LeaseLiabilityNoncurrent"] == 400_000_000
    assert row["LeaseLiabilityCurrent"] == 20_000_000
    assert row["LeaseLiability"] == 420_000_000
    assert row["TotalDebt"] == 1_470_000_000


def test_tag_lists_keep_notes_and_leases_separate():
    assert "OperatingLeaseLiabilityNoncurrent" not in edgar.TAG_PRIORITIES["LongTermDebt"]
    assert "OperatingLeaseLiabilityNoncurrent" in edgar.TAG_PRIORITIES["LeaseLiabilityNoncurrent"]
    assert "OperatingLeaseLiabilityCurrent" in edgar.TAG_PRIORITIES["LeaseLiabilityCurrent"]
    src = Path(edgar.__file__).read_text()
    assert "def _fill_debt_metrics" in src
    assert "_DEBT_LEASE_LT" in src


def test_excel_maps_also_list_leases():
    import excel_financials as xf
    ltd = " ".join(xf.CONCEPT_PRIORITIES["LongTermDebt"])
    leases = " ".join(xf.CONCEPT_PRIORITIES["LeaseLiabilityNoncurrent"])
    assert "OperatingLeaseLiabilityNoncurrent" not in ltd
    assert "OperatingLeaseLiabilityNoncurrent" in leases


def test_sheet_payload_has_lease_row():
    body = Path(ROOT / "api" / "domains" / "_financials_body.py").read_text()
    assert "Operating lease liabilities *" in body
    assert "Total Debt (borrowings + leases)" in body
    assert "def _backfill_store_debt_leases" in body
    assert "lease_liability_noncurrent" in body
