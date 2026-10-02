"""Treasury and OAS parses. No network."""

from datetime import date
from decimal import Decimal

from credit.market import (
    load_benchmarks,
    next_business_settlement,
    parse_fred_csv,
    parse_treasury_csv,
)

CURVE = """Date,1 Mo,2 Mo,3 Mo,4 Mo,6 Mo,1 Yr,2 Yr,3 Yr,5 Yr,7 Yr,10 Yr,20 Yr,30 Yr
10/01/2026,4.06,4.10,4.17,4.20,4.27,4.44,4.78,4.91,5.01,5.12,5.24,5.64,5.61
10/02/2026,4.10,4.12,4.20,4.22,4.30,4.50,4.80,4.95,5.05,5.15,5.30,5.70,5.66
"""


def test_settlement_rolls_off_the_weekend():
    assert next_business_settlement(date(2026, 10, 2)) == date(2026, 10, 5)
    assert next_business_settlement(date(2026, 10, 3)) == date(2026, 10, 5)
    assert next_business_settlement(date(2026, 10, 5)) == date(2026, 10, 6)


def test_treasury_csv_uses_the_latest_complete_row():
    parsed = parse_treasury_csv(CURVE)
    assert parsed is not None
    as_of, curve = parsed
    assert as_of == "2026-10-02"
    assert curve["10Y"] == Decimal("5.30")
    assert curve["1M"] == Decimal("4.10")
    assert "2M" not in curve


def test_fred_csv_skips_a_missing_day():
    text = "DATE,BAMLH0A0HYM2\n2026-10-01,3.24\n2026-10-02,.\n"
    assert parse_fred_csv(text) == ("2026-10-01", "3.24")


def test_load_benchmarks_reads_the_fetcher():
    def fetch(url: str) -> str:
        if "treasury" in url:
            return CURVE
        return "DATE,VALUE\n2026-10-02,2.50\n"

    loaded = load_benchmarks(date(2026, 10, 2), fetch=fetch)
    assert loaded["ok"] is True
    assert loaded["treasury_as_of"] == "2026-10-02"
    assert loaded["curve"]["10Y"] == Decimal("5.30")
    assert loaded["oas"]["hy"] == "2.50"
    assert loaded["oas_as_of"] == "2026-10-02"
    assert "2026-10-01" not in loaded["note"]


def test_failed_fetch_stays_missing():
    def fetch(url: str) -> str:
        raise OSError(url)

    loaded = load_benchmarks(date(2026, 10, 2), fetch=fetch)
    assert loaded["ok"] is False
    assert loaded["curve"] == {}
    assert loaded["oas"] == {}
    assert "not loaded" in loaded["note"]
    assert "2026-10-01" not in loaded["note"]
