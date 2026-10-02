"""Yearly cash and leverage paths. The numbers are labeled assumptions, not forecasts."""

from __future__ import annotations

from decimal import Decimal

from credit.calc import coverage, leverage, money

D = Decimal


def project_year(
    *,
    ebitda: D,
    debt: D,
    cash: D,
    interest_rate: D,
    capex: D,
    tax: D,
    maturity_due: D,
    refi_leverage_max: D,
    coverage_min: D,
) -> dict:
    interest = debt * interest_rate
    pretax = ebitda - interest
    tax_paid = pretax * tax if pretax > 0 else D("0")
    fcf = pretax - tax_paid - capex
    cash = cash + fcf
    cover = coverage(ebitda, interest)
    lev = leverage(debt, ebitda)
    defaulted = ""
    if cash < 0:
        defaulted = "liquidity is negative"
    elif maturity_due > 0:
        lev_num = money(lev) if lev != "n/m" else None
        cover_num = money(cover) if cover != "n/m" else None
        if lev_num is not None and lev_num > refi_leverage_max:
            defaulted = "the maturity cannot be refinanced: leverage is above the limit"
        elif cover_num is not None and cover_num < coverage_min:
            defaulted = "the maturity cannot be refinanced: coverage is below the limit"
        else:
            debt = debt - min(maturity_due, debt)
            cash = cash - maturity_due
            if cash < 0:
                defaulted = "cash cannot cover the maturity"
    if not defaulted and fcf > 0:
        paydown = min(fcf, debt)
        debt -= paydown
        cash -= paydown
    return {
        "ebitda": str(ebitda.quantize(D("0.1"))),
        "interest": str(interest.quantize(D("0.1"))),
        "fcf": str(fcf.quantize(D("0.1"))),
        "debt": str(debt.quantize(D("0.1"))),
        "cash": str(cash.quantize(D("0.1"))),
        "leverage": lev if isinstance(lev, str) else str(lev),
        "coverage": cover if isinstance(cover, str) else str(cover),
        "default": defaulted,
    }


def run_path(assumptions: dict) -> list[dict]:
    """assumptions are model_estimate inputs. Missing ones stop the path with a reason."""
    ebitda = money(assumptions.get("ebitda"))
    debt = money(assumptions.get("debt"))
    cash = money(assumptions.get("cash"))
    rate = money(assumptions.get("interest_rate"))
    if None in (ebitda, debt, cash, rate):
        return [{"default": "an input is missing", "year": assumptions.get("start_year") or 2026}]
    growth = money(assumptions.get("growth")) or D("0")
    capex = money(assumptions.get("capex")) or D("0")
    tax = money(assumptions.get("tax")) or D("0")
    refi_max = money(assumptions.get("refi_leverage_max")) or D("6")
    cover_min = money(assumptions.get("coverage_min")) or D("1.5")
    start = int(assumptions.get("start_year") or 2026)
    years = int(assumptions.get("years") or 10)
    maturities = {int(k): money(v) or D("0") for k, v in (assumptions.get("maturities") or {}).items()}
    shock = money(assumptions.get("one_year_shock")) or D("0")
    rows = []
    for offset in range(years):
        year = start + offset
        current = ebitda * ((D("1") + growth) ** offset)
        if offset == 0 and shock:
            current = current * (D("1") + shock)
        step = project_year(
            ebitda=current, debt=debt, cash=cash, interest_rate=rate, capex=capex, tax=tax,
            maturity_due=maturities.get(year, D("0")),
            refi_leverage_max=refi_max, coverage_min=cover_min,
        )
        step["year"] = year
        rows.append(step)
        if step["default"]:
            break
        debt = D(step["debt"])
        cash = D(step["cash"])
    return rows


def seed_scenarios() -> list[dict]:
    """PSKY starting point is the company's 2026 target without treating synergies as fact."""
    base = {
        "ebitda": "12000",
        "debt": "82435",
        "cash": "7803",
        "interest_rate": "0.075",
        "capex": "2000",
        "tax": "0.21",
        "growth": "0.0",
        "refi_leverage_max": "6",
        "coverage_min": "1.5",
        "start_year": 2026,
        "years": 10,
        "maturities": {"2033": "8500"},
    }
    specs = [
        ("synergy_shortfall", "Synergy shortfall",
         "Synergies stop at half of the $6B the company describes. EBITDA stays on the no-synergy base.",
         {**base, "growth": "0.0"},
         ["Quarterly synergy disclosure versus the 30/70/100 phasing"]),
        ("cord_cutting", "Cord-cutting acceleration",
         "Linear-network cash earnings fall 12% a year. This is an assumption, not a forecast.",
         {**base, "growth": "-0.12"},
         ["Distributor carriage disputes", "Linear revenue in each 10-Q"]),
        ("ad_recession", "Ad recession",
         "A one-year 20% advertising shock, then no further decline.",
         {**base, "one_year_shock": "-0.20"},
         ["Advertising revenue growth"]),
        ("higher_rates", "Higher-for-longer refinancing",
         "The 2033 term loan is refinanced 200 bp wider. The 10-year Treasury was 5.24% on 2026-10-01.",
         {**base, "interest_rate": "0.095"},
         ["Treasury 5-year and 10-year", "1L and 2L prices"]),
        ("asset_sales_blocked", "Settlement limits asset sales",
         "The consent decree limits studio sales. A missed film commitment can force a Miramax sale. Deleveraging from asset sales is not in this path.",
         {**base, "growth": "-0.03"},
         ["Film-slate count against the decree", "Asset-sale announcements"]),
        ("combined", "Combined stress",
         "Half the synergies never arrive, earnings fall 8% a year, and the refi rate is 200 bp wider.",
         {**base, "ebitda": "12000", "growth": "-0.08", "interest_rate": "0.095"},
         ["Revolver draws", "Rating actions", "S-4 covenant disclosure"]),
    ]
    out = []
    for sid, name, rationale, assumptions, warnings in specs:
        path = run_path(assumptions)
        default_year = next((row["year"] for row in path if row.get("default")), None)
        out.append({
            "id": sid,
            "name": name,
            "rationale": rationale,
            "confidence": "model_estimate",
            "assumptions": assumptions,
            "warning_indicators": warnings,
            "projection": path,
            "default_year": default_year,
        })
    return out
