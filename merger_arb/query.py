"""Filter, sort, page, and facet deal rows for GET /api/merger-arb/deals."""

from __future__ import annotations

from datetime import date

SORT_FIELDS = {
    "score": "score",
    "target": "target_ticker",
    "acquirer": "acquirer_ticker",
    "type": "deal_type",
    "offer": "offer_value",
    "price": "target_price",
    "gross": "gross_pct",
    "ann": "ann_pct",
    "down": "downside_pct",
    "implied_p": "implied_p",
    "close": "expected_close",
    "value": "deal_value_usd",
    "sector": "sector",
    "confidence": "data_confidence",
    "stage": "stage",
}

SIZE_BUCKETS = ("lt500", "0.5-2", "2-10", "gt10")
CLOSE_BUCKETS = ("30", "30-90", "90-180", "180", "past")


def _num(value):
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "").replace("$", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def _csv(raw) -> list[str]:
    if raw in (None, ""):
        return []
    if isinstance(raw, (list, tuple)):
        parts = [str(item).strip() for item in raw]
    else:
        parts = [part.strip() for part in str(raw).split(",")]
    return [part for part in parts if part]


def _flag(raw) -> bool | None:
    if raw in (None, ""):
        return None
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _fraction(value):
    """Accept 5.26 (percent points) or 0.0526 (fraction)."""
    number = _num(value)
    if number is None:
        return None
    if abs(number) > 1.5:
        return number / 100.0
    return number


def _metrics(deal: dict) -> dict:
    metrics = deal.get("metrics_json") or deal.get("metrics") or {}
    return metrics if isinstance(metrics, dict) else {}


def _flags(deal: dict) -> list[str]:
    flags = deal.get("reg_flags") or []
    if isinstance(flags, str):
        flags = [part.strip() for part in flags.split(",") if part.strip()]
    return [str(item) for item in flags]


def size_bucket(value) -> str:
    number = _num(value)
    if number is None:
        return ""
    if number < 500_000_000:
        return "lt500"
    if number < 2_000_000_000:
        return "0.5-2"
    if number < 10_000_000_000:
        return "2-10"
    return "gt10"


def close_bucket(deal: dict, today: date | None = None) -> str:
    today = today or date.today()
    metrics = _metrics(deal)
    days = metrics.get("days_to_close")
    if days is None:
        days = deal.get("days_to_close")
    days = _num(days)
    if days is None:
        close = str(deal.get("expected_close") or "")[:10]
        if close.count("-") == 2:
            try:
                days = (date.fromisoformat(close) - today).days
            except ValueError:
                days = None
    if days is None:
        return ""
    if days < 0:
        return "past"
    if days <= 30:
        return "30"
    if days <= 90:
        return "30-90"
    if days <= 180:
        return "90-180"
    return "180"


def public_deal(deal: dict) -> dict:
    metrics = _metrics(deal)
    score_json = deal.get("score_json") or {}
    if not isinstance(score_json, dict):
        score_json = {}
    return {
        "id": deal.get("id") or "",
        "deal_key": deal.get("deal_key") or "",
        "target_ticker": deal.get("target_ticker") or "",
        "target_name": deal.get("target_name") or "",
        "target_cik": deal.get("target_cik") or "",
        "acquirer_ticker": deal.get("acquirer_ticker") or "",
        "acquirer_name": deal.get("acquirer_name") or "",
        "acquirer_cik": deal.get("acquirer_cik") or "",
        "stage": deal.get("stage") or "screen",
        "status": deal.get("status") or "",
        "outcome": deal.get("outcome") or "",
        "deal_type": deal.get("deal_type") or metrics.get("consideration") or "",
        "is_tender": bool(deal.get("is_tender")),
        "acquirer_kind": deal.get("acquirer_kind") or "",
        "hostile": bool(deal.get("hostile")),
        "sector": deal.get("sector") or "",
        "deal_value_usd": _num(deal.get("deal_value_usd") if deal.get("deal_value_usd") is not None else metrics.get("deal_value_usd")),
        "announce_date": str(deal.get("announce_date") or deal.get("announced_on") or "")[:10],
        "expected_close": str(deal.get("expected_close") or "")[:10],
        "outside_date": str(deal.get("outside_date") or "")[:10],
        "offer_value": _num(deal.get("offer_value") if deal.get("offer_value") is not None else metrics.get("offer_value")),
        "target_price": _num(deal.get("target_price") if deal.get("target_price") is not None else metrics.get("target_price")),
        "gross_pct": _num(deal.get("gross_pct") if deal.get("gross_pct") is not None else metrics.get("gross_pct")),
        "ann_pct": _num(deal.get("ann_pct") if deal.get("ann_pct") is not None else metrics.get("annualized_pct")),
        "downside_pct": _num(deal.get("downside_pct") if deal.get("downside_pct") is not None else metrics.get("downside_pct")),
        "implied_p": _num(deal.get("implied_p") if deal.get("implied_p") is not None else metrics.get("implied_p")),
        "days_to_close": metrics.get("days_to_close"),
        "needs_manual_terms": bool(metrics.get("needs_manual_terms") or deal.get("needs_manual_terms")),
        "acquirer_price_sensitive": bool(metrics.get("acquirer_price_sensitive")),
        "reg_flags": _flags(deal),
        "score": deal.get("score"),
        "score_band": deal.get("score_band") or "",
        "score_json": score_json,
        "data_confidence": deal.get("data_confidence"),
        "sample": bool(deal.get("sample")),
        "metrics": metrics,
    }


def parse_sort(raw: str | None) -> list[tuple[str, bool]]:
    parts = _csv(raw) or ["-score", "target"]
    keys = []
    for part in parts:
        desc = part.startswith("-")
        name = part[1:] if desc else part
        field = SORT_FIELDS.get(name)
        if field:
            keys.append((field, desc))
    return keys or [("score", True), ("target_ticker", False)]


def _cmp(deal: dict, field: str, desc: bool):
    value = deal.get(field)
    missing = value in (None, "")
    if isinstance(value, str):
        text = value.lower()
        if desc:
            text = "".join(chr(0x10FFFF - ord(ch)) for ch in text)
        return (missing, text)
    number = _num(value)
    if number is None:
        return (True, 0.0)
    return (False, -number if desc else number)


def sort_deals(rows: list[dict], raw: str | None = None) -> list[dict]:
    keys = parse_sort(raw)
    return sorted(rows, key=lambda deal: tuple(_cmp(deal, field, desc) for field, desc in keys))


def _matches(deal: dict, params: dict, today: date) -> bool:
    query = str(params.get("q") or "").strip().lower()
    if query:
        hay = " ".join([
            str(deal.get("target_ticker") or ""),
            str(deal.get("target_name") or ""),
            str(deal.get("acquirer_ticker") or ""),
            str(deal.get("acquirer_name") or ""),
        ]).lower()
        if query not in hay:
            return False
    stages = {item.lower() for item in _csv(params.get("stage"))}
    if stages and str(deal.get("stage") or "screen").lower() not in stages:
        return False
    types = {item.lower() for item in _csv(params.get("type"))}
    if types and str(deal.get("deal_type") or "").lower() not in types:
        return False
    sectors = {item.lower() for item in _csv(params.get("sector"))}
    if sectors and str(deal.get("sector") or "").lower() not in sectors:
        return False
    sizes = set(_csv(params.get("size")))
    if sizes and size_bucket(deal.get("deal_value_usd")) not in sizes:
        return False
    bands = {item.upper() for item in _csv(params.get("band"))}
    if bands and str(deal.get("score_band") or "").upper() not in bands:
        return False
    flags = set(_csv(params.get("regulatory")))
    if flags and not flags.intersection(_flags(deal)):
        return False
    windows = set(_csv(params.get("close")))
    if windows and close_bucket(deal, today) not in windows:
        return False
    kinds = {item.lower() for item in _csv(params.get("acquirer_kind"))}
    if kinds and str(deal.get("acquirer_kind") or "").lower() not in kinds:
        return False
    hostile = _flag(params.get("hostile"))
    if hostile is not None and bool(deal.get("hostile")) != hostile:
        return False
    contested = _flag(params.get("contested"))
    if contested is not None and bool(deal.get("contested")) != contested:
        return False
    financing = _flag(params.get("financing_condition"))
    if financing is not None:
        terms = deal.get("terms_json") or {}
        has = bool(terms.get("financing_condition") if isinstance(terms, dict) else False)
        if has != financing:
            return False
    conf_min = _num(params.get("confidence_min"))
    if conf_min is not None:
        conf = _num(deal.get("data_confidence"))
        if conf is None or conf < conf_min:
            return False
    spread_min = _fraction(params.get("spread_min"))
    spread_max = _fraction(params.get("spread_max"))
    gross = _num(deal.get("gross_pct"))
    if spread_min is not None and (gross is None or gross < spread_min):
        return False
    if spread_max is not None and (gross is None or gross > spread_max):
        return False
    ann_min = _fraction(params.get("ann_min"))
    ann_max = _fraction(params.get("ann_max"))
    ann = _num(deal.get("ann_pct"))
    if ann_min is not None and (ann is None or ann < ann_min):
        return False
    if ann_max is not None and (ann is None or ann > ann_max):
        return False
    return True


def _count(rows: list[dict], key: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for deal in rows:
        value = deal.get(key) or ""
        if isinstance(value, str):
            label = value
        else:
            label = str(value)
        if not label:
            continue
        out[label] = out.get(label, 0) + 1
    return out


def facets_for(rows: list[dict], today: date | None = None) -> dict:
    today = today or date.today()
    flags: dict[str, int] = {}
    sizes: dict[str, int] = {}
    closes: dict[str, int] = {}
    for deal in rows:
        for flag in _flags(deal):
            flags[flag] = flags.get(flag, 0) + 1
        bucket = size_bucket(deal.get("deal_value_usd"))
        if bucket:
            sizes[bucket] = sizes.get(bucket, 0) + 1
        window = close_bucket(deal, today)
        if window:
            closes[window] = closes.get(window, 0) + 1
    return {
        "type": _count(rows, "deal_type"),
        "sector": _count(rows, "sector"),
        "band": _count(rows, "score_band"),
        "flag": flags,
        "stage": _count(rows, "stage"),
        "size": sizes,
        "close": closes,
    }


def query_deals(deals: list[dict], params: dict | None = None, *, today: date | None = None) -> dict:
    params = params or {}
    today = today or date.today()
    public = [public_deal(deal) for deal in deals]
    # keep terms_json on the working copy for financing_condition filter
    for src, row in zip(deals, public):
        row["terms_json"] = src.get("terms_json") or {}
        row["contested"] = bool(src.get("contested"))
        row["hostile"] = bool(src.get("hostile"))
    matched = [row for row in public if _matches(row, params, today)]
    matched = sort_deals(matched, params.get("sort"))
    facets = facets_for(matched, today)
    total = len(matched)
    page_raw = params.get("page")
    size_raw = params.get("page_size")
    paging = page_raw not in (None, "") or size_raw not in (None, "")
    page = max(int(_num(page_raw) or 1), 1)
    if paging:
        page_size = min(max(int(_num(size_raw) or 50), 1), 300)
    else:
        page_size = total or 1
        page = 1
    start = (page - 1) * page_size
    items = matched[start:start + page_size]
    for row in items:
        row.pop("terms_json", None)
        row.pop("contested", None)
    return {
        "deals": items,
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "facets": facets,
        "sort": params.get("sort") or "-score,target",
    }


def parse_query(request_params) -> dict:
    keys = (
        "q", "stage", "type", "sector", "size", "spread_min", "spread_max",
        "ann_min", "ann_max", "band", "regulatory", "close", "acquirer_kind",
        "hostile", "contested", "financing_condition", "confidence_min",
        "sort", "page", "page_size",
    )
    out = {}
    for key in keys:
        value = request_params.get(key)
        if value not in (None, ""):
            out[key] = value
    return out
