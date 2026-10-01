"""Analysis packet shape, sourced values, and validation.

Math does not live here. A number with no source is marked UNVERIFIED
and is left out of calculations until someone confirms it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterator

SOURCE_TYPES = {
    "market_data",
    "sec_filing",
    "press_release",
    "regulator",
    "news",
    "company_ir",
    "derived",
    "model_estimate",
}
CONFIDENCE = {"confirmed", "reported", "estimate"}
FRESHNESS = {"market", "event", "terms", "static"}

SECTION_TITLES = (
    ("overview", "Deal overview"),
    ("spread", "Spread and implied probability"),
    ("structure", "Deal structure"),
    ("regulatory", "Regulatory path"),
    ("votes", "Shareholder votes"),
    ("catalysts", "Key catalysts"),
    ("downside", "Downside if the deal breaks"),
    ("upside", "Upside on close"),
    ("sources", "Sources"),
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        dt = value
    elif not value:
        return None
    else:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def is_field(node: Any) -> bool:
    return isinstance(node, dict) and "id" in node and "value" in node and "freshness_class" in node


def iter_fields(packet: dict) -> Iterator[dict]:
    def walk(node: Any) -> Iterator[dict]:
        if is_field(node):
            yield node
            return
        if isinstance(node, dict):
            for value in node.values():
                yield from walk(value)
        elif isinstance(node, list):
            for value in node:
                yield from walk(value)

    yield from walk((packet or {}).get("sections") or {})


def field_map(packet: dict) -> dict[str, dict]:
    return {str(field["id"]): field for field in iter_fields(packet)}


def sourced(
    field_id: str,
    value: Any,
    *,
    unit: str = "",
    source: dict | None = None,
    pulled_at: str = "",
    as_of: str = "",
    freshness_class: str = "static",
    confidence: str = "confirmed",
    notes: str = "",
    inputs: list[str] | None = None,
    rationale: str = "",
    unverified: bool = False,
) -> dict:
    row = {
        "id": field_id,
        "value": value,
        "unit": unit,
        "source": source or {},
        "pulled_at": pulled_at,
        "as_of": as_of,
        "freshness_class": freshness_class,
        "confidence": confidence,
        "notes": notes,
        "unverified": unverified,
    }
    if inputs is not None:
        row["inputs"] = list(inputs)
    if rationale:
        row["rationale"] = rationale
    return row


def _source_ok(field: dict) -> bool:
    source = field.get("source") if isinstance(field.get("source"), dict) else {}
    kind = str(source.get("type") or "")
    if kind not in SOURCE_TYPES or not str(source.get("name") or "").strip():
        return False
    if not parse_time(field.get("pulled_at")):
        return False
    if kind == "model_estimate":
        if not str(field.get("rationale") or "").strip():
            return False
        if not field.get("inputs"):
            return False
    return True


def mark_unsourced(packet: dict) -> list[dict]:
    """Turn an unsourced number into UNVERIFIED. Do not invent a source."""
    flags = []
    for field in iter_fields(packet):
        if field.get("unverified"):
            flags.append({
                "id": field["id"],
                "kind": "unverifiable",
                "detail": "UNVERIFIED",
            })
            continue
        if field.get("value") is None and not field.get("source"):
            field["unverified"] = True
            field["notes"] = "UNVERIFIED"
            flags.append({
                "id": field["id"],
                "kind": "unverifiable",
                "detail": "UNVERIFIED",
            })
            continue
        if field.get("value") is None:
            continue
        if _source_ok(field):
            continue
        field["unverified"] = True
        note = str(field.get("notes") or "")
        if "UNVERIFIED" not in note:
            field["notes"] = (note + " UNVERIFIED").strip()
        flags.append({
            "id": field["id"],
            "kind": "unverifiable",
            "detail": "UNVERIFIED: missing source, date, or estimate rationale",
        })
    packet.setdefault("flags", [])
    seen = {(row.get("id"), row.get("kind"), row.get("detail")) for row in packet["flags"]}
    for flag in flags:
        key = (flag["id"], flag["kind"], flag["detail"])
        if key not in seen:
            packet["flags"].append(flag)
            seen.add(key)
    return flags


def require_sections(packet: dict) -> list[str]:
    missing = []
    sections = packet.get("sections") if isinstance(packet.get("sections"), dict) else {}
    for key, _title in SECTION_TITLES:
        if key not in sections:
            missing.append(key)
    meta = packet.get("packet_meta") if isinstance(packet.get("packet_meta"), dict) else {}
    for key in ("deal_id", "version", "model", "created_at", "stage"):
        if not meta.get(key) and meta.get(key) != 0:
            missing.append(f"packet_meta.{key}")
    if "stage1_notes" not in packet:
        missing.append("stage1_notes")
    return missing


def judgment_ids(packet: dict) -> set[str]:
    """Field ids the local model must not change."""
    locked = set()
    for field in iter_fields(packet):
        source = field.get("source") if isinstance(field.get("source"), dict) else {}
        if source.get("type") == "model_estimate" or field.get("confidence") == "estimate":
            if source.get("type") == "model_estimate":
                locked.add(field["id"])
    return locked
