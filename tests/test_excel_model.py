"""Unit tests for the IB-style saved-report Excel model."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import excel_model as em


SAMPLE_MD = """
# SECTION 1 — Executive Summary
Overall rating: **Buy**
12-month price target: **$48.00**
Current Price: $40.00
Implied upside: 20.0%

Acme is the low-cost producer in widgets with a widening moat.

# SECTION 3 — Financial Deep Dive

| Metric | TTM (as of 2025-12-31) | FY2025 (ended 2025-12-31) | FY2024 (ended 2024-12-31) |
|---|---|---|---|
| Revenue ($M) | 1100.0 | 1000.0 | 900.0 |
| Operating Income ($M) | 220.0 | 200.0 | 160.0 |
| Net Income ($M) | 165.0 | 150.0 | 120.0 |
| Diluted EPS | 1.65 | 1.50 | 1.20 |

# SECTION 4 — Growth Analysis

| Metric | FY2026E | FY2027E | FY2028E |
|---|---|---|---|
| Revenue ($M) | 1200.0 | 1320.0 | 1450.0 |
| Operating Income ($M) | 250.0 | 285.0 | 320.0 |
| Net Income ($M) | 190.0 | 215.0 | 245.0 |
| Diluted EPS | 1.90 | 2.15 | 2.45 |
| Free Cash Flow ($M) | 180.0 | 210.0 | 240.0 |

# SECTION 5 — Valuation

WACC 8.5%. Terminal growth 2.5%. Implied share price $47.00.
Enterprise value $9,400m.

| Method | Value | Weight |
|---|---|---|
| DCF | $47.00 | 60% |
| Comps | $50.00 | 40% |

| Ticker | P/E | EV/EBITDA | FCF yield |
|---|---|---|---|
| ACME | 24.0x | 14.0x | 4.5% |
| PEER | 22.0x | 13.0x | 5.0% |

# SECTION 7.5 — Institutional Analyst Consensus

| Firm | Rating | 12M Price Target | Upside vs Current | Date | Action |
|---|---|---|---|---|---|
| Goldman Sachs | Buy | $52.00 | 30.0% | 2026-01-15 | Maintain |
| Morgan Stanley | Overweight | $49.00 | 22.5% | 2026-01-10 | Raise |

# SECTION 8 — The Verdict
Bull case: Price target $62 (30% probability)
Base case: Price target $48 (50% probability)
Bear case: Price target $28 (20% probability)
"""


def _financials():
    return {
        "ticker": "ACME",
        "entity_name": "Acme Widget Corp",
        "source": "company_financials_db",
        "annuals": [
            {
                "fy": 2025, "end": "2025-12-31",
                "Revenue": 1_000_000_000, "OperatingIncome": 200_000_000,
                "NetIncome": 150_000_000, "DilutedEPS": 1.50,
                "DilutedShares": 100_000_000, "FreeCashFlow": 140_000_000,
                "Cash": 80_000_000, "TotalDebt": 200_000_000,
                "StockholdersEquity": 500_000_000, "TotalAssets": 900_000_000,
                "EBITDA": 250_000_000, "OperatingCashFlow": 180_000_000,
                "CapEx": -40_000_000, "GrossProfit": 400_000_000,
                "GrossMargin": 0.40, "OperatingMargin": 0.20, "NetMargin": 0.15,
            },
            {
                "fy": 2024, "end": "2024-12-31",
                "Revenue": 900_000_000, "OperatingIncome": 160_000_000,
                "NetIncome": 120_000_000, "DilutedEPS": 1.20,
                "DilutedShares": 100_000_000, "FreeCashFlow": 110_000_000,
                "Cash": 60_000_000, "TotalDebt": 210_000_000,
                "StockholdersEquity": 420_000_000, "TotalAssets": 820_000_000,
                "EBITDA": 210_000_000, "OperatingCashFlow": 150_000_000,
                "CapEx": -40_000_000, "GrossProfit": 350_000_000,
            },
        ],
        "ttm": {
            "end": "2025-12-31", "method": "bridge",
            "Revenue": 1_100_000_000, "NetIncome": 165_000_000,
            "OperatingIncome": 220_000_000, "FreeCashFlow": 155_000_000,
            "DilutedEPS": 1.65, "Cash": 80_000_000, "TotalDebt": 200_000_000,
        },
        "quarterly": {
            "current": {
                "fy": 2025, "fp": "Q4", "end": "2025-12-31",
                "Revenue": 280_000_000, "NetIncome": 42_000_000, "DilutedEPS": 0.42,
            },
            "prior_year_same_q": {
                "fy": 2024, "fp": "Q4", "end": "2024-12-31",
                "Revenue": 250_000_000, "NetIncome": 35_000_000, "DilutedEPS": 0.35,
            },
        },
    }


def test_parse_cell_number():
    assert em.parse_cell_number("$1,234.5") == 1234.5
    assert em.parse_cell_number("(123.4)") == -123.4
    assert em.parse_cell_number("12.5%") == 0.125
    assert em.parse_cell_number("N/A") is None
    assert em.parse_cell_number("—") is None
    assert em.parse_cell_number("$9.4bn") == 9400.0


def test_parse_tables_and_forecasts():
    tables = em.parse_md_tables(SAMPLE_MD)
    assert len(tables) >= 4
    fc = em.extract_forecasts(tables)
    assert 2026 in fc and 2027 in fc
    assert fc[2026]["Revenue"] == 1200.0
    assert fc[2026]["DilutedEPS"] == 1.90
    street = em.extract_street_table(tables)
    assert street and street["rows"][0][0].startswith("Goldman")


def test_dcf_and_scenarios():
    dcf = em.extract_dcf(SAMPLE_MD)
    assert abs(dcf["wacc"] - 0.085) < 1e-9
    assert abs(dcf["terminal_growth"] - 0.025) < 1e-9
    assert dcf["implied_price"] == 47.0
    sc = em.extract_scenarios(SAMPLE_MD)
    cases = {r["case"]: r for r in sc}
    assert cases["Bull"]["price_target"] == 62.0
    assert cases["Base"]["price_target"] == 48.0
    assert abs(cases["Bull"]["probability"] - 0.30) < 1e-9


def test_workbook_sheets_and_pro_forma(tmp_path):
    import openpyxl
    from io import BytesIO

    raw = em.build_ib_model_bytes(
        "ACME",
        financials=_financials(),
        report_md=SAMPLE_MD,
        summary={
            "rating": "Buy",
            "price_target": 48.0,
            "current_price": 40.0,
            "upside_pct": 20.0,
            "thesis": "Low-cost producer with a widening moat.",
            "sector": "Industrials",
        },
        quote={"price": 40.0},
        engine="Rock",
        entity_name="Acme Widget Corp",
        source="unit test",
        dropbox_note="Dropbox: /Reports/ACME_DGA_Model.xlsx",
        generated_at="2026-09-02",
    )
    assert raw[:2] == b"PK"
    wb = openpyxl.load_workbook(BytesIO(raw), data_only=False)
    names = set(wb.sheetnames)
    assert names >= {
        "Cover", "Financial Model", "Valuation", "Scenarios", "Street", "Quarterly",
    }
    model = wb["Financial Model"]
    headers = [model.cell(5, c).value for c in range(1, 12) if model.cell(5, c).value]
    assert "FY2024A" in headers
    assert "FY2025A" in headers
    assert any(str(h).startswith("FY2026E") for h in headers)
    # Revenue actuals are in $ millions
    # Find revenue row
    rev_row = None
    for r in range(1, 40):
        if model.cell(r, 1).value == "Revenue":
            rev_row = r
            break
    assert rev_row
    # FY2024A is first year col (col 2)
    assert model.cell(rev_row, 2).value == 900.0
    # Estimate year present and blue-input
    fy26_col = headers.index("FY2026E") + 1
    assert model.cell(rev_row, fy26_col).value == 1200.0
    cover = wb["Cover"]
    assert "DGA CAPITAL" in str(cover["A1"].value)
    assert cover["A7"].value == "Buy"
    val = wb["Valuation"]
    # WACC input on valuation
    found_wacc = False
    for r in range(1, 40):
        if val.cell(r, 1).value == "WACC":
            found_wacc = True
            assert abs(val.cell(r, 2).value - 0.085) < 1e-9
    assert found_wacc
    street = wb["Street"]
    blob = " ".join(
        str(street.cell(r, c).value or "")
        for r in range(1, 20) for c in range(1, 6)
    )
    assert "Goldman" in blob
    sc = wb["Scenarios"]
    cases = [sc.cell(r, 1).value for r in range(5, 10)]
    assert "Bull" in cases and "Base" in cases and "Bear" in cases


def test_to_model_units():
    assert em.to_model_units("Revenue", 1_000_000_000) == 1000.0
    assert em.to_model_units("DilutedEPS", 1.5) == 1.5
    assert em.to_model_units("DilutedShares", 100_000_000) == 100.0
    assert em.to_model_units("GrossMargin", 0.4) == 0.4
    assert em.to_model_units("Revenue", 1200.0, already_millions=True) == 1200.0
