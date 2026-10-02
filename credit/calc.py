"""Credit math. Pure functions. Decimal for money. Models do not call this to invent inputs."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from math import exp

D = Decimal
ZERO = D("0")
ONE = D("1")
HUNDRED = D("100")
OUT_OF_MATH = {"low", "unconfirmed"}


def money(value) -> D | None:
    if value is None or value == "" or value == "n/m":
        return None
    if isinstance(value, D):
        return value
    text = str(value).replace(",", "").replace("$", "").replace("%", "").strip()
    if not text or text.lower() in {"n/m", "not public", "not found", "—", "-"}:
        return None
    try:
        return D(text)
    except Exception:
        return None


def usable(field: dict | None) -> bool:
    """Low and unconfirmed facts stay out of the math until someone confirms them."""
    if not isinstance(field, dict):
        return False
    if field.get("status") in {"not_public", "not_found"}:
        return False
    if str(field.get("confidence") or "") in OUT_OF_MATH:
        return False
    if field.get("unverified"):
        return False
    return field.get("value") not in (None, "")


def field_money(field: dict | None) -> D | None:
    if not usable(field):
        return None
    return money(field.get("value"))


def q(value: D, places: str = "0.00000001") -> D:
    return value.quantize(D(places), rounding=ROUND_HALF_UP)


def days_30_360(start: date, end: date) -> int:
    d1 = min(start.day, 30)
    d2 = min(end.day, 30) if d1 == 30 else end.day
    return 360 * (end.year - start.year) + 30 * (end.month - start.month) + (d2 - d1)


def add_months(day: date, months: int) -> date:
    month_index = day.month - 1 + months
    year = day.year + month_index // 12
    month = month_index % 12 + 1
    # Clamp to the month length, then prefer the original day (maturity day).
    from calendar import monthrange
    last = monthrange(year, month)[1]
    return date(year, month, min(day.day, last))


def coupon_dates(maturity: date, frequency: int, issue: date) -> list[date]:
    step = 12 // frequency
    dates: list[date] = []
    cursor = maturity
    while cursor > issue:
        dates.append(cursor)
        cursor = add_months(maturity, -step * len(dates))
    dates.reverse()
    return dates


def _year_frac(start: date, end: date, day_count: str) -> D:
    if day_count == "ACT/ACT":
        return D(str((end - start).days)) / D("365")
    return D(days_30_360(start, end)) / D("360")


def bond_cashflows(
    *,
    coupon: D,
    maturity: date,
    settlement: date,
    issue: date | None = None,
    frequency: int = 2,
    day_count: str = "30/360",
    face: D = HUNDRED,
) -> tuple[list[tuple[D, D]], str]:
    """Cash flows per 100 face after settlement. Returns (time_years, amount) and an assumption note."""
    issue = issue or settlement
    schedule = coupon_dates(maturity, frequency, issue)
    step = 12 // frequency
    previous = add_months(schedule[0], -step) if schedule else issue
    note = (
        "First coupon date is not public. Coupons use a regular schedule ending on the maturity "
        "day and month. Accrued interest is zero on the issue date."
    )
    flows: list[tuple[D, D]] = []
    full = face * coupon / D(frequency)
    prev = previous
    for when in schedule:
        if when <= settlement:
            prev = when
            continue
        if issue > prev and issue < when:
            length = _year_frac(prev, when, day_count)
            stub = _year_frac(issue, when, day_count)
            pay = full * (stub / length) if length else full
        else:
            pay = full
        if when == maturity:
            pay += face
        flows.append((_year_frac(settlement, when, day_count), pay))
        prev = when
    return flows, note


def accrued_per_hundred(
    *,
    coupon: D,
    maturity: date,
    settlement: date,
    issue: date | None = None,
    frequency: int = 2,
    day_count: str = "30/360",
) -> D:
    issue = issue or settlement
    if settlement <= issue:
        return ZERO
    schedule = coupon_dates(maturity, frequency, issue)
    step = 12 // frequency
    previous = add_months(schedule[0], -step) if schedule else issue
    for when in schedule:
        if when > settlement:
            break
        previous = when
    next_date = next((when for when in schedule if when > settlement), maturity)
    period = _year_frac(previous, next_date, day_count)
    elapsed = _year_frac(max(previous, issue), settlement, day_count)
    full = HUNDRED * coupon / D(frequency)
    if period <= 0:
        return ZERO
    return q(full * (elapsed / period), "0.00000001")


def dirty_price(clean: D, accrued: D) -> D:
    return q(clean + accrued)


def _present(flows: list[tuple[D, D]], yield_decimal: D, frequency: int) -> D:
    total = ZERO
    base = ONE + yield_decimal / D(frequency)
    if base <= 0:
        return D("1e18")
    for years, amount in flows:
        periods = years * D(frequency)
        total += amount / (base ** periods)
    return total


def solve_ytm(dirty: D, flows: list[tuple[D, D]], frequency: int = 2) -> D | None:
    if not flows or dirty <= 0:
        return None

    def price_at(y: D) -> D:
        return _present(flows, y, frequency)

    lo, hi = D("-0.20"), D("2")
    # Higher yield, lower price.
    if price_at(hi) > dirty:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if price_at(mid) > dirty:
            lo = mid
        else:
            hi = mid
    return q((lo + hi) / 2, "0.00000001")


def yield_to_worst(
    *,
    clean: D,
    coupon: D,
    maturity: date,
    settlement: date,
    issue: date | None = None,
    frequency: int = 2,
    day_count: str = "30/360",
    call_schedule: list[dict] | None = None,
    call_status: str = "ok",
) -> dict:
    """YTW is the minimum yield over calls and maturity. A missing call schedule means YTW = YTM."""
    flows, assumption = bond_cashflows(
        coupon=coupon, maturity=maturity, settlement=settlement, issue=issue,
        frequency=frequency, day_count=day_count,
    )
    accrued = accrued_per_hundred(
        coupon=coupon, maturity=maturity, settlement=settlement, issue=issue,
        frequency=frequency, day_count=day_count,
    )
    dirty = dirty_price(clean, accrued)
    ytm = solve_ytm(dirty, flows, frequency)
    result = {
        "ytm": ytm,
        "ytw": ytm,
        "ytw_note": "YTW = YTM (call schedule not public)" if call_status == "not_public" or not call_schedule else "",
        "accrued": accrued,
        "dirty": dirty,
        "assumption": assumption,
    }
    if call_status == "not_public" or not call_schedule or ytm is None:
        if not result["ytw_note"]:
            result["ytw_note"] = "YTW = YTM (call schedule not public)"
        return result
    yields = [ytm]
    for call in call_schedule:
        call_date = call.get("date")
        call_price = money(call.get("price"))
        if not isinstance(call_date, date) or call_price is None or call_date <= settlement:
            continue
        # Yield to call uses the same coupon machine stopped at the call date, principal = call price.
        stopped, _ = bond_cashflows(
            coupon=coupon, maturity=call_date, settlement=settlement, issue=issue or settlement,
            frequency=frequency, day_count=day_count, face=call_price,
        )
        found = solve_ytm(dirty, stopped, frequency)
        if found is not None:
            yields.append(found)
    result["ytw"] = min(yields)
    result["ytw_note"] = ""
    return result


def interpolate_treasury(curve: dict[str, D], years: D) -> D | None:
    """Linear between Treasury par tenors. Flat past 30 years."""
    tenors = [
        ("1M", D("1") / D("12")),
        ("3M", D("0.25")),
        ("6M", D("0.5")),
        ("1Y", D("1")),
        ("2Y", D("2")),
        ("3Y", D("3")),
        ("5Y", D("5")),
        ("7Y", D("7")),
        ("10Y", D("10")),
        ("20Y", D("20")),
        ("30Y", D("30")),
    ]
    points = [(years_t, curve[name]) for name, years_t in tenors if name in curve and curve[name] is not None]
    if not points:
        return None
    points.sort()
    if years <= points[0][0]:
        return points[0][1]
    if years >= points[-1][0]:
        return points[-1][1]
    for (left_y, left_v), (right_y, right_v) in zip(points, points[1:]):
        if left_y <= years <= right_y:
            span = right_y - left_y
            if span == 0:
                return left_v
            weight = (years - left_y) / span
            return q(left_v + (right_v - left_v) * weight, "0.00000001")
    return points[-1][1]


def g_spread_bp(ytm: D | None, treasury_percent: D | None) -> D | None:
    """G-spread in basis points. Treasury quotes are percent, YTM is a decimal."""
    if ytm is None or treasury_percent is None:
        return None
    treasury = treasury_percent / HUNDRED
    return q((ytm - treasury) * D("10000"), "0.01")


def hazard_pd(spread: D | None, recovery: D, horizons: list[D]) -> dict:
    """λ = s / (1 − R). PD(t) = 1 − exp(−λ t). Spread and recovery are decimals."""
    if spread is None or spread < 0:
        return {"ok": False, "reason": "spread is missing"}
    recovery = min(max(recovery, ZERO), D("0.95"))
    denom = ONE - recovery
    if denom <= 0:
        return {"ok": False, "reason": "recovery is too high"}
    lam = spread / denom
    out = {}
    for horizon in horizons:
        out[str(horizon)] = D(str(1 - exp(float(-lam * horizon))))
    return {"ok": True, "lambda": q(lam), "recovery": recovery, "pd": out}


def leverage(debt: D | None, ebitda: D | None, cash: D | None = None) -> str | None:
    if debt is None or ebitda is None:
        return None
    if ebitda <= 0:
        return "n/m"
    base = debt if cash is None else debt - cash
    return q(base / ebitda, "0.01")


def coverage(numerator: D | None, interest: D | None) -> str | None:
    if numerator is None or interest is None:
        return None
    if interest <= 0:
        return "n/m"
    return q(numerator / interest, "0.01")


def runway_year(
    *,
    cash: D,
    undrawn_revolver: D,
    maturities: dict[int, D],
    fcf: D,
    start_year: int,
    horizon: int = 10,
) -> str:
    """First year liquidity goes negative, or 'beyond horizon'."""
    balance = cash + undrawn_revolver
    burn = -fcf if fcf < 0 else ZERO
    for offset in range(horizon):
        year = start_year + offset
        balance = balance - maturities.get(year, ZERO) - burn
        if balance < 0:
            return str(year)
    return "beyond horizon"


def waterfall(
    *,
    stressed_ebitda: D,
    multiple: D,
    classes: list[dict],
    admin_pct: D = D("0.05"),
    draw_revolver: bool = True,
    accrued_months: int = 6,
) -> dict:
    """Strict priority. Pro rata inside a class. Recovery is paid / claim."""
    ev = stressed_ebitda * multiple
    distributable = ev * (ONE - admin_pct)
    if distributable < 0:
        distributable = ZERO
    ordered = sorted(classes, key=lambda row: int(row.get("priority_rank") or 99))
    rows = []
    remaining = distributable
    batch: list[dict] = []

    def flush(group: list[dict]) -> None:
        nonlocal remaining
        prepared = []
        for row in group:
            claim = money(row.get("claim")) or ZERO
            if draw_revolver and row.get("undrawn"):
                claim += money(row.get("undrawn")) or ZERO
            accrued = money(row.get("accrued"))
            if accrued is None:
                coupon = money(row.get("coupon")) or ZERO
                principal = money(row.get("principal")) or claim
                accrued = principal * coupon * D(accrued_months) / D("12")
                claim += accrued
            prepared.append((row, claim))
        total_claim = sum((claim for _, claim in prepared), ZERO)
        if total_claim <= 0 or remaining <= 0:
            shares = [ZERO for _ in prepared]
        elif remaining >= total_claim:
            shares = [claim for _, claim in prepared]
            remaining -= total_claim
        else:
            shares = [remaining * claim / total_claim for _, claim in prepared]
            remaining = ZERO
        for (row, claim), paid in zip(prepared, shares):
            recovery = q(paid / claim, "0.0001") if claim > 0 else None
            rows.append({
                "id": row.get("id"),
                "name": row.get("name"),
                "priority_rank": row.get("priority_rank"),
                "claim": q(claim, "0.01"),
                "paid": q(paid, "0.01"),
                "recovery": recovery,
                "assumption": row.get("assumption") or "",
            })

    current_rank = None
    for row in ordered:
        rank = int(row.get("priority_rank") or 99)
        if current_rank is None:
            current_rank = rank
        if rank != current_rank:
            flush(batch)
            batch = []
            current_rank = rank
        batch.append(row)
    if batch:
        flush(batch)
    return {
        "ev": q(ev, "0.01"),
        "distributable": q(distributable, "0.01"),
        "left": q(remaining, "0.01"),
        "rows": rows,
    }


def expected_loss(pd_annual: D | None, recovery: D | None) -> D | None:
    if pd_annual is None or recovery is None:
        return None
    lgd = ONE - recovery
    if lgd < 0:
        lgd = ZERO
    return q(pd_annual * lgd, "0.000001")


def verdict(
    *,
    spread: D | None,
    expected_losses: list[D],
    cushion: D = D("0.01"),
    runway_months: int | None = None,
) -> dict:
    """Buy / Watch / Avoid. The model does not set this."""
    losses = [item for item in expected_losses if item is not None]
    if spread is None or not losses:
        return {"call": "Avoid", "reason": "spread or expected loss is missing", "buy_spread": None}
    ordered = sorted(losses)
    mid = ordered[len(ordered) // 2] if len(ordered) % 2 else (ordered[len(ordered) // 2 - 1] + ordered[len(ordered) // 2]) / 2
    buy_at = max(losses) + cushion
    watch_at = mid + (cushion / 2)
    if runway_months is not None and runway_months < 24:
        call, reason = "Avoid", "runway is under 24 months"
    elif spread > buy_at:
        call, reason = "Buy", "spread covers the highest expected loss plus the cushion"
    elif spread >= watch_at:
        call, reason = "Watch", "spread is between the watch line and the buy line"
    else:
        call, reason = "Avoid", "spread does not cover expected loss"
    return {
        "call": call,
        "reason": reason,
        "buy_spread": q(buy_at, "0.000001"),
        "watch_spread": q(watch_at, "0.000001"),
        "spread": spread,
    }


def years_to_maturity(settlement: date, maturity: date) -> D:
    return q(D(days_30_360(settlement, maturity)) / D("360"), "0.0001")
