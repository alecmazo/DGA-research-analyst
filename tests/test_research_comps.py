"""Store comps tables use last-reported FY, not (E) / NTM estimates."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import research_comps as rc
import tests.test_excel_model as em_tests


SAMPLE_PEERS = {
    "ticker": "UBER",
    "note": "Last reported FY from company_financials; live last price.",
    "peers": [
        {
            "ticker": "UBER", "name": "Uber", "is_subject": True,
            "price": 75.76, "market_cap_m": 155325, "ev_m": 163178,
            "pe": 16.0, "ev_ebitda": 22.4, "ev_sales": 3.5,
            "fcf_yield": 0.063, "rev_yoy_pct": 18.2, "fy": 2025,
        },
        {
            "ticker": "LYFT", "name": "Lyft", "is_subject": False,
            "price": 14.20, "market_cap_m": 5500, "ev_m": 6200,
            "pe": 22.0, "ev_ebitda": 11.0, "ev_sales": 1.2,
            "fcf_yield": 0.04, "rev_yoy_pct": 12.0, "fy": 2025,
        },
    ],
}


def test_markdown_table_is_actuals_not_estimates():
    md = rc.format_markdown_table(SAMPLE_PEERS)
    body = "\n".join(
        ln for ln in md.splitlines()
        if ln.startswith("|") and "Ticker" not in ln and "---" not in ln
    )
    assert "(E)" not in body
    assert "NTM" not in body.upper()
    assert "company_financials" in md
    assert "**UBER**" in md
    assert "LYFT" in md
    assert "155,325" in md or "155325" in md


def test_replace_swaps_report_comps_table():
    text = rc.replace_in_report(em_tests.SAMPLE_MD, "ACME", data=SAMPLE_PEERS)
    assert "PEER" not in text
    assert "LYFT" in text
    assert "| ACME | 24.0x |" not in text


def test_excel_valuation_uses_store_comps_not_report_e():
    import excel_model as em
    import research_comps as rc_mod

    real_load = rc_mod.load
    rc_mod.load = lambda ticker, limit=8: SAMPLE_PEERS
    try:
        from io import BytesIO
        import openpyxl
        raw = em.build_ib_model_bytes(
            "UBER",
            financials=em_tests._financials(),
            report_md=em_tests.SAMPLE_MD,
            summary={"rating": "Buy", "price_target": 105.0, "current_price": 75.76},
            quote={"price": 75.76},
        )
        wb = openpyxl.load_workbook(BytesIO(raw), data_only=False)
        val = wb["Valuation"]
        blob = " ".join(
            str(val.cell(r, c).value or "")
            for r in range(1, 120) for c in range(1, 12)
        )
        assert "company_financials" in blob
        assert "NTM/E" in blob or "not NTM" in blob
        assert "LYFT" in blob
        assert "COMPARABLE COMPANIES (FROM REPORT)" not in blob
    finally:
        rc_mod.load = real_load


def test_comps_header_detector():
    assert rc._is_comps_header("| Ticker | P/E | EV/EBITDA | FCF yield |")
    assert rc._is_comps_header(
        "| Company | Ticker | Mkt Cap ($Bn) | NTM P/E | NTM EV/EBITDA |"
    )
    assert not rc._is_comps_header("| Firm | Rating | 12M Price Target | Date |")
    assert not rc._is_comps_header("| Method | Implied Value | Weight |")
