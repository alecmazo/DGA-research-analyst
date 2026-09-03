"""IB table number formatting."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import ib_tables as ib


def test_money_millions_gets_dollar_and_commas():
    assert ib.format_ib_cell("Revenue ($M)", "1234.5", 1) == "$1,234.5"
    assert ib.format_ib_cell("Revenue ($M)", "1100.0", 1) == "$1,100.0"
    assert ib.format_ib_cell("Free Cash Flow ($M)", "906.1", 1) == "$906.1"
    # idempotent
    assert ib.format_ib_cell("Revenue ($M)", "$1,234.5", 1) == "$1,234.5"


def test_price_and_eps():
    assert ib.format_ib_cell("Diluted EPS", "1.65", 1) == "$1.65"
    assert ib.format_ib_cell("12M Price Target", "48", 1) == "$48.00"
    assert ib.format_ib_cell("Implied Value", "47.00", 1) == "$47.00"


def test_percent_and_multiple():
    assert ib.format_ib_cell("Gross Margin (%)", "22.5", 1) == "22.5%"
    assert ib.format_ib_cell("YoY Growth", "+12.3%", 1) == "+12.3%"
    assert ib.format_ib_cell("NTM P/E", "24", 1) == "24.0x"
    assert ib.format_ib_cell("EV/EBITDA", "14.0x", 1) == "14.0x"


def test_negatives_and_labels():
    assert ib.format_ib_cell("Net Income ($M)", "(123.4)", 1) == "($123.4)"
    assert ib.format_ib_cell("Metric", "Revenue ($M)", 0) == "Revenue ($M)"
    assert ib.format_ib_cell("Rating", "BUY", 1) == "BUY"
    assert ib.format_ib_cell("Discount Factor", "0.922", 1) == "0.922"


def test_format_md_tables_rewrites_body():
    md = """
| Metric | TTM | FY2025 |
|---|---|---|
| Revenue ($M) | 1100.0 | 1000 |
| Gross Margin (%) | 20.0 | 18.5 |
| Diluted EPS | 1.5 | 1.2 |
"""
    out = ib.format_md_tables_ib(md)
    assert "$1,100.0" in out
    assert "$1,000.0" in out or "$1,000" in out
    assert "20.0%" in out or "20%" in out
    assert "$1.50" in out
    # second pass unchanged
    assert ib.format_md_tables_ib(out) == out
