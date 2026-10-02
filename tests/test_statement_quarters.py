"""Statement arrays: quarterly columns, TTM, and the balance-sheet chart."""
import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
BODY = ROOT / "api/domains/_financials_body.py"

_FUNCS = (
    "_stmt_line_value",
    "_plain_note",
    "_latest_text_block",
    "_debt_maturity_note",
    "_add_ebit_lines",
    "_cash_flow_with_total",
    "_place_operating_extras",
    "_statement_tables",
    "_stmt_tag_rows",
    "_latest_span",
    "_fact_float",
    "_anchor_spans",
    "_quarter_columns",
    "_cash_discrete_map",
    "_discrete_flow_value",
    "_instant_at",
    "_values_for_columns",
    "_append_ttm",
    "_quarterly_statement_tables",
)
_CONSTS = ("_STMT_SPECS", "_INCOME_ALWAYS", "_DEBT_MATURITY", "_STMT_ANCHORS")


def _ns():
    src = BODY.read_text(encoding="utf-8")
    tree = ast.parse(src)
    consts, funcs = [], []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in _FUNCS:
            seg = ast.get_source_segment(src, node)
            assert seg, node.name
            funcs.append(seg)
        elif isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if any(name in _CONSTS for name in names):
                seg = ast.get_source_segment(src, node)
                assert seg, names
                consts.append(seg)
    missing = [n for n in _FUNCS if f"def {n}(" not in "\n".join(funcs)]
    assert not missing, missing
    missing_c = [n for n in _CONSTS if not any(seg.startswith(n) or f"{n} =" in seg[:80] for seg in consts)]
    assert not missing_c, missing_c
    ns = {"re": __import__("re")}
    exec("\n\n".join(consts + funcs), ns)
    return ns


def _row(start, end, val, form="10-Q", fp="Q1", fy=2025, filed="2026-02-01"):
    return {
        "start": start, "end": end, "val": val, "form": form,
        "fp": fp, "fy": fy, "filed": filed,
    }


def _facts():
    """One fiscal year plus a prior fourth quarter. Q4'25 income is derived."""
    revenues = [
        _row("2024-01-01", "2024-12-31", 50, form="10-K", fp="FY", fy=2024, filed="2025-02-15"),
        _row("2024-10-01", "2024-12-31", 8, fp="Q4", fy=2024, filed="2025-02-15"),
        _row("2025-01-01", "2025-03-31", 10, fp="Q1", fy=2025, filed="2025-05-01"),
        _row("2025-04-01", "2025-06-30", 20, fp="Q2", fy=2025, filed="2025-08-01"),
        # Year-to-date decoy. Income must keep the three-month figure.
        _row("2025-01-01", "2025-06-30", 999, fp="Q2", fy=2025, filed="2025-08-01"),
        _row("2025-07-01", "2025-09-30", 30, fp="Q3", fy=2025, filed="2025-11-01"),
        _row("2025-01-01", "2025-12-31", 100, form="10-K", fp="FY", fy=2025, filed="2026-02-20"),
    ]
    ocf = [
        _row("2024-10-01", "2024-12-31", 4, fp="Q4", fy=2024),
        _row("2025-01-01", "2025-03-31", 5, fp="Q1", fy=2025),
        _row("2025-01-01", "2025-06-30", 12, fp="Q2", fy=2025),
        # Discrete decoy. Cash flow must use the longer year-to-date fact.
        _row("2025-04-01", "2025-06-30", 99, fp="Q2", fy=2025),
        _row("2025-01-01", "2025-09-30", 20, fp="Q3", fy=2025),
        _row("2025-01-01", "2025-12-31", 26, form="10-K", fp="FY", fy=2025, filed="2026-02-20"),
    ]
    assets = [
        {"end": "2024-12-31", "val": 90, "form": "10-K", "fp": "FY", "fy": 2024, "filed": "2025-02-15"},
        {"end": "2025-03-31", "val": 100, "form": "10-Q", "fp": "Q1", "fy": 2025, "filed": "2025-05-01"},
        {"end": "2025-06-30", "val": 110, "form": "10-Q", "fp": "Q2", "fy": 2025, "filed": "2025-08-01"},
        {"end": "2025-09-30", "val": 120, "form": "10-Q", "fp": "Q3", "fy": 2025, "filed": "2025-11-01"},
        {"end": "2025-12-31", "val": 130, "form": "10-K", "fp": "FY", "fy": 2025, "filed": "2026-02-20"},
    ]
    eps = [
        _row("2024-10-01", "2024-12-31", 0.10, fp="Q4", fy=2024),
        _row("2025-01-01", "2025-03-31", 0.20, fp="Q1", fy=2025),
        _row("2025-04-01", "2025-06-30", 0.30, fp="Q2", fy=2025),
        _row("2025-07-01", "2025-09-30", 0.40, fp="Q3", fy=2025),
        _row("2025-01-01", "2025-12-31", 1.20, form="10-K", fp="FY", fy=2025, filed="2026-02-20"),
    ]
    rnd = [
        _row("2025-01-01", "2025-03-31", 1, fp="Q1", fy=2025),
        _row("2025-04-01", "2025-06-30", 1, fp="Q2", fy=2025),
        _row("2025-07-01", "2025-09-30", 1, fp="Q3", fy=2025),
    ]
    us = {
        "Revenues": {"units": {"USD": revenues}},
        "NetIncomeLoss": {"units": {"USD": [dict(r) for r in revenues]}},
        "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": ocf}},
        "Assets": {"units": {"USD": assets}},
        "EarningsPerShareDiluted": {"units": {"USD/shares": eps}},
        "ResearchAndDevelopmentExpense": {"units": {"USD": rnd}},
    }
    return {"facts": {"us-gaap": us}}


def _line(lines, label):
    hit = [ln for ln in lines if ln.get("label") == label]
    assert len(hit) == 1, label
    return hit[0]["values"]


def test_annual_table_stays_on_fiscal_years():
    ns = _ns()
    annual = ns["_statement_tables"](_facts(), 5)
    assert annual["years"] == ["FY2024", "FY2025"]
    assert _line(annual["income"], "Revenue")[:2] == [50.0, 100.0]
    assert "TTM" not in annual["years"]


def test_quarterly_income_derives_q4_and_sums_ttm():
    ns = _ns()
    q = ns["_quarterly_statement_tables"](_facts(), 8)
    assert q["labels"] == ["Q4'24", "Q1'25", "Q2'25", "Q3'25", "Q4'25", "TTM"]
    revenue = _line(q["income"], "Revenue")
    assert revenue == [8.0, 10.0, 20.0, 30.0, 40.0, 100.0]
    # TTM is the last four quarters, not the older fourth quarter.
    assert abs(sum(revenue[1:5]) - revenue[-1]) < 1e-9
    eps = _line(q["income"], "Diluted EPS")
    assert abs(eps[-2] - 0.30) < 1e-9
    assert abs(eps[-1] - 1.20) < 1e-9
    rnd = _line(q["income"], "Research and development")
    assert rnd[-2] is None
    assert rnd[-1] is None


def test_cash_flow_uses_ytd_and_balance_sheet_ttm_is_the_latest_instant():
    ns = _ns()
    q = ns["_quarterly_statement_tables"](_facts(), 8)
    ocf = _line(q["cash_flow"], "Operating cash flow")
    assert ocf == [4.0, 5.0, 7.0, 8.0, 6.0, 26.0]
    assets = _line(q["balance"], "Total assets")
    assert assets == [90.0, 100.0, 110.0, 120.0, 130.0, 130.0]


def test_three_quarters_leave_the_flow_ttm_blank():
    ns = _ns()
    facts = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": [
        _row("2025-01-01", "2025-03-31", 10, fp="Q1"),
        _row("2025-04-01", "2025-06-30", 20, fp="Q2"),
        _row("2025-07-01", "2025-09-30", 30, fp="Q3"),
    ]}}}}}
    q = ns["_quarterly_statement_tables"](facts, 8)
    assert q["labels"] == ["Q1'25", "Q2'25", "Q3'25", "TTM"]
    assert _line(q["income"], "Revenue") == [10.0, 20.0, 30.0, None]


def test_balance_sheet_chart_and_quarterly_statement_tabs():
    charts = (ROOT / "web/gp-app/src/pages/financials/FundCharts.tsx").read_text()
    sheet = (ROOT / "web/gp-app/src/pages/financials/ValueLineSheet.tsx").read_text()
    body = BODY.read_text()
    assert charts.count("name: 'Net Income'") == 1
    assert "title: 'Balance sheet'" in charts
    assert "col(series, 'liabilities')" in charts
    assert '"liabilities": liab' in body
    assert 'total_liabilities' in body
    assert "recent quarters" in sheet
    assert "packLines(activePack, stmtView)" in sheet
    assert "No quarterly figures stored." in sheet
