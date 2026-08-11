"""
excel_financials.py
-------------------
Read the per-ticker Excel workbooks produced by `pull_sec_financials.py`
and produce the canonical `data` dict consumed by the DGA report
pipeline (format_verified_block + word report rendering).

Why this module exists
----------------------
Earlier versions of the pipeline pulled financials from SEC's
`companyfacts` JSON API. For some filers (notably AYI) that feed has
fiscal-year labels that don't line up with the reported period-end —
which caused the annual table to shift by 2 years and the YTD columns
to duplicate each other.

The Excel workbooks come from edgartools' XBRL statement parser,
which reads the XBRL *instance document* attached to each filing.
The columns therefore reflect the filing's own period contexts:
  * 10-K Income Statement: 3 FY columns (e.g. "2025-08-31 (FY)")
  * 10-K Balance Sheet:    2 FY-end columns (current + prior year end)
  * 10-K Cash Flow:        3 FY columns
  * 10-Q Income Statement: 4 cols  — Q current, Q prior, YTD current, YTD prior
  * 10-Q Balance Sheet:    2 cols  — current quarter end + most-recent FY end
  * 10-Q Cash Flow:        2 cols  — YTD current, YTD prior  (NO 3-mo CF)

Public API
----------
    data = extract_financials(ticker, stock_financials_dir=None)
    text = format_verified_block(data)

Output shape matches sec_edgar_xbrl.extract_financials:
    {
      "ticker": ..., "entity_name": ..., "cik": "",
      "latest_filings": {"10-K": {...}, "10-Q": {...}},
      "latest_filing_type": "10-Q" | "10-K",
      "annuals": [ {"fy": 2025, "end": "2025-08-31", "Revenue": ..., ...}, ...],
      "quarterly": {
          "current":            {"fy":2026,"fp":"Q2","end":"2026-02-28", ...},
          "prior_year_same_q":  {"fy":2025,"fp":"Q2","end":"2025-02-28", ...},
          "current_ytd":        {...},
          "prior_ytd":          {...},
          "meta": {"fy":2026,"fp":"Q2","reportDate":"2026-02-28", ...},
      },
      "errors": [...],
      "source": "excel_xbrl",
    }
"""

from __future__ import annotations

import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Optional

import pandas as pd


_PROJECT_ROOT = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Tag priorities (mirrors sec_edgar_xbrl.TAG_PRIORITIES; normalized to the
# "us-gaap_" prefix used in the Excel files' `concept` column).
# ---------------------------------------------------------------------------
def _p(names: list[str]) -> list[str]:
    return [f"us-gaap_{n}" for n in names]


CONCEPT_PRIORITIES: dict[str, list[str]] = {
    # Banks/thrifts rarely tag "Revenues" — top line is interest income (+ noninterest).
    # Do NOT put RevenueFromContract* first: for banks that tag is a small fee
    # component under NoninterestIncome (e.g. CLBK $9M fees vs $119M interest).
    "Revenue": _p([
        "InterestAndDividendIncomeOperating",  # bank total interest income
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
        "SalesRevenueServicesNet",
        "RevenueNotFromContractWithCustomerExcludingInterestIncome",
    ]),
    "InterestIncome": _p([
        "InterestAndDividendIncomeOperating",
        "InterestAndFeeIncomeLoansAndLeases",
    ]),
    "NetInterestIncome": _p([
        "InterestIncomeExpenseNet",
        "InterestIncomeExpenseAfterProvisionForLoanLoss",
    ]),
    "NoninterestIncome": _p([
        "NoninterestIncome",
        "NoninterestIncomeOtherOperatingIncome",
    ]),
    "CostOfRevenue": _p([
        "CostOfRevenue",
        "CostOfGoodsAndServicesSold",
        "CostOfGoodsSold",
        "CostOfServices",
        "InterestExpenseOperating",  # bank analog of COGS
    ]),
    "GrossProfit": _p([
        "GrossProfit",
        "InterestIncomeExpenseNet",  # bank: net interest income ≈ gross profit
    ]),
    "OperatingIncome": _p([
        "OperatingIncomeLoss",
        "InterestIncomeExpenseAfterProvisionForLoanLoss",
    ]),
    "NetIncome": _p([
        "NetIncomeLoss",
        "ProfitLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
    ]),
    "DilutedEPS": _p([
        "EarningsPerShareDiluted",
        "IncomeLossFromContinuingOperationsPerDilutedShare",
    ]),
    "BasicEPS": _p(["EarningsPerShareBasic"]),
    "OperatingCashFlow": _p([
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
        "NetCashProvidedByUsedInOperatingActivitiesDiscontinuedOperations",
    ]),
    "CapEx": _p([
        # Primary GAAP concept (used by most large-cap filers)
        "PaymentsToAcquirePropertyPlantAndEquipment",
        # Alternative "productive assets" concept (Intel, some manufacturing co's)
        "PaymentsToAcquireProductiveAssets",
        # Capital improvements (REITs, utilities, infrastructure)
        "PaymentsForCapitalImprovements",
        # "Other" PP&E sub-category that some filers use as the total line
        "PaymentsToAcquireOtherPropertyPlantAndEquipment",
        # Variation used by some tech / healthcare filers
        "PaymentsToAcquirePropertyAndEquipment",
        # Combined PP&E + intangibles purchase line (some banks / diversified cos)
        "PurchasesOfPropertyPlantAndEquipmentAndIntangibleAssets",
        # Finance-lease buyout payments (some industrials count this as CapEx)
        "CapitalExpenditureLeasedAsset",
        # Incurred-but-not-yet-paid CapEx (rarely used as the primary tag)
        "CapitalExpendituresIncurredButNotYetPaid",
    ]),
    "Cash": _p([
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
        "Cash",
    ]),
    "ShortTermInvestments": _p([
        "ShortTermInvestments",
        "MarketableSecuritiesCurrent",
    ]),
    "TotalAssets": _p(["Assets"]),
    "TotalLiabilities": _p(["Liabilities"]),
    "StockholdersEquity": _p([
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ]),
    "LongTermDebt": _p([
        "LongTermDebtNoncurrent",
        "LongTermDebt",
    ]),
    "ShortTermDebt": _p([
        "ShortTermBorrowings",
        "LongTermDebtCurrent",
        "DebtCurrent",
    ]),
    "TotalDebt": _p([
        "LongTermDebtAndCapitalLeaseObligations",
        "DebtLongtermAndShorttermCombinedAmount",
    ]),
    "DilutedShares": _p(["WeightedAverageNumberOfDilutedSharesOutstanding"]),
    "SharesOutstanding": _p([
        "CommonStockSharesOutstanding",
        "EntityCommonStockSharesOutstanding",
    ]),
    "Dividends": _p([
        "PaymentsOfDividendsCommonStock",
        "PaymentsOfDividends",
    ]),
    "BuybacksCash": _p(["PaymentsForRepurchaseOfCommonStock"]),
    "RnD": _p(["ResearchAndDevelopmentExpense"]),
    "DepreciationAmortization": _p([
        "DepreciationDepletionAndAmortization",
        "DepreciationAndAmortization",
        "Depreciation",
        "DepreciationAmortizationAndAccretionNet",
    ]),
}

# Statements where each metric is expected to live.
IS_METRICS = {
    "Revenue", "InterestIncome", "NetInterestIncome", "NoninterestIncome",
    "CostOfRevenue", "GrossProfit", "OperatingIncome",
    "NetIncome", "DilutedEPS", "BasicEPS", "DilutedShares",
    "SharesOutstanding", "RnD",
}
CF_METRICS = {"OperatingCashFlow", "CapEx", "Dividends", "BuybacksCash", "DepreciationAmortization"}
BS_METRICS = {
    "Cash", "ShortTermInvestments", "TotalAssets", "TotalLiabilities",
    "StockholdersEquity", "LongTermDebt", "ShortTermDebt", "TotalDebt",
}


# ---------------------------------------------------------------------------
# Directory helpers
# ---------------------------------------------------------------------------
def _default_stock_dir() -> Path:
    raw = os.environ.get("STOCK_FINANCIALS_DIR", "").strip() or "stock-financials"
    p = Path(raw)
    if not p.is_absolute():
        p = _PROJECT_ROOT / p
    return p


def _resolve_workbooks(ticker: str, base_dir: Optional[Path]) -> dict[str, Path]:
    """Return {"10-K": path, "10-Q": path} for files that actually exist."""
    base = (base_dir or _default_stock_dir()).resolve()
    tkr = ticker.strip().upper()
    out: dict[str, Path] = {}
    for form, slug in (("10-K", "10K"), ("10-Q", "10Q")):
        candidate = base / tkr / f"{tkr}_{slug}_Financials.xlsx"
        if candidate.exists():
            out[form] = candidate
    return out


# ---------------------------------------------------------------------------
# Column parsing
# ---------------------------------------------------------------------------
_COL_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:\s*\(([^)]+)\))?$")


def _parse_period_column(col: str) -> Optional[dict[str, str]]:
    """
    Parse a header like "2025-08-31 (FY)", "2026-02-28 (Q2)",
    "2026-02-28 (YTD)", or bare "2025-08-31" (balance-sheet instant).
    """
    if not isinstance(col, str):
        return None
    m = _COL_RE.match(col.strip())
    if not m:
        return None
    end, tag = m.group(1), (m.group(2) or "").strip().upper()
    kind = "INSTANT"
    fp = ""
    if tag == "FY":
        kind, fp = "DURATION", "FY"
    elif tag == "YTD":
        kind, fp = "YTD", "YTD"
    elif re.fullmatch(r"Q[1-4]", tag or ""):
        kind, fp = "DURATION", tag
    elif tag == "":
        kind, fp = "INSTANT", ""
    else:
        # unknown tag — still return but flagged
        kind, fp = "OTHER", tag
    return {"end": end, "fp": fp, "kind": kind, "raw": col}


def _period_columns(df: pd.DataFrame) -> list[dict[str, str]]:
    return [p for c in df.columns for p in [_parse_period_column(c)] if p]


# ---------------------------------------------------------------------------
# Value picker
# ---------------------------------------------------------------------------
def _pick_value(
    df: pd.DataFrame,
    concepts: Iterable[str],
    column: str,
) -> Optional[float]:
    """
    Find the value for the first concept (in priority order) that has a
    non-null, non-breakdown, non-abstract row with data in `column`.
    """
    if df is None or df.empty or column not in df.columns:
        return None
    # Vectorized filter: the "total" row for a concept is abstract=False &
    # is_breakdown=False & dimension=False (no segment dim). We also accept
    # dimension=False alone in case is_breakdown is absent.
    mask = pd.Series([True] * len(df))
    for col_name in ("abstract",):
        if col_name in df.columns:
            mask &= (df[col_name] == False)  # noqa: E712
    for col_name in ("is_breakdown",):
        if col_name in df.columns:
            mask &= (df[col_name] == False)  # noqa: E712
    if "dimension" in df.columns:
        mask &= (df["dimension"] == False)  # noqa: E712

    filt = df[mask]

    for concept in concepts:
        matches = filt[filt["concept"] == concept]
        if matches.empty:
            continue
        for val in matches[column].tolist():
            if pd.notna(val):
                try:
                    return float(val)
                except (TypeError, ValueError):
                    continue
    return None


def _find_cf_col_for_end(cf_cols: list[dict], target_end: str) -> Optional[str]:
    """Return the raw column name for the CF duration that ends on target_end.

    Priority order:
    1. fp == "YTD"  (standard 10-Q CF label from edgartools)
    2. fp == "FY"   (annual CF column or Q1 where edgartools uses "FY" context)
    3. Any DURATION column (catches Q1 10-Q where fp may be "Q1", not "YTD")

    This handles the common case where Q1 10-Q CF columns are labeled with
    the fiscal-quarter context ("Q1") instead of the YTD context, because
    for Q1 filings the 3-month period equals the YTD period.
    """
    for preferred_fp in ("YTD", "FY"):
        col = next((c["raw"] for c in cf_cols
                    if c["fp"] == preferred_fp and c["end"] == target_end), None)
        if col:
            return col
    # Fallback: any duration column (non-INSTANT) with the right end date
    return next((c["raw"] for c in cf_cols
                 if c["kind"] == "DURATION" and c["end"] == target_end), None)


def _pick_value_with_tag(
    df: pd.DataFrame,
    concepts: Iterable[str],
    column: str,
) -> tuple[Optional[float], Optional[str]]:
    """Same as _pick_value but also returns the winning concept tag."""
    if df is None or df.empty or column not in df.columns:
        return None, None
    mask = pd.Series([True] * len(df))
    for col_name in ("abstract",):
        if col_name in df.columns:
            mask &= (df[col_name] == False)  # noqa: E712
    for col_name in ("is_breakdown",):
        if col_name in df.columns:
            mask &= (df[col_name] == False)  # noqa: E712
    if "dimension" in df.columns:
        mask &= (df["dimension"] == False)  # noqa: E712
    filt = df[mask]
    for concept in concepts:
        matches = filt[filt["concept"] == concept]
        if matches.empty:
            continue
        for val in matches[column].tolist():
            if pd.notna(val):
                try:
                    return float(val), concept
                except (TypeError, ValueError):
                    continue
    return None, None


# ---------------------------------------------------------------------------
# Metadata sheet helper
# ---------------------------------------------------------------------------
def _read_metadata(xl_path: Path) -> dict[str, str]:
    try:
        mdf = pd.read_excel(xl_path, sheet_name="Metadata")
    except Exception:
        return {}
    out: dict[str, str] = {}
    if "Field" in mdf.columns and "Value" in mdf.columns:
        for _, row in mdf.iterrows():
            k = str(row["Field"]).strip()
            v = row["Value"]
            if pd.isna(v):
                out[k] = ""
                continue
            # pandas reads date-only columns as Timestamp w/ 00:00:00 suffix.
            if isinstance(v, (pd.Timestamp, datetime)):
                out[k] = v.strftime("%Y-%m-%d")
            elif isinstance(v, date):
                out[k] = v.isoformat()
            else:
                s = str(v).strip()
                # Trim trailing " 00:00:00" from string-form timestamps
                if len(s) == 19 and s.endswith(" 00:00:00"):
                    s = s[:10]
                out[k] = s
    return out


def _read_sheet(xl_path: Path, sheet: str) -> Optional[pd.DataFrame]:
    try:
        return pd.read_excel(xl_path, sheet_name=sheet)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Row builders
# ---------------------------------------------------------------------------
def _derive_fy_from_end(end_iso: str, fy_end_iso: Optional[str]) -> Optional[int]:
    """
    Given a period-end date string and the most-recent FY-end date,
    decide which fiscal year that period belongs to.

    Rule: if `end` falls after the FY anniversary month-day, it's in FY
    (year_of_end + 1); otherwise it's in FY year_of_end.

    Example: FY ends Aug 31. A quarter ending 2026-02-28 (before Aug 31)
    belongs to fiscal year ending 2026-08-31 → FY 2026.
    """
    try:
        end = datetime.strptime(end_iso, "%Y-%m-%d").date()
    except Exception:
        return None
    if not fy_end_iso:
        return end.year
    try:
        fy = datetime.strptime(fy_end_iso, "%Y-%m-%d").date()
    except Exception:
        return end.year
    # The fiscal year label is the calendar year of the FY-end date.
    # Find the FY that contains `end`: roll fy backward in 1-yr steps until
    # fy >= end, then fy.year is the label.
    # Start from the known fy-end year of `end`:
    candidate_year = end.year
    # construct FY-end for candidate_year using fy_end month/day
    try:
        candidate = date(candidate_year, fy.month, fy.day)
    except ValueError:
        candidate = date(candidate_year, fy.month, 28)
    if end > candidate:
        candidate_year += 1
    return candidate_year


def _build_period_row(
    is_df: Optional[pd.DataFrame],
    bs_df: Optional[pd.DataFrame],
    cf_df: Optional[pd.DataFrame],
    *,
    is_col: Optional[str],
    bs_col: Optional[str],
    cf_col: Optional[str],
    end: str,
    fy: Optional[int],
    fp: str,
    ytd: bool = False,
) -> dict[str, Any]:
    """Collect all metrics into one row for a given period context."""
    row: dict[str, Any] = {
        "fy": fy,
        "fp": fp,
        "end": end,
        "ytd": ytd,
    }
    tags: dict[str, str] = {}

    # Income-statement metrics
    if is_df is not None and is_col:
        for metric in IS_METRICS:
            v, tag = _pick_value_with_tag(is_df, CONCEPT_PRIORITIES[metric], is_col)
            if v is not None:
                row[metric] = v
                if tag:
                    tags[metric] = tag

    # Cash-flow metrics
    # edgartools signs outflow concepts as negative. The downstream pipeline
    # expects CapEx / Dividends / Buybacks as *positive magnitudes* (outflow
    # amount), matching the companyfacts convention. Normalize here.
    OUTFLOW_METRICS = {"CapEx", "Dividends", "BuybacksCash"}  # DepreciationAmortization is an inflow add-back
    if cf_df is not None and cf_col:
        for metric in CF_METRICS:
            v, tag = _pick_value_with_tag(cf_df, CONCEPT_PRIORITIES[metric], cf_col)
            if v is not None:
                if metric in OUTFLOW_METRICS:
                    v = abs(v)
                row[metric] = v
                if tag:
                    tags[metric] = tag

    # Balance-sheet metrics
    if bs_df is not None and bs_col:
        for metric in BS_METRICS:
            v, tag = _pick_value_with_tag(bs_df, CONCEPT_PRIORITIES[metric], bs_col)
            if v is not None:
                row[metric] = v
                if tag:
                    tags[metric] = tag
        # Derive TotalDebt if absent
        if "TotalDebt" not in row:
            ltd = row.get("LongTermDebt", 0) or 0
            std = row.get("ShortTermDebt", 0) or 0
            if ltd or std:
                row["TotalDebt"] = ltd + std

    # ── Bank / thrift revenue fix ──────────────────────────────────────────
    # InterestAndDividendIncomeOperating is total interest income (bank top line).
    # NoninterestIncome is fees/BOLI/etc. Contract-with-customer revenue is only
    # a slice of noninterest income — never use it alone as "Revenue".
    interest = row.get("InterestIncome")
    nonint = row.get("NoninterestIncome")
    net_ii = row.get("NetInterestIncome")
    rev_tag = (tags.get("Revenue") or "")
    picked_contract = "RevenueFromContract" in rev_tag or "SalesRevenue" in rev_tag

    if interest is not None:
        # Prefer total interest + noninterest as operating revenue (bank convention)
        if nonint is not None:
            row["Revenue"] = float(interest) + float(nonint)
            tags["Revenue"] = "InterestAndDividendIncomeOperating+NoninterestIncome"
            row["_revenue_basis"] = "bank_total_interest_plus_noninterest"
        else:
            row["Revenue"] = float(interest)
            tags["Revenue"] = tags.get("InterestIncome") or "InterestAndDividendIncomeOperating"
            row["_revenue_basis"] = "bank_interest_income"
    elif picked_contract and net_ii is not None and nonint is not None:
        # Contract tag alone understates bank top line — rebuild
        row["Revenue"] = float(net_ii) + float(nonint)
        tags["Revenue"] = "InterestIncomeExpenseNet+NoninterestIncome"
        row["_revenue_basis"] = "bank_nii_plus_noninterest"
    elif row.get("Revenue") is None and net_ii is not None:
        row["Revenue"] = float(net_ii)
        tags["Revenue"] = tags.get("NetInterestIncome") or "InterestIncomeExpenseNet"
        row["_revenue_basis"] = "bank_net_interest_income"

    # Bank gross-profit proxy = net interest income when GrossProfit absent
    if row.get("GrossProfit") is None and net_ii is not None:
        row["GrossProfit"] = float(net_ii)
        tags["GrossProfit"] = tags.get("NetInterestIncome") or "InterestIncomeExpenseNet"

    # Derive GrossProfit when the tag is absent from the filing
    if "GrossProfit" not in row and row.get("Revenue") and row.get("CostOfRevenue"):
        row["GrossProfit"] = row["Revenue"] - row["CostOfRevenue"]

    # Derive FCF = OCF - CapEx.
    # If CapEx tag is absent (e.g. asset-light service companies), treat as 0
    # so FCF still renders rather than showing N/A.
    if "OperatingCashFlow" in row:
        capex = row.get("CapEx") or 0
        row["FreeCashFlow"] = row["OperatingCashFlow"] - capex
    rev = row.get("Revenue")
    if rev and row.get("GrossProfit") is not None:
        row["GrossMargin"] = row["GrossProfit"] / rev
    if rev and row.get("OperatingIncome") is not None:
        row["OperatingMargin"] = row["OperatingIncome"] / rev
    if rev and row.get("NetIncome") is not None:
        row["NetMargin"] = row["NetIncome"] / rev
    # EBITDA = OperatingIncome + D&A (non-GAAP; always derived)
    if row.get("OperatingIncome") is not None and row.get("DepreciationAmortization"):
        row["EBITDA"] = row["OperatingIncome"] + row["DepreciationAmortization"]
        if rev:
            row["EBITDAMargin"] = row["EBITDA"] / rev

    if tags:
        row["_tags"] = tags
    return row


# ---------------------------------------------------------------------------
# Main extractor
# ---------------------------------------------------------------------------
def extract_financials(
    ticker: str,
    stock_financials_dir: Optional[Path] = None,
) -> dict[str, Any]:
    tkr = ticker.strip().upper()
    books = _resolve_workbooks(tkr, stock_financials_dir)

    errors: list[str] = []
    if not books:
        raise FileNotFoundError(
            f"No SEC XBRL Excel files found for {tkr}. Expected at "
            f"{(stock_financials_dir or _default_stock_dir()).resolve() / tkr}/. "
            "Run pull_sec_financials.py first."
        )

    latest_filings: dict[str, dict] = {}
    entity_name = tkr

    # ---------- Annuals from 10-K ----------
    annuals: list[dict[str, Any]] = []
    k10_path = books.get("10-K")
    k10_meta: dict[str, str] = {}
    if k10_path:
        k10_meta = _read_metadata(k10_path)
        entity_name = k10_meta.get("Company") or entity_name
        latest_filings["10-K"] = {
            "accession": k10_meta.get("Accession Number", ""),
            "filed": k10_meta.get("Filing Date", ""),
            "reportDate": k10_meta.get("Period Of Report", ""),
            "primaryDocument": "",
        }
        is_df = _read_sheet(k10_path, "Income Statement")
        bs_df = _read_sheet(k10_path, "Balance Sheet")
        cf_df = _read_sheet(k10_path, "Cash Flow Statement")

        # FY columns (duration) across IS/CF
        fy_cols_is = [p for p in _period_columns(is_df if is_df is not None else pd.DataFrame())
                      if p["fp"] == "FY"]
        fy_cols_cf = [p for p in _period_columns(cf_df if cf_df is not None else pd.DataFrame())
                      if p["fp"] == "FY"]
        bs_cols = [p for p in _period_columns(bs_df if bs_df is not None else pd.DataFrame())
                   if p["kind"] == "INSTANT"]

        # Sort descending so the latest FY is first.
        fy_cols_is.sort(key=lambda p: p["end"], reverse=True)
        for fp in fy_cols_is:
            end = fp["end"]
            # Match CF column on exact end; else None
            cf_col = next((c["raw"] for c in fy_cols_cf if c["end"] == end), None)
            # BS: find the instant whose date == this FY end, else nearest <=
            bs_col = None
            if bs_cols:
                exact = [c for c in bs_cols if c["end"] == end]
                if exact:
                    bs_col = exact[0]["raw"]
            fy_year = _derive_fy_from_end(end, end)  # FY label = year of end
            row = _build_period_row(
                is_df, bs_df, cf_df,
                is_col=fp["raw"], bs_col=bs_col, cf_col=cf_col,
                end=end, fy=fy_year, fp="FY", ytd=False,
            )
            row["accession"] = k10_meta.get("Accession Number", "")
            row["filed"] = k10_meta.get("Filing Date", "")
            annuals.append(row)

    # ---------- Quarterly from 10-Q ----------
    quarterly: dict[str, Any] = {}
    q10_path = books.get("10-Q")
    if q10_path:
        q10_meta = _read_metadata(q10_path)
        if not entity_name or entity_name == tkr:
            entity_name = q10_meta.get("Company") or entity_name
        latest_filings["10-Q"] = {
            "accession": q10_meta.get("Accession Number", ""),
            "filed": q10_meta.get("Filing Date", ""),
            "reportDate": q10_meta.get("Period Of Report", ""),
            "primaryDocument": "",
        }
        is_df = _read_sheet(q10_path, "Income Statement")
        bs_df = _read_sheet(q10_path, "Balance Sheet")
        cf_df = _read_sheet(q10_path, "Cash Flow Statement")

        is_cols = _period_columns(is_df if is_df is not None else pd.DataFrame())
        cf_cols = _period_columns(cf_df if cf_df is not None else pd.DataFrame())
        bs_cols = [p for p in _period_columns(bs_df if bs_df is not None else pd.DataFrame())
                   if p["kind"] == "INSTANT"]

        # Quarterly durations (Q1/Q2/Q3/Q4) sorted latest-first
        q_cols = [p for p in is_cols if p["fp"] in ("Q1", "Q2", "Q3", "Q4")]
        q_cols.sort(key=lambda p: p["end"], reverse=True)

        ytd_cols = [p for p in is_cols if p["fp"] == "YTD"]
        ytd_cols.sort(key=lambda p: p["end"], reverse=True)

        # ── Q1 10-Q special case ────────────────────────────────────────────
        # For Q1 filings the 3-month period IS the fiscal YTD period.
        # edgartools labels the IS columns as "(Q1)" not "(YTD)", so ytd_cols
        # ends up empty and the TTM bridge formula falls back to the prior FY
        # annual for every flow metric (i.e. TTM appears identical to FY).
        # Fix: treat the Q-period columns as the YTD proxy for Q1 filings.
        if not ytd_cols and q_cols:
            ytd_cols = list(q_cols)   # copy; sort already done above

        fy_end_iso = k10_meta.get("Period Of Report") if k10_meta else None

        if q_cols:
            current_q = q_cols[0]
            prior_q = q_cols[1] if len(q_cols) > 1 else None

            cur_fy = _derive_fy_from_end(current_q["end"], fy_end_iso)
            cur_fp = current_q["fp"]

            # BS column closest to the current Q end
            bs_cur = None
            if bs_cols:
                exact = [c for c in bs_cols if c["end"] == current_q["end"]]
                if exact:
                    bs_cur = exact[0]["raw"]

            # For Q1 10-Q: the 3-month period IS the YTD period, so CF data is
            # valid for the current quarter row too (not just the YTD row).
            cf_q1_col = (
                _find_cf_col_for_end(cf_cols, current_q["end"])
                if cur_fp == "Q1" else None
            )

            # Build current quarter row.
            # Non-Q1: cf_col=None (10-Q CF is cumulative YTD; no standalone 3-month CF)
            # Q1:     cf_col=cf_q1_col (3-month == YTD, so CF is valid here)
            quarterly["current"] = _build_period_row(
                is_df, bs_df, cf_df,
                is_col=current_q["raw"], bs_col=bs_cur, cf_col=cf_q1_col,
                end=current_q["end"], fy=cur_fy, fp=cur_fp, ytd=False,
            )
            # Prior-year same quarter (no BS — 10-Q only carries current Q + prior FY end)
            if prior_q:
                prior_fy = cur_fy - 1 if cur_fy else None
                cf_prior_q1 = (
                    _find_cf_col_for_end(cf_cols, prior_q["end"])
                    if cur_fp == "Q1" else None
                )
                quarterly["prior_year_same_q"] = _build_period_row(
                    is_df, bs_df, cf_df,
                    is_col=prior_q["raw"], bs_col=None, cf_col=cf_prior_q1,
                    end=prior_q["end"], fy=prior_fy, fp=cur_fp, ytd=False,
                )

            # YTD rows (IS + CF aligned by end date)
            # Use _find_cf_col_for_end which handles "YTD", "FY", and "Q1" labels
            if ytd_cols:
                cur_ytd = next((c for c in ytd_cols if c["end"] == current_q["end"]), ytd_cols[0])
                prior_ytd = next(
                    (c for c in ytd_cols if prior_q and c["end"] == prior_q["end"]),
                    ytd_cols[1] if len(ytd_cols) > 1 else None,
                )
                cf_ytd_cur = _find_cf_col_for_end(cf_cols, cur_ytd["end"])
                quarterly["current_ytd"] = _build_period_row(
                    is_df, bs_df, cf_df,
                    is_col=cur_ytd["raw"], bs_col=bs_cur, cf_col=cf_ytd_cur,
                    end=cur_ytd["end"], fy=cur_fy, fp=cur_fp, ytd=True,
                )
                if prior_ytd:
                    cf_ytd_prior = _find_cf_col_for_end(cf_cols, prior_ytd["end"])
                    prior_fy = cur_fy - 1 if cur_fy else None
                    quarterly["prior_ytd"] = _build_period_row(
                        is_df, bs_df, cf_df,
                        is_col=prior_ytd["raw"], bs_col=None, cf_col=cf_ytd_prior,
                        end=prior_ytd["end"], fy=prior_fy, fp=cur_fp, ytd=True,
                    )

            quarterly["meta"] = {
                "fy": cur_fy,
                "fp": cur_fp,
                "reportDate": current_q["end"],
                "accession": q10_meta.get("Accession Number", ""),
                "filed": q10_meta.get("Filing Date", ""),
            }
        else:
            errors.append(
                "10-Q income statement did not expose a 3-month quarterly column; "
                "latest quarterly section omitted."
            )

    # ---------- Which filing is latest? ----------
    latest_filing_type = "10-K"
    if "10-Q" in latest_filings and "10-K" in latest_filings:
        q_filed = latest_filings["10-Q"].get("filed", "")
        k_filed = latest_filings["10-K"].get("filed", "")
        if q_filed and k_filed and q_filed > k_filed:
            latest_filing_type = "10-Q"
        elif q_filed and not k_filed:
            latest_filing_type = "10-Q"
    elif "10-Q" in latest_filings:
        latest_filing_type = "10-Q"

    ttm = _compute_ttm(annuals, quarterly)

    return {
        "ticker": tkr,
        "cik": "",
        "entity_name": entity_name,
        "latest_filings": latest_filings,
        "latest_filing_type": latest_filing_type,
        "annuals": annuals,
        "quarterly": quarterly,
        "ttm": ttm,
        "errors": errors,
        "source": "excel_xbrl",
    }


# ---------------------------------------------------------------------------
# TTM computation (bridge formula: last FY + current YTD − prior YTD)
# ---------------------------------------------------------------------------
def _compute_ttm(annuals: list[dict], quarterly: dict) -> dict:
    """
    Compute trailing-twelve-month (TTM) figures.

    For flow metrics (P&L, cash flow):
        TTM = last_FY_annual + current_YTD − prior_year_YTD

    For point-in-time metrics (balance sheet):
        TTM = latest quarterly balance (or last FY if no quarter available)

    The result is keyed identically to an annual/quarterly row so
    format_verified_block can render it with the same column set.
    """
    if not annuals:
        return {}

    last_fy  = annuals[0]
    cur_ytd  = quarterly.get("current_ytd") or {}
    pri_ytd  = quarterly.get("prior_ytd")   or {}
    cur_q    = quarterly.get("current")     or {}
    q_meta   = quarterly.get("meta")        or {}

    have_ytd = bool(cur_ytd and pri_ytd)

    ttm: dict = {}

    # ── Flow metrics ─────────────────────────────────────────────────────────
    FLOW = [
        "Revenue", "CostOfRevenue", "GrossProfit",
        "OperatingIncome", "NetIncome",
        "OperatingCashFlow", "CapEx", "FreeCashFlow",
        "DepreciationAmortization", "RnD",
        "Dividends", "BuybacksCash",
    ]
    for m in FLOW:
        fy_v  = last_fy.get(m)
        cy_v  = cur_ytd.get(m)
        py_v  = pri_ytd.get(m)
        if fy_v is not None and have_ytd and cy_v is not None and py_v is not None:
            ttm[m] = fy_v + cy_v - py_v
        elif fy_v is not None:
            # No quarterly bridge available — fall back to last FY
            ttm[m] = fy_v

    # ── Re-derive FCF if still missing (OCF available but CapEx wasn't bridged)
    if "FreeCashFlow" not in ttm and ttm.get("OperatingCashFlow") is not None:
        ttm["FreeCashFlow"] = ttm["OperatingCashFlow"] - (ttm.get("CapEx") or 0)

    # ── EBITDA = OpInc + D&A (non-GAAP, always re-derived) ───────────────────
    if ttm.get("OperatingIncome") is not None and ttm.get("DepreciationAmortization"):
        ttm["EBITDA"] = ttm["OperatingIncome"] + ttm["DepreciationAmortization"]

    # ── Margins ───────────────────────────────────────────────────────────────
    rev = ttm.get("Revenue")
    if rev:
        for metric, key in [
            ("GrossProfit",    "GrossMargin"),
            ("OperatingIncome","OperatingMargin"),
            ("NetIncome",      "NetMargin"),
            ("EBITDA",         "EBITDAMargin"),
        ]:
            if ttm.get(metric) is not None:
                ttm[key] = ttm[metric] / rev

    # ── Point-in-time / balance sheet ────────────────────────────────────────
    POINT = [
        "Cash", "ShortTermInvestments", "TotalAssets", "TotalLiabilities",
        "StockholdersEquity", "LongTermDebt", "ShortTermDebt", "TotalDebt",
        "DilutedShares", "SharesOutstanding",
    ]
    for m in POINT:
        val = cur_q.get(m) if cur_q.get(m) is not None else last_fy.get(m)
        if val is not None:
            ttm[m] = val

    # ── EPS = TTM Net Income / TTM Diluted Shares ─────────────────────────────
    ni  = ttm.get("NetIncome")
    shr = ttm.get("DilutedShares") or ttm.get("SharesOutstanding")
    if ni is not None and shr and shr != 0:
        ttm["DilutedEPS"] = ni / shr

    # ── Net Debt ──────────────────────────────────────────────────────────────
    td = ttm.get("TotalDebt")
    cash = ttm.get("Cash")
    if td is not None and cash is not None:
        ttm["NetDebt"] = td - cash

    # ── Period label ──────────────────────────────────────────────────────────
    ttm["end"]    = q_meta.get("reportDate") or last_fy.get("end", "")
    ttm["method"] = (
        f"bridge: FY{last_fy.get('fy','')} + {q_meta.get('fp','YTD')} YTD delta"
        if have_ytd else f"FY{last_fy.get('fy','')} annual (no 10-Q bridge)"
    )

    return ttm


# ---------------------------------------------------------------------------
# Verified-data text block (mirrors sec_edgar_xbrl.format_verified_block)
# ---------------------------------------------------------------------------
def _fmt_money(val) -> str:
    if val is None or val == "" or val == "N/A":
        return "N/A"
    try:
        return f"{float(val) / 1_000_000:,.1f}"
    except Exception:
        return str(val)


def _fmt_pct(val) -> str:
    if val is None or val == "":
        return "N/A"
    try:
        return f"{float(val) * 100:.1f}%"
    except Exception:
        return "N/A"


def _fmt_eps(val) -> str:
    if val is None or val == "":
        return "N/A"
    try:
        return f"{float(val):.2f}"
    except Exception:
        return "N/A"


def _filing_url(cik: str, accession: str, primary_doc: str = "") -> str:
    if not accession:
        return ""
    acc_nodash = accession.replace("-", "")
    cik_int = int(cik) if (cik and cik.isdigit()) else 0
    if primary_doc and cik_int:
        return f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/{primary_doc}"
    if cik_int:
        return f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K&dateb=&owner=include&count=40"
    return f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&action=getcompany&accession_number={accession}"



# ---------------------------------------------------------------------------
# Financials-tab Postgres store → same shape as extract_financials()
# ---------------------------------------------------------------------------
# The desk Financials tab persists SEC XBRL history into company_financials
# (period_end keyed, calendar-aligned FY labels). Analyze used to re-pull
# Excel/companyfacts at report time — after Railway restarts those workbooks
# are gone, companyfacts often lags or mislabels FY, and the LLM then
# rewrote "FY2023 ending 2023-12-31" as "FY2025" while keeping 2023 numbers
# (ROKU ticket 2026-07-31). Prefer the store when it has annuals.
# ---------------------------------------------------------------------------
_DB_TO_METRIC = {
    "revenue": "Revenue", "cost_of_revenue": "CostOfRevenue",
    "gross_profit": "GrossProfit", "operating_income": "OperatingIncome",
    "net_income": "NetIncome", "rnd": "RnD", "dep_amort": "DepreciationAmortization",
    "operating_cash_flow": "OperatingCashFlow", "capex": "CapEx",
    "free_cash_flow": "FreeCashFlow", "dividends": "Dividends",
    "buybacks": "BuybacksCash", "ebitda": "EBITDA",
    "diluted_eps": "DilutedEPS", "diluted_shares": "DilutedShares",
    "shares_outstanding": "SharesOutstanding", "cash": "Cash",
    "short_term_investments": "ShortTermInvestments",
    "total_assets": "TotalAssets", "total_liabilities": "TotalLiabilities",
    "stockholders_equity": "StockholdersEquity",
    "long_term_debt": "LongTermDebt", "short_term_debt": "ShortTermDebt",
    "total_debt": "TotalDebt",
    "gross_margin": "GrossMargin", "operating_margin": "OperatingMargin",
    "net_margin": "NetMargin", "ebitda_margin": "EBITDAMargin",
}


def _db_row_to_period(r: dict) -> dict[str, Any]:
    """Map a company_financials row (snake_case, dollars) → extract shape."""
    pe = r.get("period_end")
    if hasattr(pe, "isoformat"):
        end = pe.isoformat()[:10]
    else:
        end = str(pe or "")[:10]
    ps = r.get("period_start")
    if hasattr(ps, "isoformat"):
        start = ps.isoformat()[:10]
    else:
        start = str(ps or "")[:10] if ps else ""
    fy = r.get("fy")
    try:
        fy_i = int(fy) if fy is not None else None
    except (TypeError, ValueError):
        fy_i = None
    # Align annual FY label with period-end year when SEC/store drifted
    # (calendar YE filers). Non-calendar annuals (e.g. Sep FY) still have
    # end.year == fiscal year label in our history extractor.
    if (r.get("period_type") or "").lower() == "annual" and end and len(end) >= 4:
        try:
            end_y = int(end[:4])
            if fy_i is None or abs(fy_i - end_y) >= 2:
                fy_i = end_y
        except ValueError:
            pass
    out: dict[str, Any] = {
        "fy": fy_i,
        "fp": (r.get("fp") or ("FY" if (r.get("period_type") or "") == "annual" else "")),
        "end": end,
        "start": start,
        "ytd": False,
        "accession": r.get("accession") or "",
        "filed": (r.get("filed").isoformat()[:10] if hasattr(r.get("filed"), "isoformat")
                  else str(r.get("filed") or "")[:10]),
    }
    for col, metric in _DB_TO_METRIC.items():
        v = r.get(col)
        if v is None:
            continue
        try:
            out[metric] = float(v)
        except (TypeError, ValueError):
            continue
    # Re-derive margins if missing (DB may store fractions already)
    rev = out.get("Revenue")
    if rev and out.get("GrossProfit") is not None and "GrossMargin" not in out:
        out["GrossMargin"] = out["GrossProfit"] / rev
    if rev and out.get("OperatingIncome") is not None and "OperatingMargin" not in out:
        out["OperatingMargin"] = out["OperatingIncome"] / rev
    if rev and out.get("NetIncome") is not None and "NetMargin" not in out:
        out["NetMargin"] = out["NetIncome"] / rev
    if (out.get("EBITDA") is None and out.get("OperatingIncome") is not None
            and out.get("DepreciationAmortization") is not None):
        out["EBITDA"] = out["OperatingIncome"] + out["DepreciationAmortization"]
    if rev and out.get("EBITDA") is not None and "EBITDAMargin" not in out:
        out["EBITDAMargin"] = out["EBITDA"] / rev
    return out


def _sum_metric_rows(rows: list[dict], metric: str) -> Optional[float]:
    vals = []
    for r in rows:
        v = r.get(metric)
        if v is None:
            continue
        try:
            vals.append(float(v))
        except (TypeError, ValueError):
            pass
    if not vals:
        return None
    return sum(vals)


def extract_financials_from_db(ticker: str) -> Optional[dict[str, Any]]:
    """Load PRIMARY financials from Postgres company_financials (Financials tab).

    Returns the same shape as extract_financials(), or None if unavailable /
    empty. Never raises for missing table / no rows — returns None.
    """
    tkr = (ticker or "").strip().upper()
    if not tkr:
        return None
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        return None
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        return None

    try:
        conn = psycopg2.connect(url, connect_timeout=10,
                                options="-c statement_timeout=15000")
        conn.autocommit = True
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT * FROM company_financials
                     WHERE ticker = %s
                     ORDER BY period_end DESC NULLS LAST
                    """,
                    (tkr,),
                )
                raw = cur.fetchall() or []
        finally:
            conn.close()
    except Exception as e:
        print(f"[excel_financials] DB load {tkr}: {e!s:.160}", flush=True)
        return None

    if not raw:
        return None

    # Normalize keys to plain dicts
    rows = [dict(r) for r in raw]
    entity = ""
    cik = ""
    for r in rows:
        entity = entity or (r.get("entity_name") or "")
        cik = cik or (r.get("cik") or "")

    annuals_raw = [r for r in rows if (r.get("period_type") or "").lower() == "annual"]
    quarters_raw = [r for r in rows if (r.get("period_type") or "").lower() in ("quarter", "quarterly")]

    # Dedupe annuals: one per FY, prefer has-revenue + later period_end
    by_fy: dict[int, dict] = {}
    for r in annuals_raw:
        p = _db_row_to_period(r)
        fy = p.get("fy")
        if fy is None:
            continue
        prev = by_fy.get(int(fy))
        if prev is None:
            by_fy[int(fy)] = p
            continue
        # Prefer row with revenue
        if p.get("Revenue") is not None and prev.get("Revenue") is None:
            by_fy[int(fy)] = p
        elif (p.get("Revenue") is not None) == (prev.get("Revenue") is not None):
            if (p.get("end") or "") > (prev.get("end") or ""):
                by_fy[int(fy)] = p

    annuals = [by_fy[k] for k in sorted(by_fy.keys(), reverse=True)
               if by_fy[k].get("Revenue") is not None][:5]
    if not annuals:
        # Accept annuals without revenue only if nothing better
        annuals = [by_fy[k] for k in sorted(by_fy.keys(), reverse=True)][:3]
    if not annuals:
        return None

    # Quarters newest-first
    q_periods = [_db_row_to_period(r) for r in quarters_raw]
    q_periods = [q for q in q_periods if q.get("end")]
    q_periods.sort(key=lambda q: q.get("end") or "", reverse=True)

    quarterly: dict[str, Any] = {}
    if q_periods:
        cur = q_periods[0]
        quarterly["current"] = dict(cur)
        # Same fiscal quarter prior year
        cur_fp = cur.get("fp") or ""
        cur_fy = cur.get("fy")
        prior = None
        if cur_fy is not None and cur_fp:
            for q in q_periods[1:]:
                if q.get("fp") == cur_fp and q.get("fy") == int(cur_fy) - 1:
                    prior = q
                    break
        if prior is None and cur.get("end"):
            # Fallback: period_end ~1 year earlier
            try:
                y, m, d = cur["end"].split("-")
                target = f"{int(y)-1}-{m}-{d}"
                prior = next((q for q in q_periods if q.get("end") == target), None)
            except Exception:
                prior = None
        if prior:
            quarterly["prior_year_same_q"] = dict(prior)

        # YTD = sum of quarters in same FY with end <= current end
        def _ytd_sum(fy_val, end_cap: str) -> Optional[dict]:
            parts = [q for q in q_periods
                     if q.get("fy") == fy_val and (q.get("end") or "") <= end_cap]
            if not parts:
                return None
            # Sort oldest first for start date
            parts_asc = sorted(parts, key=lambda q: q.get("end") or "")
            out = {
                "fy": fy_val,
                "fp": cur_fp,
                "end": end_cap,
                "start": parts_asc[0].get("start") or "",
                "ytd": True,
            }
            for metric in ("Revenue", "GrossProfit", "OperatingIncome", "NetIncome",
                           "EBITDA", "OperatingCashFlow", "CapEx", "FreeCashFlow",
                           "DepreciationAmortization"):
                s = _sum_metric_rows(parts, metric)
                if s is not None:
                    out[metric] = s
            # EPS: don't sum — leave blank for YTD aggregate
            rev = out.get("Revenue")
            if rev and out.get("GrossProfit") is not None:
                out["GrossMargin"] = out["GrossProfit"] / rev
            if rev and out.get("OperatingIncome") is not None:
                out["OperatingMargin"] = out["OperatingIncome"] / rev
            if rev and out.get("NetIncome") is not None:
                out["NetMargin"] = out["NetIncome"] / rev
            # BS from latest quarter in the set
            latest_q = max(parts, key=lambda q: q.get("end") or "")
            for metric in ("Cash", "TotalDebt", "TotalAssets", "StockholdersEquity"):
                if latest_q.get(metric) is not None:
                    out[metric] = latest_q[metric]
            return out

        if cur_fy is not None:
            ytd_cur = _ytd_sum(int(cur_fy), cur.get("end") or "")
            if ytd_cur:
                quarterly["current_ytd"] = ytd_cur
            ytd_prior = _ytd_sum(int(cur_fy) - 1, (prior or {}).get("end") or "")
            if ytd_prior:
                quarterly["prior_ytd"] = ytd_prior

        quarterly["meta"] = {
            "fy": cur.get("fy"),
            "fp": cur.get("fp"),
            "reportDate": cur.get("end"),
            "accession": cur.get("accession") or "",
            "filed": cur.get("filed") or "",
        }

    ttm = _compute_ttm(annuals, quarterly)
    # If bridge TTM thin, fall back to sum of last 4 quarters
    if (not ttm or ttm.get("Revenue") is None) and len(q_periods) >= 4:
        last4 = q_periods[:4]
        ttm = {
            "method": "sum4q",
            "end": last4[0].get("end"),
        }
        for metric in ("Revenue", "GrossProfit", "OperatingIncome", "NetIncome",
                       "EBITDA", "OperatingCashFlow", "CapEx", "FreeCashFlow"):
            s = _sum_metric_rows(last4, metric)
            if s is not None:
                ttm[metric] = s
        # BS from latest quarter
        for metric in ("Cash", "TotalDebt", "TotalAssets", "StockholdersEquity"):
            if last4[0].get(metric) is not None:
                ttm[metric] = last4[0][metric]
        rev = ttm.get("Revenue")
        if rev and ttm.get("GrossProfit") is not None:
            ttm["GrossMargin"] = ttm["GrossProfit"] / rev
        if rev and ttm.get("OperatingIncome") is not None:
            ttm["OperatingMargin"] = ttm["OperatingIncome"] / rev
        if rev and ttm.get("NetIncome") is not None:
            ttm["NetMargin"] = ttm["NetIncome"] / rev

    latest_end = (quarterly.get("current") or {}).get("end") or (annuals[0].get("end") if annuals else "")
    latest_filing_type = "10-Q" if quarterly.get("current") else "10-K"

    return {
        "ticker": tkr,
        "cik": str(cik or ""),
        "entity_name": entity or tkr,
        "latest_filings": {
            "10-K": {
                "accession": (annuals[0].get("accession") if annuals else "") or "",
                "filed": (annuals[0].get("filed") if annuals else "") or "",
                "reportDate": (annuals[0].get("end") if annuals else "") or "",
                "primaryDocument": "",
            },
            **({
                "10-Q": {
                    "accession": (quarterly.get("current") or {}).get("accession") or "",
                    "filed": (quarterly.get("current") or {}).get("filed") or "",
                    "reportDate": (quarterly.get("current") or {}).get("end") or "",
                    "primaryDocument": "",
                }
            } if quarterly.get("current") else {}),
        },
        "latest_filing_type": latest_filing_type,
        "annuals": annuals,
        "quarterly": quarterly,
        "ttm": ttm or {},
        "errors": [],
        "source": "company_financials_db",
        "as_of_period_end": latest_end,
    }



def _period_end_str(obj: dict | None) -> str:
    if not obj:
        return ""
    e = obj.get("end") or obj.get("reportDate") or ""
    return str(e)[:10]


def merge_primary_financials(
    db_data: Optional[dict],
    excel_data: Optional[dict],
) -> Optional[dict[str, Any]]:
    """Build the Analyze PRIMARY payload from DB history + live SEC 10-Q.

    Rules (ROKU / earnings-print correctness):
      • Annuals → prefer company_financials (multi-year, YE-aligned).
      • Latest quarter / YTD / prior-year Q → prefer the SEC Excel 10-Q
        extract whenever its period_end is as new as or newer than the DB,
        or when the DB has no quarterly rows. This is how a just-filed
        earnings 10-Q enters the report even if overnight sync skipped
        the ticker (skip_if_stored).
      • TTM is always recomputed from the chosen annuals + quarterly.
    """
    db = db_data if isinstance(db_data, dict) else None
    xl = excel_data if isinstance(excel_data, dict) else None
    if not db and not xl:
        return None

    db_ann = list((db or {}).get("annuals") or [])
    xl_ann = list((xl or {}).get("annuals") or [])
    db_q = dict((db or {}).get("quarterly") or {})
    xl_q = dict((xl or {}).get("quarterly") or {})

    # ── Annuals: union by FY, prefer row with revenue + later end ─────
    by_fy: dict[int, dict] = {}
    for src in (db_ann, xl_ann):
        for row in src:
            try:
                fy = int(row.get("fy")) if row.get("fy") is not None else None
            except (TypeError, ValueError):
                fy = None
            if fy is None:
                continue
            prev = by_fy.get(fy)
            if prev is None:
                by_fy[fy] = dict(row)
                continue
            # Prefer has Revenue
            if row.get("Revenue") is not None and prev.get("Revenue") is None:
                by_fy[fy] = dict(row)
            elif (row.get("Revenue") is not None) == (prev.get("Revenue") is not None):
                if _period_end_str(row) >= _period_end_str(prev):
                    by_fy[fy] = dict(row)
    annuals = [by_fy[k] for k in sorted(by_fy.keys(), reverse=True)
               if by_fy[k].get("Revenue") is not None]
    if not annuals:
        annuals = [by_fy[k] for k in sorted(by_fy.keys(), reverse=True)]
    if not annuals:
        # last resort: take whichever source has annuals raw
        annuals = db_ann or xl_ann

    # ── Quarterly: SEC Excel wins when newer or sole source ───────────
    xl_cur_end = _period_end_str((xl_q.get("current") if xl_q else None) or {})
    db_cur_end = _period_end_str((db_q.get("current") if db_q else None) or {})
    use_excel_q = False
    if xl_q.get("current") and xl_cur_end:
        if not db_cur_end or xl_cur_end >= db_cur_end:
            use_excel_q = True
    quarterly = dict(xl_q) if use_excel_q else dict(db_q)
    q_source = "sec_10q_excel" if use_excel_q else (
        "company_financials_db" if quarterly.get("current") else "none")

    ttm = _compute_ttm(annuals, quarterly) if annuals else {}
    if (not ttm or ttm.get("Revenue") is None) and quarterly.get("current"):
        # sum last-4 not available in this merge path without history; keep bridge
        pass

    ticker = ((db or xl or {}).get("ticker") or "").upper()
    entity = (db or {}).get("entity_name") or (xl or {}).get("entity_name") or ticker
    cik = (db or {}).get("cik") or (xl or {}).get("cik") or ""

    latest_filings = {}
    if db and db.get("latest_filings"):
        latest_filings.update(db["latest_filings"])
    if xl and xl.get("latest_filings"):
        # Excel has the just-downloaded accession/filed — prefer those
        for form, meta in (xl.get("latest_filings") or {}).items():
            latest_filings[form] = meta

    if quarterly.get("current"):
        latest_filing_type = "10-Q"
    elif (xl or {}).get("latest_filing_type") == "10-Q":
        latest_filing_type = "10-Q"
    else:
        latest_filing_type = (xl or db or {}).get("latest_filing_type") or "10-K"

    src_parts = []
    if db_ann:
        src_parts.append("db_annuals")
    if xl_ann and not db_ann:
        src_parts.append("excel_annuals")
    if q_source != "none":
        src_parts.append(q_source)
    source = "+".join(src_parts) if src_parts else "merged"

    out = {
        "ticker": ticker,
        "cik": str(cik or ""),
        "entity_name": entity,
        "latest_filings": latest_filings,
        "latest_filing_type": latest_filing_type,
        "annuals": annuals,
        "quarterly": quarterly,
        "ttm": ttm or {},
        "errors": list((db or {}).get("errors") or []) + list((xl or {}).get("errors") or []),
        "source": source,
        "as_of_period_end": _period_end_str(quarterly.get("current")) or (
            annuals[0].get("end") if annuals else ""),
        "quarterly_source": q_source,
    }
    return out


def upsert_extract_to_company_financials(data: dict) -> int:
    """Best-effort: write annual + quarter periods from an extract into
    company_financials so Financials tab picks up a just-filed 10-Q.

    ON CONFLICT (ticker, period_type, period_end) DO UPDATE — refreshes
    metrics for that period. Returns number of rows upserted. Never raises.
    """
    if not isinstance(data, dict):
        return 0
    tkr = (data.get("ticker") or "").strip().upper()
    if not tkr:
        return 0
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        return 0
    try:
        import psycopg2
    except ImportError:
        return 0

    metric_cols = list(_DB_TO_METRIC.keys())  # snake_case columns
    # Build rows from annuals + quarterly current/prior
    rows: list[dict] = []

    def _add(period: dict | None, ptype: str):
        if not period or not period.get("end"):
            return
        try:
            fy = int(period["fy"]) if period.get("fy") is not None else None
        except (TypeError, ValueError):
            fy = None
        if fy is None:
            return
        fp = period.get("fp") or ("FY" if ptype == "annual" else "")
        if not fp:
            return
        r = {
            "period_type": ptype,
            "fy": fy,
            "fp": fp,
            "end": str(period["end"])[:10],
            "start": str(period.get("start") or "")[:10] or None,
            "filed": str(period.get("filed") or "")[:10] or None,
            "accession": period.get("accession") or None,
        }
        for snake, camel in _DB_TO_METRIC.items():
            v = period.get(camel)
            if v is None:
                r[snake] = None
            else:
                try:
                    r[snake] = float(v)
                except (TypeError, ValueError):
                    r[snake] = None
        rows.append(r)

    for a in (data.get("annuals") or [])[:6]:
        _add(a, "annual")
    q = data.get("quarterly") or {}
    for key, ptype in (
        ("current", "quarter"),
        ("prior_year_same_q", "quarter"),
    ):
        _add(q.get(key), ptype)

    if not rows:
        return 0

    cols = (["ticker", "cik", "entity_name", "period_type", "fy", "fp",
             "period_end", "period_start", "filed", "accession", "derived"]
            + metric_cols)
    ph = ",".join(["%s"] * len(cols))
    upd = [c for c in cols if c not in ("ticker", "period_type", "period_end")]
    set_clause = ",".join(f"{c}=EXCLUDED.{c}" for c in upd) + ", updated_at=now()"
    sql = (f"INSERT INTO company_financials ({','.join(cols)}) VALUES ({ph}) "
           f"ON CONFLICT (ticker, period_type, period_end) DO UPDATE SET {set_clause}")

    n = 0
    try:
        conn = psycopg2.connect(url, connect_timeout=10,
                                options="-c statement_timeout=20000")
        try:
            with conn.cursor() as cur:
                for r in rows:
                    vals = [
                        tkr,
                        (data.get("cik") or None) or None,
                        (data.get("entity_name") or None) or None,
                        r["period_type"], int(r["fy"]), r["fp"],
                        r["end"], r.get("start"), r.get("filed"),
                        r.get("accession"), False,
                    ]
                    vals += [r.get(c) for c in metric_cols]
                    cur.execute(sql, vals)
                    n += 1
            conn.commit()
        finally:
            conn.close()
        if n:
            print(f"[excel_financials] upserted {n} period(s) for {tkr} → "
                  f"company_financials", flush=True)
    except Exception as e:
        print(f"[excel_financials] upsert {tkr} failed: {e!s:.160}", flush=True)
        return 0
    return n


def format_verified_block(data: dict) -> str:
    lines: list[str] = []
    lines.append(f"=== VERIFIED FINANCIAL DATA FOR {data['ticker']} ===")
    lines.append(f"Entity: {data.get('entity_name','')} (source: SEC EDGAR XBRL)")
    lines.append(f"LATEST_FILING_TYPE: {data.get('latest_filing_type','')}")

    latest = data.get("latest_filings", {})
    if "10-K" in latest:
        k = latest["10-K"]
        lines.append(
            f"Latest 10-K: filed {k.get('filed','')}, reportDate "
            f"{k.get('reportDate','')}, accession {k.get('accession','')}"
        )
    if "10-Q" in latest:
        q = latest["10-Q"]
        lines.append(
            f"Latest 10-Q: filed {q.get('filed','')}, reportDate "
            f"{q.get('reportDate','')}, accession {q.get('accession','')}"
        )

    lines.append("")
    lines.append(f"[ANNUAL DATA - source={data.get('source') or 'sec'}, $ in millions unless noted]")
    header = ["FY", "PeriodEnd", "Revenue", "GrossProfit", "GrossMargin%",
              "EBITDA", "EBITDAMargin%", "OpInc", "OpMargin%",
              "NetInc", "NetMargin%", "DilEPS", "OCF", "CapEx", "FCF",
              "Cash", "TotalDebt", "TotalAssets", "Equity"]
    lines.append(" | ".join(header))

    # ── TTM row at the top (pre-computed bridge; Grok must use these directly) ──
    ttm = data.get("ttm", {})
    if ttm:
        lines.append(" | ".join([
            f"TTM ({ttm.get('method','bridge')})",
            str(ttm.get("end", "")),
            _fmt_money(ttm.get("Revenue")),
            _fmt_money(ttm.get("GrossProfit")),
            _fmt_pct(ttm.get("GrossMargin")),
            _fmt_money(ttm.get("EBITDA")),
            _fmt_pct(ttm.get("EBITDAMargin")),
            _fmt_money(ttm.get("OperatingIncome")),
            _fmt_pct(ttm.get("OperatingMargin")),
            _fmt_money(ttm.get("NetIncome")),
            _fmt_pct(ttm.get("NetMargin")),
            _fmt_eps(ttm.get("DilutedEPS")),
            _fmt_money(ttm.get("OperatingCashFlow")),
            _fmt_money(ttm.get("CapEx")),
            _fmt_money(ttm.get("FreeCashFlow")),
            _fmt_money(ttm.get("Cash")),
            _fmt_money(ttm.get("TotalDebt")),
            _fmt_money(ttm.get("TotalAssets")),
            _fmt_money(ttm.get("StockholdersEquity")),
        ]))

    # ── Historical annual rows ────────────────────────────────────────────────
    for row in data.get("annuals", []):
        lines.append(" | ".join([
            f"FY{row.get('fy','')}",
            str(row.get("end", "")),
            _fmt_money(row.get("Revenue")),
            _fmt_money(row.get("GrossProfit")),
            _fmt_pct(row.get("GrossMargin")),
            _fmt_money(row.get("EBITDA")),
            _fmt_pct(row.get("EBITDAMargin")),
            _fmt_money(row.get("OperatingIncome")),
            _fmt_pct(row.get("OperatingMargin")),
            _fmt_money(row.get("NetIncome")),
            _fmt_pct(row.get("NetMargin")),
            _fmt_eps(row.get("DilutedEPS")),
            _fmt_money(row.get("OperatingCashFlow")),
            _fmt_money(row.get("CapEx")),
            _fmt_money(row.get("FreeCashFlow")),
            _fmt_money(row.get("Cash")),
            _fmt_money(row.get("TotalDebt")),
            _fmt_money(row.get("TotalAssets")),
            _fmt_money(row.get("StockholdersEquity")),
        ]))

    quarterly = data.get("quarterly", {})
    if quarterly.get("current"):
        lines.append("")
        lines.append("[QUARTERLY DATA - from latest 10-Q, $ in millions unless noted]")
        lines.append(
            "Period | FY | FP | PeriodEnd | Revenue | GrossProfit | GrossMargin% | "
            "EBITDA | EBITDAMargin% | OpInc | OpMargin% | "
            "NetInc | NetMargin% | DilEPS | OCF | FCF"
        )
        labels = [
            ("Latest Quarter (3mo)", quarterly.get("current")),
            ("Same Q Prior Year (3mo)", quarterly.get("prior_year_same_q")),
            ("Current YTD", quarterly.get("current_ytd")),
            ("Prior YTD", quarterly.get("prior_ytd")),
        ]
        for label, q in labels:
            if not q:
                continue
            lines.append(" | ".join([
                label,
                f"FY{q.get('fy','')}",
                q.get("fp", ""),
                str(q.get("end", "")),
                _fmt_money(q.get("Revenue")),
                _fmt_money(q.get("GrossProfit")),
                _fmt_pct(q.get("GrossMargin")),
                _fmt_money(q.get("EBITDA")),
                _fmt_pct(q.get("EBITDAMargin")),
                _fmt_money(q.get("OperatingIncome")),
                _fmt_pct(q.get("OperatingMargin")),
                _fmt_money(q.get("NetIncome")),
                _fmt_pct(q.get("NetMargin")),
                _fmt_eps(q.get("DilutedEPS")),
                _fmt_money(q.get("OperatingCashFlow")),
                _fmt_money(q.get("FreeCashFlow")),
            ]))
        lines.append(
            "Note: 10-Q Cash Flow statements report YTD only (no 3-month breakdown), "
            "so 'Latest Quarter' OCF/FCF will be blank — this is expected. "
            "TTM cash metrics are pre-computed above using the bridge formula and must be used directly."
        )

    # ── Balance sheet structure (for Section 5C) ──────────────────────────
    # Prefer latest quarter end (point-in-time), then latest annual.
    bs_latest = None
    bs_prior = None
    bs_latest_label = ""
    bs_prior_label = ""
    q_cur = (data.get("quarterly") or {}).get("current") or {}
    anns = data.get("annuals") or []
    if q_cur and any(q_cur.get(k) is not None for k in (
            "TotalAssets", "Cash", "TotalDebt", "StockholdersEquity", "TotalLiabilities")):
        bs_latest = q_cur
        bs_latest_label = f"Q end {q_cur.get('end') or ''} ({q_cur.get('fp') or 'Q'})"
        if anns:
            bs_prior = anns[0]
            bs_prior_label = f"FY{anns[0].get('fy', '')} end {anns[0].get('end') or ''}"
    elif anns:
        bs_latest = anns[0]
        bs_latest_label = f"FY{anns[0].get('fy', '')} end {anns[0].get('end') or ''}"
        if len(anns) > 1:
            bs_prior = anns[1]
            bs_prior_label = f"FY{anns[1].get('fy', '')} end {anns[1].get('end') or ''}"

    if bs_latest:
        lines.append("")
        lines.append(
            f"[BALANCE SHEET STRUCTURE — point-in-time, $ in millions | "
            f"source={data.get('quarterly_source') or data.get('source') or 'sec'}]"
        )
        lines.append(
            "Use this table for Section 5C (Balance Sheet Structure). "
            "Do not invent line items not shown; write N/A."
        )
        lines.append(
            f"Line | {bs_latest_label}"
            + (f" | {bs_prior_label}" if bs_prior else "")
        )
        for label, key in [
            ("Cash & Equivalents", "Cash"),
            ("Short-term Investments", "ShortTermInvestments"),
            ("Total Assets", "TotalAssets"),
            ("Short-term Debt", "ShortTermDebt"),
            ("Long-term Debt", "LongTermDebt"),
            ("Total Debt", "TotalDebt"),
            ("Total Liabilities", "TotalLiabilities"),
            ("Stockholders' Equity", "StockholdersEquity"),
            ("Net Debt / (Net Cash)", "NetDebt"),
        ]:
            lv = bs_latest.get(key)
            if key == "NetDebt" and lv is None:
                td = bs_latest.get("TotalDebt")
                cash = bs_latest.get("Cash")
                if td is not None and cash is not None:
                    lv = td - cash
            row = f"{label} | {_fmt_money(lv)}"
            if bs_prior:
                pv = bs_prior.get(key)
                if key == "NetDebt" and pv is None:
                    td = bs_prior.get("TotalDebt")
                    cash = bs_prior.get("Cash")
                    if td is not None and cash is not None:
                        pv = td - cash
                row += f" | {_fmt_money(pv)}"
            lines.append(row)

    if data.get("errors"):
        lines.append("")
        lines.append("NOTES / CAVEATS:")
        for e in data["errors"]:
            lines.append(f" - {e}")

    lines.append("")
    src = data.get("source") or "sec_xbrl"
    lines.append(
        "Instruction: use ONLY these numbers for all tables and calculations. "
        f"(source={src}) "
        "The TTM row is pre-computed via the bridge formula (last FY + current YTD delta) — "
        "use it directly for the TTM column; do NOT attempt to recompute it. "
        "GrossProfit may be derived (Revenue - CostOfRevenue) if not directly tagged. "
        "EBITDA is always derived (OperatingIncome + D&A) and is non-GAAP. "
        "If CapEx tag was absent for a period, FCF = OCF (CapEx treated as 0). "
        "If a cell is 'N/A', write 'N/A' — do NOT write a long disclaimer phrase. "
        "NEVER put qualitative words (Elevated, Improving, Turning positive, Solid, "
        "Manageable, Higher, ~7+) in table cells — numbers or N/A only. "
        "CRITICAL YEAR LABELS: Copy FY{year} and PeriodEnd EXACTLY as printed in "
        "the ANNUAL/QUARTERLY rows above. If a row says FY2023 | 2023-12-31, write "
        "FY2023 (ended 2023-12-31) — NEVER relabel older years as the current fiscal "
        "year while keeping old numbers. This PRIMARY block wins over any multi-year "
        "trend block or live web/news."
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse
    import json

    ap = argparse.ArgumentParser(
        description="Read per-ticker SEC EDGAR Excel workbooks and emit the "
                    "verified-data text block used by the DGA report prompt.",
    )
    ap.add_argument("ticker")
    ap.add_argument("--dir", default=None, help="Override STOCK_FINANCIALS_DIR.")
    ap.add_argument("--json-out", default=None, help="Also write raw dict here.")
    args = ap.parse_args()

    result = extract_financials(
        args.ticker,
        stock_financials_dir=Path(args.dir).resolve() if args.dir else None,
    )
    print(format_verified_block(result))
    if args.json_out:
        def _default(o):
            if isinstance(o, (date, datetime)):
                return o.isoformat()
            return str(o)
        Path(args.json_out).write_text(
            json.dumps(result, indent=2, default=_default),
            encoding="utf-8",
        )
        print(f"\nWrote raw data → {args.json_out}")
