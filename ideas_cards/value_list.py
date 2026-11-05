"""Equities that are down, and whose saved fair value is still above the price.

The windows match the way a person scans a list: today, the week, the month,
six months, and twelve months. A name is on the list when the fair value is
above the price and at least one of those windows is down enough to matter.
"""

from __future__ import annotations

from ideas_cards.scanners import session_return

# session counts, drop floor (fraction), words used in the reason line
WINDOWS = (
    ("day", 1, -0.02, "today"),
    ("week", 5, -0.05, "this week"),
    ("month", 21, -0.08, "this month"),
    ("six_month", 126, -0.15, "over 6 months"),
    ("year", 252, -0.20, "over 12 months"),
)


def horizon_returns(bars: list | None, day_return: float | None = None) -> dict:
    """Fraction returns. A quote day-move replaces the one-session bar return."""
    out = {}
    for key, sessions, _floor, _words in WINDOWS:
        if key == "day" and day_return is not None:
            out[key] = float(day_return)
            continue
        out[key] = session_return(bars or [], sessions)
    return out


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _drop_phrase(frac: float, words: str) -> str:
    return f"{abs(frac) * 100:.1f}% {words}"


def reason_line(hits: list[tuple[str, float, str]], fair: float, price: float) -> str:
    phrases = [_drop_phrase(frac, words) for _key, frac, words in hits]
    if len(phrases) == 1:
        dropped = f"Down {phrases[0]}."
    else:
        dropped = "Down " + ", ".join(phrases[:-1]) + f" and {phrases[-1]}."
    upside = (fair / price - 1.0) * 100.0
    return f"{dropped} Fair value {_money(fair)} is {upside:.0f}% above {_money(price)}."


def build_value_rows(names: list[dict] | None) -> list[dict]:
    """One row per equity. Names without a fair value above the price stay off."""
    rows = []
    for name in names or []:
        ticker = str(name.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        try:
            fair = float(name.get("fair_value"))
            price = float(name.get("price"))
        except (TypeError, ValueError):
            continue
        if fair <= 0 or price <= 0 or fair <= price:
            continue
        returns = horizon_returns(name.get("bars"), name.get("day_return"))
        hits = []
        for key, _sessions, floor, words in WINDOWS:
            ret = returns.get(key)
            if ret is None or ret > floor:
                continue
            hits.append((key, ret, words))
        if not hits:
            continue
        upside = fair / price - 1.0
        day = returns.get("day")
        day_change = None
        if day is not None and day > -1:
            day_change = round(price * day / (1.0 + day), 2)
        rows.append({
            "ticker": ticker,
            "name": str(name.get("name") or ticker),
            "price": round(price, 4),
            "fair_value": round(fair, 4),
            "upside": round(upside, 4),
            "day_change": day_change,
            "rating": str(name.get("rating") or ""),
            "fair_as_of": str(name.get("fair_as_of") or "")[:10],
            "returns": {key: (None if val is None else round(float(val), 4)) for key, val in returns.items()},
            "windows": [key for key, _frac, _words in hits],
            "reason": reason_line(hits, fair, price),
        })
    rows.sort(key=lambda row: (-float(row["upside"]), row["ticker"]))
    return rows


def quote_day_return(pct) -> float | None:
    """Desk quotes store a day move in percent points, such as -3.2 for -3.2%."""
    if pct is None or pct == "":
        return None
    try:
        return float(pct) / 100.0
    except (TypeError, ValueError):
        return None
