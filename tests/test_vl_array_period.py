"""Financials card: the statistical array follows annual vs quarterly."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BODY = ROOT / "api/domains/_financials_body.py"

_FUNCS = (
    "_dash_f",
    "_dash_leases_of",
    "_dash_borrowings_of",
    "_dash_debt_of",
    "_dash_cash_of",
    "_dash_invested_capital",
    "_dash_roic_of",
    "_vl_f",
    "_vl_pct",
    "_vl_ratio",
    "_vl_debt",
    "_vl_cash",
    "_vl_period_label",
    "_vl_yoy",
    "_vl_slice_block",
    "_vl_series_from_rows",
    "_vl_series_from_annuals",
)


def _ns():
    src = BODY.read_text(encoding="utf-8")
    tree = ast.parse(src)
    chunks = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in _FUNCS:
            seg = ast.get_source_segment(src, node)
            assert seg, node.name
            chunks.append(seg)
    missing = [n for n in _FUNCS if f"def {n}(" not in "\n".join(chunks)]
    assert not missing, missing
    ns = {"_DASH_TAX": 0.21}
    exec("\n\n".join(chunks), ns)
    return ns


def _row(rows, row_id):
    hit = [r for r in rows if r.get("id") == row_id]
    assert len(hit) == 1, row_id
    return hit[0]["values"]


def test_annual_growth_is_prior_year():
    ns = _ns()
    block = ns["_vl_series_from_annuals"]([
        {"fy": 2024, "revenue": 100, "operating_income": 10, "stockholders_equity": 100},
        {"fy": 2025, "revenue": 150, "operating_income": 10, "stockholders_equity": 100},
    ])
    assert block["labels"] == ["FY2024", "FY2025"]
    assert _row(block["rows"], "rev_yoy")[0] is None
    assert abs(_row(block["rows"], "rev_yoy")[1] - 50.0) < 1e-9
    # Annual ROIC is not multiplied by 4. NOPAT = 10 * 0.79, IC = 100.
    assert abs(_row(block["rows"], "roic")[1] - 7.9) < 1e-9


def test_quarterly_array_is_same_rows_and_yoy_lags_four():
    ns = _ns()
    periods = [
        ("Q1", 2025, 100),
        ("Q2", 2025, 80),
        ("Q3", 2025, 90),
        ("Q4", 2025, 110),
        ("Q1", 2026, 120),
        ("Q2", 2026, 100),
    ]
    rows = [
        {
            "fp": fp, "fy": fy, "revenue": rev,
            "operating_income": 10, "stockholders_equity": 100,
        }
        for fp, fy, rev in periods
    ]
    block = ns["_vl_series_from_rows"](rows, kind="quarter")
    assert block["labels"] == ["Q1'25", "Q2'25", "Q3'25", "Q4'25", "Q1'26", "Q2'26"]
    annual_ids = {r["id"] for r in ns["_vl_series_from_annuals"]([{"fy": 2024}])["rows"]}
    assert {r["id"] for r in block["rows"]} == annual_ids
    growth = _row(block["rows"], "rev_yoy")
    assert growth[:4] == [None, None, None, None]
    assert abs(growth[4] - 20.0) < 1e-9
    assert abs(growth[5] - 25.0) < 1e-9
    # Quarterly ROIC annualizes NOPAT (×4): 10 * 0.79 * 4 / 100.
    assert abs(_row(block["rows"], "roic")[-1] - 31.6) < 1e-9


def test_displayed_quarters_keep_yoy_from_the_longer_window():
    ns = _ns()
    # 12 quarters: the 4 before the displayed 8 supply same-quarter-last-year.
    rows = []
    for i, (fp, fy) in enumerate(
        [(fp, fy) for fy in (2024, 2025, 2026) for fp in ("Q1", "Q2", "Q3", "Q4")]
    ):
        rows.append({"fp": fp, "fy": fy, "revenue": 18 if i == 11 else (12 if i >= 4 else 10)})
    shown = ns["_vl_slice_block"](
        ns["_vl_series_from_rows"](rows, kind="quarter"), 8
    )
    assert shown["labels"][0] == "Q1'25"
    assert shown["labels"][-1] == "Q4'26"
    assert len(shown["labels"]) == 8
    growth = _row(shown["rows"], "rev_yoy")
    # Newest is Q4'26 vs Q4'25 (12 → 18), not vs the adjacent quarter.
    assert abs(growth[-1] - 50.0) < 1e-9
    assert abs(growth[0] - 20.0) < 1e-9
    assert all(v is not None for v in growth)


def test_colliding_quarter_labels_keep_both_period_ends():
    ns = _ns()
    block = ns["_vl_series_from_rows"]([
        {"fp": "Q3", "fy": 2025, "period_end": "2025-06-30", "revenue": 1},
        {"fp": "Q3", "fy": 2025, "period_end": "2025-09-30", "revenue": 2},
    ], kind="quarter")
    assert block["labels"] == ["Q3'25 2025-06", "Q3'25 2025-09"]


def test_financials_card_toggle_switches_the_array():
    sheet = (ROOT / "web/gp-app/src/pages/financials/ValueLineSheet.tsx").read_text()
    page = (ROOT / "web/gp-app/src/pages/FinancialsPage.tsx").read_text()
    dash = (ROOT / "web/gp-app/src/pages/financials/CompanyDashboard.tsx").read_text()
    body = BODY.read_text()
    assert "PeriodSeg" in sheet
    assert "Statistical array ({period === 'quarter' ? 'quarterly' : 'annual'})" in sheet
    assert "No quarterly figures stored." in sheet
    assert "Recent quarters" not in sheet
    assert "period={period}" in page and "setPeriod={setPeriod}" in page
    assert "void load(ticker || input, 'quarter')" not in dash
    assert "skipPeriodLoad" in dash
    assert 'kind="quarter"' in body
    assert "q_rev" not in body
