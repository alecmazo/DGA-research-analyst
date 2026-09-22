"""Debt maturity schedule is parsed from 10-K XBRL, not a live rewrite of the table."""
from sec_edgar_xbrl import maturity_rows_from_facts


def _fact(tag: str, val: float, end: str = "2025-09-27", fy: int = 2025):
    return {
        "end": end,
        "fy": fy,
        "fp": "FY",
        "form": "10-K",
        "filed": "2025-10-31",
        "val": val,
        "accn": "0001",
    }


def test_maturity_rows_keep_one_balance_sheet_date():
    facts = {
        "facts": {
            "us-gaap": {
                "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths": {
                    "units": {"USD": [_fact("y1", 10_000_000_000)]}
                },
                "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo": {
                    "units": {"USD": [_fact("y2", 8_000_000_000)]}
                },
                "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree": {
                    "units": {"USD": [
                        _fact("old", 1, end="2024-09-28", fy=2024),
                        _fact("y3", 7_000_000_000),
                    ]}
                },
                "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive": {
                    "units": {"USD": [_fact("after", 40_000_000_000)]}
                },
            }
        }
    }
    out = maturity_rows_from_facts(facts)
    labels = [r["label"] for r in out["rows"]]
    assert labels == ["Within 1 year", "Year 2", "Year 3", "Thereafter"]
    assert out["as_of"] == "2025-09-27"
    assert out["fy"] == 2025
    assert out["total"] == 65_000_000_000


def test_maturity_rows_empty_when_untagged():
    out = maturity_rows_from_facts({"facts": {"us-gaap": {}}})
    assert out["rows"] == []
    assert out["total"] is None
