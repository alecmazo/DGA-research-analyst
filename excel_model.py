"""
IB-style Excel model for a saved DGA research report.

Produces a Goldman / MS / BofA-style workbook:

  Cover            — rating, 12m PT, capital structure, thesis
  Financial Model  — historicals (A) + TTM + pro forma (E), 3-statement
  Valuation        — trading multiples, DCF, target bridge, peer comps
  Scenarios        — bull / base / bear + expected value
  Street           — sell-side consensus table from the report
  Quarterly        — last eight reported quarters

Historicals come from company_financials (dollars). Forward / pro forma
numbers and valuation assumptions are parsed from the saved report
markdown. Estimate cells are Excel-blue; actuals are black.

Public API
----------
    path = write_ib_model(ticker, output_path, *, financials, report_md, ...)
    raw  = build_ib_model_bytes(...)
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ── Colors (DGA navy + classic IB worksheet) ────────────────────────────────
NAVY = "0A1628"
GOLD = "C9A84C"
WHITE = "FFFFFF"
INK = "0F172A"
MUTED = "64748B"
BLUE_EST = "0070C0"       # forecast / estimate font
YELLOW = "FFF2CC"         # input cells
SECTION = "1E3A5F"
ROW_ALT = "F8FAFC"
LINE = "CBD5E1"
GREEN_POS = "166534"
RED_NEG = "B91C1C"
PALE_GOLD = "FBF6E8"
PALE_NAVY = "E8EEF5"


# ── Markdown / number parsing ───────────────────────────────────────────────
_NUM_RE = re.compile(
    r"^\s*\(?\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]*\.[0-9]+|[0-9]+)"
    r"\s*(%|x|×|bn|b|mm|m|k)?\s*\)?\s*$",
    re.I,
)
_YEAR_RE = re.compile(r"(20\d{2})")
_FY2_RE = re.compile(r"FY\s*'?(\d{2})\b", re.I)


def _strip_md(cell: str) -> str:
    s = (cell or "").strip()
    s = s.replace("\u00a0", " ").replace("**", "").replace("__", "")
    s = re.sub(r"</?[^>]+>", "", s)
    s = s.strip(" *")
    return s


def parse_cell_number(raw: str) -> Optional[float]:
    """Parse an IB-table cell into a float.

    Percents become fractions (12.5% → 0.125). Trailing x is kept as the
    multiple. $ / commas / accounting (123.4) negatives are handled.
    """
    s = _strip_md(raw)
    if not s or s in ("—", "–", "-", "N/A", "n/a", "NA", "nm", "NM", "."):
        return None
    neg = s.startswith("(") and s.endswith(")")
    if s.startswith("-") or s.startswith("−"):
        neg = True
        s = s.lstrip("-−")
    m = _NUM_RE.match(s.replace("−", "-"))
    if not m:
        return None
    try:
        val = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    unit = (m.group(2) or "").lower()
    if unit == "%":
        val = val / 100.0
    elif unit in ("bn", "b"):
        val = val * 1000.0          # model is $ millions
    elif unit == "k":
        val = val / 1000.0
    if neg:
        val = -abs(val)
    return val


def parse_md_tables(md: str) -> list[dict[str, Any]]:
    """Return GitHub-flavored markdown tables with a nearby heading."""
    if not md:
        return []
    lines = md.replace("\r\n", "\n").split("\n")
    tables: list[dict[str, Any]] = []
    heading = ""
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        hm = re.match(r"^\s{0,3}#{1,4}\s+(.+?)\s*$", line)
        if hm:
            heading = _strip_md(hm.group(1))
            i += 1
            continue
        if "|" not in line:
            i += 1
            continue
        block = [line]
        j = i + 1
        while j < n and "|" in lines[j]:
            block.append(lines[j])
            j += 1
        parsed = _table_from_lines(block)
        if parsed and len(parsed["headers"]) >= 2 and parsed["rows"]:
            parsed["title"] = heading
            tables.append(parsed)
        i = j
    return tables


def _split_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [_strip_md(c) for c in s.split("|")]


def _is_sep_row(cells: list[str]) -> bool:
    if not cells:
        return False
    return all(re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) or not c for c in cells)


def _table_from_lines(block: list[str]) -> Optional[dict[str, Any]]:
    rows = [_split_row(ln) for ln in block if ln.strip()]
    rows = [r for r in rows if any(c for c in r)]
    if len(rows) < 2:
        return None
    headers = rows[0]
    body = rows[1:]
    if body and _is_sep_row(body[0]):
        body = body[1:]
    width = len(headers)
    body = [(r + [""] * width)[:width] for r in body]
    if not body:
        return None
    return {"headers": headers, "rows": body}


def _col_is_estimate(header: str) -> bool:
    h = (header or "").strip()
    if re.search(r"(20\d{2}|FY\s*'?\d{2,4})\s*E\b", h, re.I):
        return True
    if re.search(r"\b(est\.?|fwd|forward|ntm|n?tm|proj(?:ection|ected)?|pf|pro\s*forma)\b", h, re.I):
        return True
    return False


def _col_is_ttm(header: str) -> bool:
    return bool(re.search(r"\b(ttm|ltm)\b", header or "", re.I))


def _year_from_header(header: str) -> Optional[int]:
    h = header or ""
    m = _YEAR_RE.search(h)
    if m:
        return int(m.group(1))
    m = _FY2_RE.search(h)
    if m:
        return 2000 + int(m.group(1))
    return None


_METRIC_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^(total\s+)?revenue|^net sales|^sales\b|^revenues", re.I), "Revenue"),
    (re.compile(r"cost of (revenue|goods|sales)|^cogs", re.I), "CostOfRevenue"),
    (re.compile(r"^gross profit", re.I), "GrossProfit"),
    (re.compile(r"^gross margin", re.I), "GrossMargin"),
    (re.compile(r"operating income|^ebit\b|^op(?:erating)?\.?\s*inc", re.I), "OperatingIncome"),
    (re.compile(r"operating margin|^ebit margin|^op(?:erating)?\.?\s*margin", re.I), "OperatingMargin"),
    (re.compile(r"^ebitda\b(?! margin)", re.I), "EBITDA"),
    (re.compile(r"^ebitda margin", re.I), "EBITDAMargin"),
    (re.compile(r"^net income|^net profit|^earnings\b", re.I), "NetIncome"),
    (re.compile(r"net (profit )?margin", re.I), "NetMargin"),
    (re.compile(r"diluted eps|^eps\b|earnings per share", re.I), "DilutedEPS"),
    (re.compile(r"diluted shares|shares outstanding|share count", re.I), "DilutedShares"),
    (re.compile(r"free cash flow|^fcf\b", re.I), "FreeCashFlow"),
    (re.compile(r"operating cash flow|^ocf\b|cash from ops", re.I), "OperatingCashFlow"),
    (re.compile(r"^capex|capital expend", re.I), "CapEx"),
    (re.compile(r"cash (&|and) (cash )?equiv|cash & st|cash\b", re.I), "Cash"),
    (re.compile(r"total debt|^debt\b", re.I), "TotalDebt"),
    (re.compile(r"net debt", re.I), "NetDebt"),
    (re.compile(r"total assets", re.I), "TotalAssets"),
    (re.compile(r"stockholders.? equity|shareholders.? equity|^equity\b", re.I), "StockholdersEquity"),
    (re.compile(r"^dividends\b", re.I), "Dividends"),
    (re.compile(r"buyback|share repo", re.I), "BuybacksCash"),
]


def _metric_from_label(label: str) -> Optional[str]:
    s = _strip_md(label)
    s = re.sub(r"\s*\(\$?m(?:illions)?\)\s*$", "", s, flags=re.I)
    s = re.sub(r"\s*\(\$\)\s*$", "", s)
    for pat, key in _METRIC_PATTERNS:
        if pat.search(s):
            return key
    return None


def extract_forecasts(tables: list[dict]) -> dict[int, dict[str, float]]:
    """Map fiscal year → metric → value for estimate columns only."""
    out: dict[int, dict[str, float]] = {}
    for tbl in tables:
        headers = tbl.get("headers") or []
        for col_i, h in enumerate(headers):
            if col_i == 0:
                continue
            if not _col_is_estimate(h):
                continue
            year = _year_from_header(h)
            if year is None:
                continue
            bucket = out.setdefault(year, {})
            for row in tbl.get("rows") or []:
                if not row:
                    continue
                key = _metric_from_label(row[0] if row else "")
                if not key or col_i >= len(row):
                    continue
                val = parse_cell_number(row[col_i])
                if val is None:
                    continue
                bucket[key] = val
    return out


def extract_dcf(md: str) -> dict[str, Any]:
    text = md or ""
    out: dict[str, Any] = {}

    def _pct(pat: str) -> Optional[float]:
        m = re.search(pat, text, re.I)
        if not m:
            return None
        try:
            return float(m.group(1)) / 100.0
        except ValueError:
            return None

    def _money(pat: str) -> Optional[float]:
        m = re.search(pat, text, re.I)
        if not m:
            return None
        try:
            val = float(m.group(1).replace(",", ""))
        except ValueError:
            return None
        unit = (m.group(2) or "").lower() if m.lastindex and m.lastindex >= 2 else ""
        if unit in ("bn", "b"):
            val *= 1000.0
        return val

    out["wacc"] = _pct(r"\bWACC\b[^%]{0,48}?(\d+(?:\.\d+)?)\s*%")
    out["terminal_growth"] = _pct(
        r"terminal\s+growth(?:\s+rate)?[^%]{0,48}?(\d+(?:\.\d+)?)\s*%"
    )
    out["tax_rate"] = _pct(r"(?:tax\s+rate|effective\s+tax)[^%]{0,40}?(\d+(?:\.\d+)?)\s*%")
    out["enterprise_value"] = _money(
        r"(?:implied\s+)?enterprise\s+value[^\$]{0,40}\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)"
        r"\s*(bn|b|mm|m)?"
    )
    out["equity_value"] = _money(
        r"(?:implied\s+)?equity\s+value[^\$]{0,40}\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)"
        r"\s*(bn|b|mm|m)?"
    )
    m = re.search(
        r"(?:implied|dcf)\s+(?:share\s+)?(?:price|value)[^\$]{0,40}\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]+)?)",
        text,
        re.I,
    )
    if m:
        try:
            out["implied_price"] = float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return {k: v for k, v in out.items() if v is not None}


def extract_scenarios(md: str) -> list[dict[str, Any]]:
    """Bull / base / bear price targets + probabilities from the verdict."""
    text = md or ""
    rows = []
    for label, pat in (
        ("Bull", r"bull(?:\s+case)?[^\$\n]{0,90}\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]+)?)"),
        ("Base", r"base(?:\s+case)?[^\$\n]{0,90}\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]+)?)"),
        ("Bear", r"bear(?:\s+case)?[^\$\n]{0,90}\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]+)?)"),
    ):
        m = re.search(pat, text, re.I)
        if not m:
            continue
        try:
            pt = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        window = text[max(0, m.start() - 40) : m.end() + 80]
        pm = re.search(r"(\d+(?:\.\d+)?)\s*%", window)
        prob = None
        if pm:
            try:
                prob = float(pm.group(1)) / 100.0
            except ValueError:
                prob = None
        rows.append({"case": label, "price_target": pt, "probability": prob})
    return rows


def extract_street_table(tables: list[dict]) -> Optional[dict]:
    for tbl in tables:
        headers = [h.lower() for h in (tbl.get("headers") or [])]
        joined = " ".join(headers)
        if "firm" in joined and ("target" in joined or "rating" in joined):
            return tbl
        title = (tbl.get("title") or "").lower()
        if "analyst" in title or "street" in title or "consensus" in title:
            if tbl.get("rows"):
                return tbl
    return None


def extract_comps_table(tables: list[dict]) -> Optional[dict]:
    for tbl in tables:
        headers = [h.lower() for h in (tbl.get("headers") or [])]
        joined = " ".join(headers)
        if any(k in joined for k in ("ev/ebitda", "p/e", "pe ", "fcf yield", "ev/sales")):
            title = (tbl.get("title") or "").lower()
            if "peer" in title or "comp" in title or "comparable" in joined or "ticker" in joined:
                return tbl
            if "peer" in joined or "company" in joined or "ticker" in joined:
                return tbl
    return None


def extract_derivation_table(tables: list[dict]) -> Optional[dict]:
    for tbl in tables:
        title = (tbl.get("title") or "").lower()
        headers = " ".join(h.lower() for h in (tbl.get("headers") or []))
        if "derivation" in title or "price target" in title and "method" in headers:
            return tbl
        if "method" in headers and "weight" in headers:
            return tbl
    return None


# ── Financials helpers ──────────────────────────────────────────────────────
_MONEY = {
    "Revenue", "CostOfRevenue", "GrossProfit", "OperatingIncome", "NetIncome",
    "EBITDA", "OperatingCashFlow", "CapEx", "FreeCashFlow", "Cash",
    "ShortTermInvestments", "TotalAssets", "TotalLiabilities",
    "StockholdersEquity", "LongTermDebt", "ShortTermDebt", "TotalDebt",
    "NetDebt", "Dividends", "BuybacksCash", "RnD", "DepreciationAmortization",
}
_SHARES = {"DilutedShares", "SharesOutstanding"}
_MARGINS = {"GrossMargin", "OperatingMargin", "NetMargin", "EBITDAMargin"}
_PERSHARE = {"DilutedEPS", "BasicEPS"}


def _f(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    return x


def to_model_units(metric: str, raw: Any, *, already_millions: bool = False) -> Optional[float]:
    """DB dollars → $ millions; margins as fractions; EPS unchanged."""
    v = _f(raw)
    if v is None:
        return None
    if metric in _MARGINS:
        return v if abs(v) <= 2 else v / 100.0
    if metric in _PERSHARE:
        return v
    if metric in _SHARES:
        return v / 1_000_000.0 if abs(v) >= 100_000 else v
    if metric in _MONEY:
        if already_millions:
            return v
        return v / 1_000_000.0
    return v


def _period_money(period: dict, metric: str, *, already_millions: bool = False) -> Optional[float]:
    if not period:
        return None
    return to_model_units(metric, period.get(metric), already_millions=already_millions)


# ── Workbook styles ─────────────────────────────────────────────────────────
def _styles():
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    thin = Side(style="thin", color=LINE)
    med = Side(style="medium", color=NAVY)
    return {
        "navy_fill": PatternFill("solid", fgColor=NAVY),
        "gold_fill": PatternFill("solid", fgColor=GOLD),
        "section_fill": PatternFill("solid", fgColor=SECTION),
        "alt_fill": PatternFill("solid", fgColor=ROW_ALT),
        "pale_gold": PatternFill("solid", fgColor=PALE_GOLD),
        "pale_navy": PatternFill("solid", fgColor=PALE_NAVY),
        "input_fill": PatternFill("solid", fgColor=YELLOW),
        "white_fill": PatternFill("solid", fgColor=WHITE),
        "font_cover": Font(name="Calibri", size=18, bold=True, color=WHITE),
        "font_banner": Font(name="Calibri", size=10, bold=True, color=NAVY),
        "font_name": Font(name="Calibri", size=16, bold=True, color=NAVY),
        "font_h": Font(name="Calibri", size=10, bold=True, color=WHITE),
        "font_section": Font(name="Calibri", size=10, bold=True, color=WHITE),
        "font": Font(name="Calibri", size=10, color=INK),
        "font_bold": Font(name="Calibri", size=10, bold=True, color=INK),
        "font_muted": Font(name="Calibri", size=9, italic=True, color=MUTED),
        "font_est": Font(name="Calibri", size=10, color=BLUE_EST),
        "font_est_bold": Font(name="Calibri", size=10, bold=True, color=BLUE_EST),
        "font_kpi": Font(name="Calibri", size=12, bold=True, color=NAVY),
        "font_kpi_lab": Font(name="Calibri", size=8, bold=True, color=MUTED),
        "left": Alignment(horizontal="left", vertical="center", wrap_text=True),
        "center": Alignment(horizontal="center", vertical="center"),
        "right": Alignment(horizontal="right", vertical="center"),
        "thin": Border(left=thin, right=thin, top=thin, bottom=thin),
        "bottom": Border(bottom=thin),
        "top_med": Border(top=med),
        "thin_side": thin,
    }


_FMT_MM = '#,##0.0;(#,##0.0);"—"'
_FMT_SH = '$#,##0.00;($#,##0.00);"—"'
_FMT_PCT = '0.0%;(0.0%);"—"'
_FMT_X = '0.0x;(0.0x);"—"'
_FMT_SHARES = '#,##0.0;"—"'
_FMT_INT = '#,##0;(#,##0);"—"'


def _set_col_widths(ws, widths: dict[str, float]) -> None:
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


def _print_setup(ws, *, landscape: bool = True, fit_width: int = 1) -> None:
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = fit_width
    ws.page_setup.fitToHeight = 0
    ws.page_setup.paperSize = ws.PAPERSIZE_TABLOID if landscape else ws.PAPERSIZE_LETTER
    ws.page_setup.horizontalCentered = True
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.oddHeader.left.text = "DGA Capital Research"
    ws.oddHeader.right.text = "Confidential"
    ws.oddFooter.left.text = "Not investment advice · For intended recipient only"
    ws.oddFooter.right.text = "Page &P of &N"


def _write_banner(ws, ncols: int, title: str, subtitle: str, S) -> None:
    from openpyxl.utils import get_column_letter

    last = get_column_letter(max(ncols, 2))
    ws.merge_cells(f"A1:{last}1")
    c = ws["A1"]
    c.value = title
    c.font = S["font_cover"]
    c.fill = S["navy_fill"]
    c.alignment = S["left"]
    ws.row_dimensions[1].height = 26
    ws.merge_cells(f"A2:{last}2")
    c = ws["A2"]
    c.value = subtitle
    c.font = S["font_banner"]
    c.fill = S["gold_fill"]
    c.alignment = S["left"]
    ws.row_dimensions[2].height = 16
    for col in range(1, max(ncols, 2) + 1):
        ws.cell(1, col).fill = S["navy_fill"]
        ws.cell(2, col).fill = S["gold_fill"]


# ── Column plan ─────────────────────────────────────────────────────────────
def _annuals_oldest_first(financials: dict) -> list[dict]:
    annuals = list((financials or {}).get("annuals") or [])
    annuals = [a for a in annuals if isinstance(a, dict)]
    annuals.sort(key=lambda a: (a.get("fy") or 0, a.get("end") or ""))
    return annuals[-8:]


def _build_columns(financials: dict, forecasts: dict[int, dict[str, float]]) -> list[dict]:
    cols: list[dict] = []
    annuals = _annuals_oldest_first(financials)
    last_fy = None
    for a in annuals:
        fy = a.get("fy")
        try:
            fy_i = int(fy) if fy is not None else None
        except (TypeError, ValueError):
            fy_i = None
        last_fy = fy_i or last_fy
        label = f"FY{fy_i}A" if fy_i else str(a.get("end") or "FY")[:7]
        cols.append({
            "label": label,
            "kind": "A",
            "fy": fy_i,
            "end": a.get("end"),
            "period": a,
            "already_mm": False,
        })
    ttm = (financials or {}).get("ttm") or {}
    if ttm and (ttm.get("Revenue") is not None or ttm.get("NetIncome") is not None):
        end = str(ttm.get("end") or "")[:7]
        cols.append({
            "label": f"TTM {end}".strip(),
            "kind": "TTM",
            "fy": None,
            "end": ttm.get("end"),
            "period": ttm,
            "already_mm": False,
        })
    # Pro forma years after the last actual FY
    min_est_year = (last_fy + 1) if last_fy else 0
    for year in sorted(forecasts.keys()):
        if year < min_est_year:
            continue
        cols.append({
            "label": f"FY{year}E",
            "kind": "E",
            "fy": year,
            "end": None,
            "period": forecasts[year],
            "already_mm": True,
        })
    return cols


# ── Line items ──────────────────────────────────────────────────────────────
# kind: value | yoy | margin | netdebt | section
_MODEL_ROWS: list[tuple] = [
    ("section", "INCOME STATEMENT", None, None),
    ("value", "Revenue", "Revenue", "mm"),
    ("yoy", "    YoY growth", "Revenue", "pct"),
    ("value", "Cost of revenue", "CostOfRevenue", "mm"),
    ("value", "Gross profit", "GrossProfit", "mm"),
    ("margin", "    Gross margin", "GrossProfit", "Revenue"),
    ("value", "Operating income", "OperatingIncome", "mm"),
    ("margin", "    Operating margin", "OperatingIncome", "Revenue"),
    ("value", "EBITDA", "EBITDA", "mm"),
    ("margin", "    EBITDA margin", "EBITDA", "Revenue"),
    ("value", "Net income", "NetIncome", "mm"),
    ("margin", "    Net margin", "NetIncome", "Revenue"),
    ("value", "Diluted EPS", "DilutedEPS", "sh"),
    ("yoy", "    EPS growth", "DilutedEPS", "pct"),
    ("value", "Diluted shares (m)", "DilutedShares", "shares"),
    ("section", "BALANCE SHEET", None, None),
    ("value", "Cash & equivalents", "Cash", "mm"),
    ("value", "Total assets", "TotalAssets", "mm"),
    ("value", "Total debt", "TotalDebt", "mm"),
    ("netdebt", "Net debt", None, "mm"),
    ("value", "Shareholders' equity", "StockholdersEquity", "mm"),
    ("section", "CASH FLOW", None, None),
    ("value", "Operating cash flow", "OperatingCashFlow", "mm"),
    ("value", "Capital expenditure", "CapEx", "mm"),
    ("value", "Free cash flow", "FreeCashFlow", "mm"),
    ("margin", "    FCF margin", "FreeCashFlow", "Revenue"),
    ("value", "Dividends", "Dividends", "mm"),
    ("value", "Share buybacks", "BuybacksCash", "mm"),
]


def _fmt_for(kind: str) -> str:
    if kind in ("mm",):
        return _FMT_MM
    if kind == "sh":
        return _FMT_SH
    if kind == "pct":
        return _FMT_PCT
    if kind == "shares":
        return _FMT_SHARES
    return _FMT_MM


# ── Sheet builders ──────────────────────────────────────────────────────────
def _cover_sheet(wb, *, ticker, entity, sector, industry, as_of, engine,
                 rating, pt, price, upside, thesis, capital, source, dropbox_note, S):
    ws = wb.active
    ws.title = "Cover"
    _write_banner(
        ws, 8,
        "DGA CAPITAL  ·  RESEARCH MODEL",
        f"CONFIDENTIAL  ·  {ticker}  ·  {as_of}  ·  {engine or 'Research'} engine",
        S,
    )
    ws.merge_cells("A4:D4")
    ws["A4"].value = entity or ticker
    ws["A4"].font = S["font_name"]
    ws["E4"].value = ticker
    ws["E4"].font = S["font_kpi"]
    ws["E4"].alignment = S["center"]
    ws["F4"].value = (sector or "") + ((" · " + industry) if industry else "")
    ws["F4"].font = S["font_muted"]
    ws.merge_cells("F4:H4")

    kpis = [
        ("Rating", rating or "—", None),
        ("12-month PT", pt, "sh"),
        ("Last price", price, "sh"),
        ("Upside / (downside)", upside, "pct"),
        ("Market cap ($m)", capital.get("market_cap"), "mm"),
        ("Enterprise value ($m)", capital.get("enterprise_value"), "mm"),
    ]
    for i, (lab, val, fmt) in enumerate(kpis):
        col = 1 + i
        cell_l = ws.cell(6, col, lab.upper())
        cell_l.font = S["font_kpi_lab"]
        cell_l.fill = S["pale_navy"]
        cell_l.alignment = S["center"]
        cell_v = ws.cell(7, col, val if val not in ("—",) else "—")
        cell_v.font = S["font_kpi"]
        cell_v.alignment = S["center"]
        cell_v.fill = S["pale_gold"]
        cell_v.border = S["thin"]
        cell_l.border = S["thin"]
        if fmt == "sh" and isinstance(val, (int, float)):
            cell_v.number_format = _FMT_SH
        elif fmt == "pct" and isinstance(val, (int, float)):
            cell_v.number_format = _FMT_PCT
        elif fmt == "mm" and isinstance(val, (int, float)):
            cell_v.number_format = _FMT_MM
        ws.row_dimensions[7].height = 22

    ws["A9"].value = "INVESTMENT THESIS"
    ws["A9"].font = S["font_section"]
    ws["A9"].fill = S["section_fill"]
    ws.merge_cells("A9:H9")
    for col in range(1, 9):
        ws.cell(9, col).fill = S["section_fill"]
    ws.merge_cells("A10:H12")
    ws["A10"].value = thesis or "—"
    ws["A10"].alignment = Alignment_wrap(S)
    ws["A10"].font = S["font"]
    ws.row_dimensions[10].height = 36
    ws.row_dimensions[11].height = 18
    ws.row_dimensions[12].height = 18

    ws["A14"].value = "CAPITAL STRUCTURE"
    ws["A14"].font = S["font_section"]
    ws["A14"].fill = S["section_fill"]
    ws.merge_cells("A14:C14")
    for col in range(1, 4):
        ws.cell(14, col).fill = S["section_fill"]

    cap_rows = [
        ("Last price", capital.get("price"), _FMT_SH),
        ("Shares (m)", capital.get("shares"), _FMT_SHARES),
        ("Market capitalization ($m)", capital.get("market_cap"), _FMT_MM),
        ("  Cash & ST investments", capital.get("cash"), _FMT_MM),
        ("  Total debt", capital.get("total_debt"), _FMT_MM),
        ("  Net debt / (cash)", capital.get("net_debt"), _FMT_MM),
        ("Enterprise value ($m)", capital.get("enterprise_value"), _FMT_MM),
        ("Book value / sh", capital.get("book_value_ps"), _FMT_SH),
        ("P / E (FY)", capital.get("pe"), _FMT_X),
        ("EV / EBITDA (FY)", capital.get("ev_ebitda"), _FMT_X),
        ("FCF yield (FY)", capital.get("fcf_yield"), _FMT_PCT),
    ]
    r = 15
    ws.cell(r, 1, "Item").font = S["font_h"]
    ws.cell(r, 1).fill = S["navy_fill"]
    ws.cell(r, 2, "Value").font = S["font_h"]
    ws.cell(r, 2).fill = S["navy_fill"]
    ws.cell(r, 2).alignment = S["center"]
    r = 16
    for lab, val, fmt in cap_rows:
        ws.cell(r, 1, lab).font = S["font_bold"] if not lab.startswith(" ") else S["font"]
        ws.cell(r, 1).border = S["thin"]
        c = ws.cell(r, 2, val)
        c.font = S["font"]
        c.border = S["thin"]
        c.alignment = S["right"]
        if isinstance(val, (int, float)):
            c.number_format = fmt
        if r % 2 == 0:
            ws.cell(r, 1).fill = S["alt_fill"]
            c.fill = S["alt_fill"]
        r += 1

    ws["E14"].value = "MODEL NOTES"
    ws["E14"].font = S["font_section"]
    ws["E14"].fill = S["section_fill"]
    ws.merge_cells("E14:H14")
    for col in range(5, 9):
        ws.cell(14, col).fill = S["section_fill"]
    notes = [
        "Actuals (A) are SEC XBRL from the Financials store, $ millions.",
        "TTM is the stored bridge (latest FY + YTD delta) when available.",
        "Estimates (E, blue) are pro forma figures parsed from the saved report.",
        "Valuation, DCF inputs, Street targets, and scenarios come from the report.",
        "Yellow cells on Valuation are model inputs pulled from the write-up.",
        source or "Source: company_financials + saved research report.",
        dropbox_note or "",
        "DGA Capital · Confidential · Not investment advice.",
    ]
    rr = 16
    for nline in notes:
        if not nline:
            continue
        ws.merge_cells(start_row=rr, start_column=5, end_row=rr, end_column=8)
        ws.cell(rr, 5, nline).font = S["font_muted"]
        rr += 1

    _set_col_widths(ws, {ch: 22 for ch in "ABCDEFGH"})
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 16
    _print_setup(ws, landscape=False, fit_width=1)
    ws.sheet_properties.tabColor = GOLD
    ws.freeze_panes = "A4"
    ws.print_title_rows = "1:2"


def Alignment_wrap(S):
    from openpyxl.styles import Alignment
    return Alignment(horizontal="left", vertical="top", wrap_text=True)


def _model_sheet(wb, cols: list[dict], S) -> dict[str, int]:
    """Write the 3-statement model. Returns {row_key: excel_row} for formulas."""
    from openpyxl.utils import get_column_letter

    ws = wb.create_sheet("Financial Model")
    n = 1 + len(cols)
    _write_banner(
        ws, max(n, 4),
        "FINANCIAL MODEL  ·  ACTUALS AND PRO FORMA",
        "$ in millions except per-share items  ·  Blue = estimate  ·  Black = reported",
        S,
    )
    # Period-end sub-header
    ws.cell(4, 1, "Period end").font = S["font_muted"]
    header_row = 5
    ws.cell(header_row, 1, "($ millions)").font = S["font_h"]
    ws.cell(header_row, 1).fill = S["navy_fill"]
    for i, col in enumerate(cols, start=2):
        cell = ws.cell(header_row, i, col["label"])
        cell.font = S["font_h"]
        cell.fill = S["gold_fill"] if col["kind"] == "E" else S["navy_fill"]
        cell.alignment = S["center"]
        cell.border = S["thin"]
        end = col.get("end")
        if end:
            e = ws.cell(4, i, str(end)[:10])
            e.font = S["font_muted"]
            e.alignment = S["center"]
    for col_i in range(1, n + 1):
        ws.cell(header_row, col_i).fill = (
            S["gold_fill"] if col_i > 1 and cols[col_i - 2]["kind"] == "E" else S["navy_fill"]
        )
        ws.cell(header_row, col_i).font = S["font_h"]
        ws.cell(header_row, col_i).border = S["thin"]

    row_index: dict[str, int] = {}
    excel_row = 6
    value_rows: dict[str, int] = {}  # metric → row for formulas

    for spec in _MODEL_ROWS:
        kind, label, metric, extra = spec
        if kind == "section":
            ws.merge_cells(start_row=excel_row, start_column=1, end_row=excel_row, end_column=max(n, 2))
            cell = ws.cell(excel_row, 1, label)
            cell.font = S["font_section"]
            cell.fill = S["section_fill"]
            for c in range(1, n + 1):
                ws.cell(excel_row, c).fill = S["section_fill"]
                ws.cell(excel_row, c).font = S["font_section"]
            excel_row += 1
            continue

        lab_cell = ws.cell(excel_row, 1, label)
        lab_cell.font = S["font_bold"] if kind == "value" else S["font"]
        lab_cell.alignment = S["left"]
        lab_cell.border = S["thin"]

        for i, col in enumerate(cols, start=2):
            letter = get_column_letter(i)
            is_est = col["kind"] == "E"
            font = S["font_est"] if is_est else S["font"]
            fill = S["input_fill"] if is_est and kind == "value" else None
            cell = ws.cell(excel_row, i)
            cell.font = font
            cell.alignment = S["right"]
            cell.border = S["thin"]
            if fill:
                cell.fill = fill
            elif excel_row % 2 == 0:
                cell.fill = S["alt_fill"]
                if i == 1:
                    pass

            if kind == "value":
                val = _period_money(col["period"], metric, already_millions=col.get("already_mm") or False)
                cell.value = val
                cell.number_format = _fmt_for(extra)
            elif kind == "yoy":
                src_row = value_rows.get(metric)
                if src_row and i > 2:
                    prev = get_column_letter(i - 1)
                    cell.value = (
                        f'=IF(OR({prev}{src_row}="",{prev}{src_row}=0),"—",'
                        f'({letter}{src_row}-{prev}{src_row})/{prev}{src_row})'
                    )
                else:
                    cell.value = None
                cell.number_format = _FMT_PCT
            elif kind == "margin":
                num_row = value_rows.get(metric)
                den_row = value_rows.get(extra)
                if num_row and den_row:
                    cell.value = (
                        f'=IF(OR({letter}{den_row}="",{letter}{den_row}=0),"—",'
                        f'{letter}{num_row}/{letter}{den_row})'
                    )
                else:
                    # Fall back to stored margin if we have it
                    stored = _period_money(col["period"], metric if metric.endswith("Margin") else "",
                                           already_millions=True)
                    if stored is None and metric:
                        # metric is numerator name; stored margin keys
                        mk = {
                            "GrossProfit": "GrossMargin",
                            "OperatingIncome": "OperatingMargin",
                            "EBITDA": "EBITDAMargin",
                            "NetIncome": "NetMargin",
                            "FreeCashFlow": None,
                        }.get(metric)
                        if mk:
                            stored = _period_money(col["period"], mk, already_millions=False)
                    cell.value = stored
                cell.number_format = _FMT_PCT
            elif kind == "netdebt":
                debt_r = value_rows.get("TotalDebt")
                cash_r = value_rows.get("Cash")
                if debt_r and cash_r:
                    cell.value = f'=IF(AND({letter}{debt_r}="",{letter}{cash_r}=""),"—",IF({letter}{debt_r}="",0,{letter}{debt_r})-IF({letter}{cash_r}="",0,{letter}{cash_r}))'
                else:
                    cell.value = _period_money(col["period"], "NetDebt",
                                               already_millions=col.get("already_mm") or False)
                cell.number_format = _FMT_MM

        if kind == "value" and metric:
            value_rows[metric] = excel_row
            row_index[metric] = excel_row
        excel_row += 1

    # Source line
    excel_row += 1
    ws.merge_cells(start_row=excel_row, start_column=1, end_row=excel_row, end_column=max(n, 2))
    ws.cell(excel_row, 1, "A = reported (SEC XBRL)   TTM = trailing twelve months   E = DGA pro forma from the saved report. Yellow cells are estimate inputs.").font = S["font_muted"]

    ws.column_dimensions["A"].width = 28
    for i in range(2, n + 1):
        ws.column_dimensions[get_column_letter(i)].width = 13
    ws.freeze_panes = "B6"
    ws.print_title_rows = "1:5"
    ws.print_title_cols = "A:A"
    _print_setup(ws, landscape=True)
    ws.sheet_properties.tabColor = NAVY
    ws.auto_filter.ref = f"A{header_row}:{get_column_letter(max(n, 2))}{header_row}"
    return row_index


def _write_kv_table(ws, start_row: int, title: str, rows: list[tuple], S, ncols=4) -> int:
    ws.merge_cells(start_row=start_row, start_column=1, end_row=start_row, end_column=ncols)
    ws.cell(start_row, 1, title).font = S["font_section"]
    ws.cell(start_row, 1).fill = S["section_fill"]
    for c in range(1, ncols + 1):
        ws.cell(start_row, c).fill = S["section_fill"]
        ws.cell(start_row, c).font = S["font_section"]
    r = start_row + 1
    ws.cell(r, 1, "Item").font = S["font_h"]
    ws.cell(r, 1).fill = S["navy_fill"]
    ws.cell(r, 2, "Value").font = S["font_h"]
    ws.cell(r, 2).fill = S["navy_fill"]
    r += 1
    for lab, val, fmt, is_input in rows:
        ws.cell(r, 1, lab).font = S["font"]
        ws.cell(r, 1).border = S["thin"]
        c = ws.cell(r, 2, val)
        c.font = S["font"]
        c.border = S["thin"]
        c.alignment = S["right"]
        if isinstance(val, (int, float)) and fmt:
            c.number_format = fmt
        if is_input:
            c.fill = S["input_fill"]
        r += 1
    return r + 1


def _dump_md_table(ws, start_row: int, title: str, tbl: dict, S) -> int:
    headers = tbl.get("headers") or []
    rows = tbl.get("rows") or []
    width = max(len(headers), 2)
    ws.merge_cells(start_row=start_row, start_column=1, end_row=start_row, end_column=width)
    ws.cell(start_row, 1, title).font = S["font_section"]
    for c in range(1, width + 1):
        ws.cell(start_row, c).fill = S["section_fill"]
        ws.cell(start_row, c).font = S["font_section"]
    r = start_row + 1
    for i, h in enumerate(headers, start=1):
        cell = ws.cell(r, i, h)
        cell.font = S["font_h"]
        cell.fill = S["navy_fill"]
        cell.alignment = S["center"]
        cell.border = S["thin"]
    r += 1
    for row in rows:
        for i, raw in enumerate(row, start=1):
            num = parse_cell_number(raw) if i > 1 else None
            cell = ws.cell(r, i, num if num is not None else raw)
            cell.font = S["font"]
            cell.border = S["thin"]
            if num is not None:
                cell.alignment = S["right"]
                if abs(num) < 2 and ("%" in raw or "margin" in (headers[0] if headers else "").lower()):
                    cell.number_format = _FMT_PCT
                elif raw.strip().startswith("$") or abs(num) >= 5:
                    cell.number_format = _FMT_MM if abs(num) >= 20 else _FMT_SH
            if r % 2 == 0:
                cell.fill = S["alt_fill"]
        r += 1
    return r + 1


def _valuation_sheet(wb, *, capital, dcf, derivation, comps, pt, price, S):
    ws = wb.create_sheet("Valuation")
    _write_banner(ws, 8, "VALUATION", "Trading multiples · DCF · target derivation · peer comps", S)

    mkt = capital.get("market_cap")
    ev = capital.get("enterprise_value")
    rows = [
        ("Last price", capital.get("price"), _FMT_SH, False),
        ("Market cap ($m)", mkt, _FMT_MM, False),
        ("Enterprise value ($m)", ev, _FMT_MM, False),
        ("P / E", capital.get("pe"), _FMT_X, False),
        ("EV / EBITDA", capital.get("ev_ebitda"), _FMT_X, False),
        ("EV / Sales", capital.get("ev_sales"), _FMT_X, False),
        ("P / B", capital.get("pb"), _FMT_X, False),
        ("FCF yield", capital.get("fcf_yield"), _FMT_PCT, False),
        ("12-month price target", pt, _FMT_SH, False),
        ("Implied upside", None if (pt is None or not price) else (pt / price - 1.0), _FMT_PCT, False),
    ]
    r = _write_kv_table(ws, 4, "TRADING MULTIPLES (LAST REPORTED FY / TTM)", rows, S)

    dcf_rows = [
        ("WACC", dcf.get("wacc"), _FMT_PCT, True),
        ("Terminal growth", dcf.get("terminal_growth"), _FMT_PCT, True),
        ("Tax rate", dcf.get("tax_rate"), _FMT_PCT, True),
        ("Enterprise value ($m)", dcf.get("enterprise_value"), _FMT_MM, False),
        ("Equity value ($m)", dcf.get("equity_value"), _FMT_MM, False),
        ("DCF implied price", dcf.get("implied_price"), _FMT_SH, False),
    ]
    if not dcf:
        dcf_rows = [("No explicit DCF inputs parsed from the report", None, None, False)]
    r = _write_kv_table(ws, r, "DISCOUNTED CASH FLOW (FROM REPORT)", dcf_rows, S)

    if derivation:
        r = _dump_md_table(ws, r, "PRICE TARGET DERIVATION", derivation, S)
    if comps:
        r = _dump_md_table(ws, r, "COMPARABLE COMPANIES", comps, S)

    ws.column_dimensions["A"].width = 36
    ws.column_dimensions["B"].width = 18
    for ch in "CDEFGH":
        ws.column_dimensions[ch].width = 14
    ws.freeze_panes = "A4"
    _print_setup(ws, landscape=True)
    ws.sheet_properties.tabColor = GOLD


def _scenarios_sheet(wb, scenarios, price, pt, S):
    ws = wb.create_sheet("Scenarios")
    _write_banner(ws, 6, "SCENARIOS", "Bull / Base / Bear  ·  probability-weighted expected value", S)
    headers = ["Case", "Price target", "Probability", "Implied return", "Contribution to EV"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(4, i, h)
        c.font = S["font_h"]
        c.fill = S["navy_fill"]
        c.alignment = S["center"]
        c.border = S["thin"]
    r = 5
    first_data = r
    if not scenarios:
        ws.cell(r, 1, "No bull / base / bear targets parsed from the report.").font = S["font_muted"]
        r += 1
    else:
        for sc in scenarios:
            ws.cell(r, 1, sc["case"]).font = S["font_bold"]
            ws.cell(r, 1).border = S["thin"]
            c = ws.cell(r, 2, sc.get("price_target"))
            c.number_format = _FMT_SH
            c.font = S["font"]
            c.border = S["thin"]
            p = ws.cell(r, 3, sc.get("probability"))
            p.number_format = _FMT_PCT
            p.fill = S["input_fill"]
            p.border = S["thin"]
            # implied return vs last
            if price and sc.get("price_target") is not None:
                ir = ws.cell(r, 4, f"=IF(OR($B$20=0,$B$20=\"\"),\"—\",B{r}/$B$20-1)")
            else:
                ir = ws.cell(r, 4, None)
            ir.number_format = _FMT_PCT
            ir.border = S["thin"]
            contrib = ws.cell(r, 5, f"=IF(OR(B{r}=\"\",C{r}=\"\"),\"—\",B{r}*C{r})")
            contrib.number_format = _FMT_SH
            contrib.border = S["thin"]
            r += 1
        last = r - 1
        ws.cell(r, 1, "Expected value").font = S["font_bold"]
        ws.cell(r, 1).border = S["thin"]
        ev = ws.cell(r, 5, f"=SUM(E{first_data}:E{last})")
        ev.font = S["font_kpi"]
        ev.number_format = _FMT_SH
        ev.fill = S["pale_gold"]
        ev.border = S["thin"]
        for col in range(1, 6):
            ws.cell(r, col).border = S["thin"]
            ws.cell(r, col).fill = S["pale_gold"]
        r += 2

    ws["A20"].value = "Last price (for implied return)"
    ws["A20"].font = S["font_muted"]
    ws["B20"].value = price
    ws["B20"].number_format = _FMT_SH
    ws["B20"].fill = S["input_fill"]
    ws["A21"].value = "Report 12-month PT"
    ws["A21"].font = S["font_muted"]
    ws["B21"].value = pt
    ws["B21"].number_format = _FMT_SH

    ws.column_dimensions["A"].width = 36
    for ch in "BCDE":
        ws.column_dimensions[ch].width = 18
    _print_setup(ws, landscape=False)
    ws.sheet_properties.tabColor = SECTION


def _street_sheet(wb, street, S):
    ws = wb.create_sheet("Street")
    _write_banner(ws, 8, "STREET CONSENSUS", "Sell-side ratings and 12-month targets from the report", S)
    if street:
        _dump_md_table(ws, 4, street.get("title") or "ANALYST RATINGS", street, S)
    else:
        ws["A4"] = "No firm-level consensus table found in the saved report."
        ws["A4"].font = S["font_muted"]
    ws.column_dimensions["A"].width = 28
    for ch in "BCDEFGH":
        ws.column_dimensions[ch].width = 16
    _print_setup(ws, landscape=True)
    ws.sheet_properties.tabColor = "1E3A8A"


def _quarterly_sheet(wb, financials: dict, S):
    from openpyxl.utils import get_column_letter

    ws = wb.create_sheet("Quarterly")
    q = (financials or {}).get("quarterly") or {}
    # Prefer explicit current / prior; also list from nested if present
    periods = []
    for key in ("current", "prior_year_same_q"):
        if isinstance(q.get(key), dict):
            periods.append(q[key])
    # If extract_financials_from_db only has those two, that's fine.
    # Also surface YTD.
    ytd_cols = []
    for key, lab in (("current_ytd", "YTD"), ("prior_ytd", "Prior YTD")):
        if isinstance(q.get(key), dict):
            ytd_cols.append((lab, q[key]))

    _write_banner(ws, 8, "QUARTERLY RESULTS", "Latest reported quarter vs year-ago  ·  $ millions", S)
    headers = ["Metric"]
    data_cols = []
    if periods:
        cur = periods[0]
        headers.append(_q_label(cur, "Latest Q"))
        data_cols.append(cur)
        if len(periods) > 1:
            headers.append(_q_label(periods[1], "Year-ago Q"))
            data_cols.append(periods[1])
    for lab, p in ytd_cols:
        headers.append(lab)
        data_cols.append(p)

    for i, h in enumerate(headers, start=1):
        c = ws.cell(4, i, h)
        c.font = S["font_h"]
        c.fill = S["navy_fill"]
        c.alignment = S["center"]
        c.border = S["thin"]

    metrics = [
        ("Revenue", "Revenue", "mm"),
        ("Gross profit", "GrossProfit", "mm"),
        ("Operating income", "OperatingIncome", "mm"),
        ("EBITDA", "EBITDA", "mm"),
        ("Net income", "NetIncome", "mm"),
        ("Diluted EPS", "DilutedEPS", "sh"),
        ("Free cash flow", "FreeCashFlow", "mm"),
        ("Operating cash flow", "OperatingCashFlow", "mm"),
        ("Cash", "Cash", "mm"),
        ("Total debt", "TotalDebt", "mm"),
    ]
    r = 5
    for lab, key, kind in metrics:
        ws.cell(r, 1, lab).font = S["font"]
        ws.cell(r, 1).border = S["thin"]
        for i, p in enumerate(data_cols, start=2):
            val = _period_money(p, key, already_millions=False)
            c = ws.cell(r, i, val)
            c.font = S["font"]
            c.border = S["thin"]
            c.alignment = S["right"]
            c.number_format = _fmt_for(kind)
        r += 1

    if not data_cols:
        ws["A5"] = "No quarterly periods in the financials store for this ticker."
        ws["A5"].font = S["font_muted"]

    ws.column_dimensions["A"].width = 28
    for i in range(2, max(len(headers), 2) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 16
    _print_setup(ws, landscape=True)
    ws.sheet_properties.tabColor = MUTED


def _q_label(p: dict, fallback: str) -> str:
    fp = p.get("fp") or ""
    fy = p.get("fy") or ""
    end = str(p.get("end") or "")[:10]
    if fp and fy:
        return f"{fp} FY{fy}"
    return end or fallback


def _capital_from(financials: dict, price: Optional[float]) -> dict[str, Any]:
    annuals = _annuals_oldest_first(financials)
    ttm = (financials or {}).get("ttm") or {}
    latest = ttm if ttm else (annuals[-1] if annuals else {})
    fy_row = annuals[-1] if annuals else latest
    shares = to_model_units("DilutedShares",
                            latest.get("DilutedShares") or latest.get("SharesOutstanding")
                            or fy_row.get("DilutedShares") or fy_row.get("SharesOutstanding"))
    cash = to_model_units("Cash", latest.get("Cash") if latest.get("Cash") is not None else fy_row.get("Cash"))
    debt = to_model_units("TotalDebt", latest.get("TotalDebt") if latest.get("TotalDebt") is not None else fy_row.get("TotalDebt"))
    equity = to_model_units("StockholdersEquity", fy_row.get("StockholdersEquity"))
    rev = to_model_units("Revenue", latest.get("Revenue") if latest.get("Revenue") is not None else fy_row.get("Revenue"))
    ebitda = to_model_units("EBITDA", latest.get("EBITDA") if latest.get("EBITDA") is not None else fy_row.get("EBITDA"))
    fcf = to_model_units("FreeCashFlow", latest.get("FreeCashFlow") if latest.get("FreeCashFlow") is not None else fy_row.get("FreeCashFlow"))
    eps = _f(fy_row.get("DilutedEPS"))
    ni = to_model_units("NetIncome", fy_row.get("NetIncome"))
    if eps is None and ni is not None and shares:
        eps = ni / shares
    mkt = (price * shares) if (price and shares) else None
    net_debt = None
    if debt is not None or cash is not None:
        net_debt = (debt or 0.0) - (cash or 0.0)
    ev = (mkt + (net_debt or 0.0)) if mkt is not None else None
    pe = (price / eps) if (price and eps and eps > 0) else None
    bvps = (equity / shares) if (equity is not None and shares) else None
    pb = (price / bvps) if (price and bvps and bvps > 0) else None
    ev_eb = (ev / ebitda) if (ev is not None and ebitda and ebitda > 0) else None
    ev_sales = (ev / rev) if (ev is not None and rev and rev > 0) else None
    fcf_y = (fcf / mkt) if (fcf is not None and mkt and mkt > 0) else None
    return {
        "price": price,
        "shares": shares,
        "cash": cash,
        "total_debt": debt,
        "net_debt": net_debt,
        "equity": equity,
        "market_cap": mkt,
        "enterprise_value": ev,
        "pe": pe,
        "pb": pb,
        "ev_ebitda": ev_eb,
        "ev_sales": ev_sales,
        "fcf_yield": fcf_y,
        "book_value_ps": bvps,
        "revenue": rev,
        "ebitda": ebitda,
        "fcf": fcf,
    }


def _upside(pt: Optional[float], price: Optional[float]) -> Optional[float]:
    if pt is None or not price:
        return None
    try:
        return pt / float(price) - 1.0
    except (TypeError, ZeroDivisionError):
        return None


# ── Public API ──────────────────────────────────────────────────────────────
def build_ib_model_bytes(
    ticker: str,
    *,
    financials: Optional[dict] = None,
    report_md: str = "",
    summary: Optional[dict] = None,
    quote: Optional[dict] = None,
    engine: str = "",
    entity_name: str = "",
    sector: str = "",
    industry: str = "",
    source: str = "",
    dropbox_note: str = "",
    generated_at: Optional[str] = None,
) -> bytes:
    """Return .xlsx bytes for an IB-style research model."""
    import openpyxl

    tk = (ticker or "").strip().upper()
    financials = financials if isinstance(financials, dict) else {}
    summary = summary if isinstance(summary, dict) else {}
    quote = quote if isinstance(quote, dict) else {}
    md = report_md or ""
    tables = parse_md_tables(md)
    forecasts = extract_forecasts(tables)
    dcf = extract_dcf(md)
    scenarios = extract_scenarios(md)
    street = extract_street_table(tables)
    comps = extract_comps_table(tables)
    derivation = extract_derivation_table(tables)

    price = _f(quote.get("price")) or _f(summary.get("current_price"))
    pt = _f(summary.get("price_target"))
    rating = summary.get("rating")
    upside = _f(summary.get("upside_pct"))
    if upside is not None and abs(upside) > 2:
        upside = upside / 100.0
    if upside is None:
        upside = _upside(pt, price)

    thesis = (summary.get("thesis") or "")[:900]
    entity = entity_name or financials.get("entity_name") or tk
    as_of = (generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%d"))[:19]
    capital = _capital_from(financials, price)
    cols = _build_columns(financials, forecasts)

    S = _styles()
    wb = openpyxl.Workbook()
    _cover_sheet(
        wb,
        ticker=tk,
        entity=entity,
        sector=sector or summary.get("sector") or "",
        industry=industry,
        as_of=as_of,
        engine=engine,
        rating=rating,
        pt=pt,
        price=price,
        upside=upside,
        thesis=thesis,
        capital=capital,
        source=source or financials.get("source") or "",
        dropbox_note=dropbox_note,
        S=S,
    )
    _model_sheet(wb, cols, S)
    _valuation_sheet(wb, capital=capital, dcf=dcf, derivation=derivation, comps=comps, pt=pt, price=price, S=S)
    _scenarios_sheet(wb, scenarios, price, pt, S)
    _street_sheet(wb, street, S)
    _quarterly_sheet(wb, financials, S)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def write_ib_model(ticker: str, output_path: Path | str, **kwargs) -> Path:
    raw = build_ib_model_bytes(ticker, **kwargs)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path
