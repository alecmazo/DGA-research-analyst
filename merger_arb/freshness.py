"""Freshness dots and the header badge.

Limits are hours. Market values also go stale at the next 16:00 New York
close after they were pulled. Override the hours with a dict of class to
hours, or the MERGER_ARB_FRESHNESS_JSON environment variable.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from merger_arb.schema import field_map, iter_fields, parse_time

NY = ZoneInfo("America/New_York")
PT = ZoneInfo("America/Los_Angeles")

DEFAULT_LIMITS = {
    "market": 26,
    "event": 24 * 7,
    "terms": 24 * 30,
    "static": None,
}

CORE_IDS = ("overview.target_price", "overview.offer_value", "downside.break_price")


def limits_from_env() -> dict:
    raw = os.environ.get("MERGER_ARB_FRESHNESS_JSON", "").strip()
    limits = dict(DEFAULT_LIMITS)
    if not raw:
        return limits
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return limits
    if isinstance(parsed, dict):
        for key, value in parsed.items():
            if key in limits:
                limits[key] = None if value in (None, "", "never") else float(value)
    return limits


def format_pt(value) -> str:
    dt = parse_time(value)
    if dt is None:
        return ""
    return dt.astimezone(PT).strftime("%Y-%m-%d %H:%M PT")


def next_nyse_close(pulled_at: datetime) -> datetime:
    local = pulled_at.astimezone(NY)
    close = local.replace(hour=16, minute=0, second=0, microsecond=0)
    if local >= close:
        close = close + timedelta(days=1)
    while close.weekday() >= 5:
        close = close + timedelta(days=1)
    return close


def score_field(field: dict, now: datetime, limits: dict | None = None) -> str:
    """green, amber, or red."""
    limits = limits or limits_from_env()
    if field.get("unverified") or field.get("value") is None and field.get("unverified"):
        return "red"
    if field.get("unverified"):
        return "red"
    kind = str(field.get("freshness_class") or "static")
    if kind == "static":
        return "green"
    pulled = parse_time(field.get("pulled_at"))
    if pulled is None:
        return "red"
    now = parse_time(now) or datetime.now(NY)
    if kind == "market" and now >= next_nyse_close(pulled):
        return "red"
    hours = limits.get(kind, DEFAULT_LIMITS.get(kind))
    if hours is None:
        return "green"
    age = (now - pulled).total_seconds() / 3600.0
    if age > float(hours):
        return "red"
    if age >= float(hours) * 0.8:
        return "amber"
    return "amber" if kind == "market" and _near_close(pulled, now) else "green"


def _near_close(pulled: datetime, now: datetime) -> bool:
    close = next_nyse_close(pulled)
    window = (close - pulled).total_seconds()
    if window <= 0:
        return False
    remaining = (close - now).total_seconds()
    return remaining >= 0 and remaining <= window * 0.2


def score_packet(packet: dict, now: datetime | None = None, limits: dict | None = None) -> dict:
    now = parse_time(now) or datetime.now(ZoneInfo("UTC"))
    dots = {}
    for field in iter_fields(packet):
        dots[field["id"]] = score_field(field, now, limits)
        field["dot"] = dots[field["id"]]
    fields = field_map(packet)
    core_bad = False
    for field_id in CORE_IDS:
        field = fields.get(field_id)
        dot = "red" if field is None else dots.get(field_id, "red")
        if dot == "red":
            core_bad = True
    if core_bad:
        badge = "Stale"
    elif any(dot != "green" for dot in dots.values()):
        badge = "Partly stale"
    else:
        badge = "Fresh"
    packet["freshness"] = {"badge": badge, "dots": dots, "scored_at": now.isoformat()}
    return packet
