"""Deal math. The model never computes these.

Collar
------
fixed_value: inside [low, high] the stock leg equals collar_value.
Above the high, the ratio is collar_value / high. Below the low, the
ratio is collar_value / low. The offer then moves with the acquirer price.

fixed_ratio: inside the band the stock leg is ratio times the acquirer
price. Outside the band the value is pinned at the breached bound
(ratio times that bound).

A price outside the walk-away bounds sets walkaway_triggered. The offer
value is still computed. Cash is not collared. Mixed and election deals
collar only the stock leg. Election uses proration as the cash fraction.
"""

from __future__ import annotations

from merger_arb.schema import field_map, parse_time, sourced

DERIVED_IDS = (
    "overview.offer_value",
    "spread.gross_dollars",
    "spread.gross_percent",
    "spread.annualized",
    "spread.annualized_simple",
    "spread.implied_probability",
    "spread.sensitivity",
    "downside.downside_dollars",
    "downside.downside_percent",
    "upside.upside_dollars",
    "upside.upside_percent",
    "upside.annualized",
)


def offer_value(
    *,
    consideration: str,
    cash: float | None,
    ratio: float | None,
    acquirer_price: float | None,
    collar_type: str = "none",
    collar_low: float | None = None,
    collar_high: float | None = None,
    collar_value: float | None = None,
    walkaway_low: float | None = None,
    walkaway_high: float | None = None,
    proration_cash: float | None = None,
) -> dict:
    kind = (consideration or "cash").strip().lower()
    collar = (collar_type or "none").strip().lower()
    walkaway = False
    notes = []
    price = acquirer_price

    def stock_leg() -> float | None:
        nonlocal walkaway
        if price is None:
            return None
        if walkaway_low is not None and price < walkaway_low:
            walkaway = True
            notes.append("walk-away: acquirer price is below the walk-away bound")
        if walkaway_high is not None and price > walkaway_high:
            walkaway = True
            notes.append("walk-away: acquirer price is above the walk-away bound")
        if collar == "fixed_value":
            if collar_value is None or collar_low is None or collar_high is None:
                notes.append("fixed-value collar is missing bounds or value")
                return None
            if collar_low <= price <= collar_high:
                return float(collar_value)
            if price > collar_high:
                return float(collar_value) / float(collar_high) * float(price)
            return float(collar_value) / float(collar_low) * float(price)
        if collar == "fixed_ratio":
            if ratio is None:
                return None
            if collar_low is None or collar_high is None or collar_low <= price <= collar_high:
                return float(ratio) * float(price)
            if price > collar_high:
                return float(ratio) * float(collar_high)
            return float(ratio) * float(collar_low)
        if ratio is None:
            return None
        return float(ratio) * float(price)

    if kind == "cash":
        value = None if cash is None else float(cash)
    elif kind == "stock":
        value = stock_leg()
    elif kind == "mixed":
        leg = stock_leg()
        value = None if cash is None or leg is None else float(cash) + leg
    elif kind == "election":
        frac = 0.5 if proration_cash is None else float(proration_cash)
        leg = stock_leg()
        if cash is None or leg is None:
            value = None
        else:
            value = frac * float(cash) + (1.0 - frac) * leg
            notes.append(f"election proration cash fraction {frac}")
    else:
        value = None
        notes.append(f"unknown consideration {kind}")
    return {"value": value, "walkaway_triggered": walkaway, "notes": notes}


def gross_spread(offer: float | None, price: float | None) -> tuple[float | None, float | None]:
    if offer is None or price is None or price == 0:
        return None, None
    dollars = float(offer) - float(price)
    return dollars, dollars / float(price)


def annualized(spread_pct: float | None, years: float | None) -> tuple[float | None, float | None]:
    if spread_pct is None or years is None or years <= 0:
        return None, None
    compound = (1.0 + float(spread_pct)) ** (1.0 / float(years)) - 1.0
    simple = float(spread_pct) / float(years)
    return compound, simple


def implied_probability(
    price: float | None,
    offer: float | None,
    break_price: float | None,
) -> tuple[float | None, list[str]]:
    warnings: list[str] = []
    if price is None or offer is None or break_price is None:
        return None, ["missing input"]
    if break_price >= price:
        warnings.append("break price is at or above the target price")
    if offer <= price:
        warnings.append("offer value is at or below the target price")
    denom = float(offer) - float(break_price)
    if denom == 0:
        return None, warnings + ["offer value equals the break price"]
    raw = (float(price) - float(break_price)) / denom
    clamped = min(1.0, max(0.0, raw))
    if clamped != raw:
        warnings.append("implied probability was held between 0 and 1")
    return clamped, warnings


def downside_return(break_price: float | None, price: float | None) -> tuple[float | None, float | None]:
    if break_price is None or price is None or price == 0:
        return None, None
    dollars = float(break_price) - float(price)
    return dollars, dollars / float(price)


def upside_return(offer: float | None, price: float | None) -> tuple[float | None, float | None]:
    if offer is None or price is None or price == 0:
        return None, None
    dollars = float(offer) - float(price)
    return dollars, dollars / float(price)


def sensitivity(
    price: float | None,
    offer: float | None,
    break_price: float | None,
    years: float | None,
) -> list[dict]:
    rows = []
    for mult, d_label in ((0.9, "-10%"), (1.0, "base"), (1.1, "+10%")):
        for months, t_label in ((-3, "-3m"), (0, "base"), (3, "+3m")):
            down = None if break_price is None else float(break_price) * mult
            horizon = None if years is None else float(years) + (months / 12.0)
            prob, _warnings = implied_probability(price, offer, down)
            _dollars, pct = gross_spread(offer, price)
            compound, simple = annualized(pct, horizon if horizon and horizon > 0 else None)
            rows.append({
                "downside": d_label,
                "close": t_label,
                "implied_probability": prob,
                "annualized": compound,
                "annualized_simple": simple,
            })
    return rows


def _num(field: dict | None, confirmed: set[str]) -> float | None:
    if not field:
        return None
    if field.get("unverified") and field.get("id") not in confirmed:
        return None
    value = field.get("value")
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(field: dict | None, confirmed: set[str]) -> str:
    if not field:
        return ""
    if field.get("unverified") and field.get("id") not in confirmed:
        return ""
    return str(field.get("value") or "").strip().lower()


def _oldest_as_of(fields: list[dict]) -> str:
    times = [parse_time(field.get("as_of") or field.get("pulled_at")) for field in fields]
    times = [item for item in times if item is not None]
    if not times:
        return ""
    return min(times).isoformat()


def _worst_class(fields: list[dict]) -> str:
    rank = {"market": 0, "event": 1, "terms": 2, "static": 3}
    best = "static"
    for field in fields:
        kind = str(field.get("freshness_class") or "static")
        if rank.get(kind, 3) < rank.get(best, 3):
            best = kind
    return best


def _derived(field_id: str, value, unit: str, inputs: list[dict], notes: str = "") -> dict:
    present = [field for field in inputs if field]
    ids = [field["id"] for field in present]
    unverified = value is None
    return sourced(
        field_id,
        value,
        unit=unit,
        source={
            "type": "derived",
            "name": "Computed from packet inputs",
            "url": "",
            "locator": ", ".join(ids),
            "input_ids": ids,
        },
        pulled_at=_oldest_as_of(present),
        as_of=_oldest_as_of(present),
        freshness_class=_worst_class(present) if present else "static",
        confidence="confirmed",
        notes=("UNVERIFIED" if unverified else notes),
        inputs=ids,
        unverified=unverified,
    )


def recompute(packet: dict, confirmed: set[str] | None = None) -> dict:
    """Fill derived fields from usable inputs. Unverified inputs are skipped."""
    confirmed = set(confirmed or packet.get("confirmed_ids") or [])
    fields = field_map(packet)
    sections = packet.setdefault("sections", {})
    overview = sections.setdefault("overview", {})
    structure = sections.setdefault("structure", {})
    spread = sections.setdefault("spread", {})
    downside = sections.setdefault("downside", {})
    upside = sections.setdefault("upside", {})

    consideration = _text(structure.get("consideration"), confirmed) or "cash"
    cash = _num(structure.get("cash_per_share"), confirmed)
    ratio = _num(structure.get("exchange_ratio"), confirmed)
    acquirer = _num(overview.get("acquirer_price"), confirmed)
    collar_type = _text(structure.get("collar_type"), confirmed) or "none"
    offer = offer_value(
        consideration=consideration,
        cash=cash,
        ratio=ratio,
        acquirer_price=acquirer,
        collar_type=collar_type,
        collar_low=_num(structure.get("collar_low"), confirmed),
        collar_high=_num(structure.get("collar_high"), confirmed),
        collar_value=_num(structure.get("collar_value"), confirmed),
        walkaway_low=_num(structure.get("walkaway_low"), confirmed),
        walkaway_high=_num(structure.get("walkaway_high"), confirmed),
        proration_cash=_num(structure.get("proration_cash"), confirmed),
    )
    inputs = [
        structure.get("consideration"),
        structure.get("cash_per_share"),
        structure.get("exchange_ratio"),
        structure.get("collar_type"),
        structure.get("collar_low"),
        structure.get("collar_high"),
        structure.get("collar_value"),
    ]
    if consideration in ("stock", "mixed", "election"):
        inputs.append(overview.get("acquirer_price"))
    note = "; ".join(offer["notes"])
    overview["offer_value"] = _derived("overview.offer_value", offer["value"], "USD", inputs, note)
    if offer["walkaway_triggered"]:
        overview["offer_value"]["notes"] = (overview["offer_value"]["notes"] + " walk-away triggered").strip()

    price = _num(overview.get("target_price"), confirmed)
    value = offer["value"]
    dollars, pct = gross_spread(value, price)
    price_fields = [overview["offer_value"], overview.get("target_price")]
    spread["gross_dollars"] = _derived("spread.gross_dollars", dollars, "USD", price_fields)
    spread["gross_percent"] = _derived("spread.gross_percent", pct, "pct", price_fields)

    dividends = _num(upside.get("dividends"), confirmed) or 0.0
    years = _num(overview.get("years_to_close"), confirmed)
    div_pct = None
    if value is not None and price not in (None, 0):
        div_pct = (value + dividends - price) / price
    compound, simple = annualized(div_pct, years)
    ann_inputs = price_fields + [overview.get("years_to_close"), upside.get("dividends")]
    extra = ""
    if dividends:
        extra = f"includes expected dividends {dividends}"
    spread["annualized"] = _derived("spread.annualized", compound, "pct", ann_inputs, extra)
    spread["annualized_simple"] = _derived("spread.annualized_simple", simple, "pct", ann_inputs, extra)

    break_price = _num(downside.get("break_price"), confirmed)
    prob, warnings = implied_probability(price, value, break_price)
    prob_inputs = [overview.get("target_price"), overview["offer_value"], downside.get("break_price")]
    spread["implied_probability"] = _derived(
        "spread.implied_probability",
        prob,
        "pct",
        prob_inputs,
        "; ".join(warnings),
    )
    table = sensitivity(price, value, break_price, years)
    spread["sensitivity"] = _derived(
        "spread.sensitivity",
        table,
        "table",
        prob_inputs + [overview.get("years_to_close")],
    )

    down_d, down_p = downside_return(break_price, price)
    down_inputs = [downside.get("break_price"), overview.get("target_price")]
    downside["downside_dollars"] = _derived("downside.downside_dollars", down_d, "USD", down_inputs)
    downside["downside_percent"] = _derived("downside.downside_percent", down_p, "pct", down_inputs)
    up_d, up_p = upside_return(value, price)
    up_inputs = [overview["offer_value"], overview.get("target_price")]
    upside["upside_dollars"] = _derived("upside.upside_dollars", up_d, "USD", up_inputs)
    upside["upside_percent"] = _derived("upside.upside_percent", up_p, "pct", up_inputs)
    upside["annualized"] = _derived("upside.annualized", compound, "pct", ann_inputs, extra)
    meta = packet.setdefault("packet_meta", {})
    meta["derived_by"] = "code"
    return packet
