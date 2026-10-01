"""Stage 1. One cloud model, chosen by the user, writes the packet. No fallback."""

from __future__ import annotations

import json

from merger_arb.bundle import source_keys
from merger_arb.calc import recompute
from merger_arb.freshness import score_packet
from merger_arb.prompts import DEEP_DIVE_SYSTEM
from merger_arb.schema import (
    SECTION_TITLES,
    field_map,
    mark_unsourced,
    parse_time,
    sourced,
    utc_now,
)

# Filled when the model omits them, so a gap is UNVERIFIED instead of a guess.
SCALAR_FIELDS = (
    ("overview.target_name", "static"),
    ("overview.target_ticker", "static"),
    ("overview.acquirer_name", "static"),
    ("overview.acquirer_ticker", "static"),
    ("overview.announced_date", "static"),
    ("overview.offer_terms", "terms"),
    ("overview.target_price", "market"),
    ("overview.acquirer_price", "market"),
    ("overview.status", "event"),
    ("overview.expected_close", "event"),
    ("overview.years_to_close", "event"),
    ("overview.outside_date", "terms"),
    ("overview.extensions", "terms"),
    ("structure.consideration", "terms"),
    ("structure.cash_per_share", "terms"),
    ("structure.exchange_ratio", "terms"),
    ("structure.collar_type", "terms"),
    ("structure.collar_low", "terms"),
    ("structure.collar_high", "terms"),
    ("structure.collar_value", "terms"),
    ("structure.walkaway_low", "terms"),
    ("structure.walkaway_high", "terms"),
    ("structure.proration_cash", "terms"),
    ("structure.cvr", "terms"),
    ("structure.special_dividend", "terms"),
    ("structure.financing", "terms"),
    ("structure.financing_condition", "terms"),
    ("structure.acquirer_cash", "terms"),
    ("structure.mac", "terms"),
    ("structure.minimum_tender", "terms"),
    ("structure.go_shop", "terms"),
    ("structure.matching_rights", "terms"),
    ("votes.companies", "terms"),
    ("votes.threshold", "terms"),
    ("votes.record_date", "event"),
    ("votes.meeting_date", "event"),
    ("votes.locked_up_pct", "terms"),
    ("votes.iss", "event"),
    ("votes.glass_lewis", "event"),
    ("downside.target_break_fee", "terms"),
    ("downside.reverse_break_fee", "terms"),
    ("downside.unaffected_price", "static"),
    ("downside.peer_move", "market"),
    ("downside.peer_index", "market"),
    ("downside.break_price", "market"),
    ("upside.dividends", "terms"),
    ("upside.cvr_estimate", "static"),
    ("upside.bump_talk", "event"),
)


class DeepDiveError(RuntimeError):
    """The chosen model did not return a usable packet. Do not try another provider."""


def parse_json_object(text: str) -> dict | None:
    raw = (text or "").strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _fill_missing(packet: dict) -> None:
    sections = packet.setdefault("sections", {})
    for key, _title in SECTION_TITLES:
        if key not in sections:
            sections[key] = [] if key in ("regulatory", "catalysts", "sources") else {}
    present = field_map(packet)
    for field_id, freshness in SCALAR_FIELDS:
        if field_id in present:
            continue
        section, name = field_id.split(".", 1)
        node = sections.get(section)
        if not isinstance(node, dict):
            continue
        node[name] = sourced(
            field_id,
            None,
            freshness_class=freshness,
            unverified=True,
            notes="UNVERIFIED",
        )


def _attest(packet: dict, bundle: dict) -> None:
    """A number whose source is not in the bundle is UNVERIFIED. Do not keep it."""
    allowed = source_keys(bundle)
    for field in field_map(packet).values():
        if field.get("value") is None or field.get("unverified"):
            continue
        source = field.get("source") if isinstance(field.get("source"), dict) else {}
        kind = str(source.get("type") or "")
        if kind in ("model_estimate", "derived"):
            continue
        url = str(source.get("url") or "")
        name = str(source.get("name") or "").lower()
        if (url and url in allowed) or (name and name in allowed):
            continue
        field["unverified"] = True
        note = str(field.get("notes") or "")
        if "UNVERIFIED" not in note:
            field["notes"] = (note + " UNVERIFIED").strip()


def prepare_packet(data: dict, deal: dict, bundle: dict, model_name: str) -> dict:
    sections = data.get("sections") if isinstance(data.get("sections"), dict) else {}
    notes = data.get("stage1_notes") if isinstance(data.get("stage1_notes"), list) else []
    clean_notes = []
    for note in notes:
        if isinstance(note, str):
            clean_notes.append({"text": note, "field_ids": []})
        elif isinstance(note, dict) and note.get("text"):
            ids = note.get("field_ids") if isinstance(note.get("field_ids"), list) else []
            clean_notes.append({"text": str(note["text"]), "field_ids": [str(item) for item in ids]})
    packet = {
        "packet_meta": {
            "deal_id": deal.get("id") or "",
            "version": 1,
            "model": model_name,
            "created_at": utc_now().replace(microsecond=0).isoformat(),
            "stage": "deep_dive",
            "parent_version": None,
        },
        "stage1_notes": clean_notes,
        "flags": [],
        "confirmed_ids": [],
        "sections": sections,
    }
    _fill_missing(packet)
    mark_unsourced(packet)
    _attest(packet, bundle)
    recompute(packet)
    score_packet(packet)
    return packet


def model_problems(parsed: dict | None) -> list[str]:
    """Problems in the model's own JSON, before the app fills gaps."""
    if not isinstance(parsed, dict):
        return ["not valid JSON"]
    sections = parsed.get("sections")
    if not isinstance(sections, dict):
        return ["sections object missing"]
    missing = [key for key, _title in SECTION_TITLES if key not in sections]
    if missing:
        return ["missing sections: " + ", ".join(missing)]
    if "stage1_notes" not in parsed:
        return ["stage1_notes missing"]
    return []


def build_user_message(deal: dict, bundle: dict) -> str:
    payload = {
        "deal": {
            "id": deal.get("id"),
            "target_name": deal.get("target_name"),
            "target_ticker": deal.get("target_ticker"),
            "acquirer_name": deal.get("acquirer_name"),
            "acquirer_ticker": deal.get("acquirer_ticker"),
            "announced_on": deal.get("announced_on"),
            "status": deal.get("status") or "pending",
        },
        "fresh_data": bundle,
    }
    return json.dumps(payload, default=str)


def run_deep_dive(deal: dict, bundle: dict, call, *, model_name: str, parent_version=None) -> dict:
    """call(system, user) -> text. Retries once. Never calls a second provider."""
    user = build_user_message(deal, bundle)
    raw = call(DEEP_DIVE_SYSTEM, user)
    parsed = parse_json_object(raw if isinstance(raw, str) else "")
    missing = model_problems(parsed)
    packet = None if missing else prepare_packet(parsed, deal, bundle, model_name)
    if missing:
        repair = (
            user
            + "\n\nThe previous reply failed validation: "
            + "; ".join(missing)
            + ". Reply with one JSON object only. Include every section key and stage1_notes."
        )
        raw = call(DEEP_DIVE_SYSTEM, repair)
        parsed = parse_json_object(raw if isinstance(raw, str) else "")
        missing = model_problems(parsed)
        if missing:
            raise DeepDiveError("Deep dive packet is missing " + "; ".join(missing))
        packet = prepare_packet(parsed, deal, bundle, model_name)
    meta = packet["packet_meta"]
    meta["model"] = model_name
    meta["parent_version"] = parent_version
    meta["version"] = None
    if not parse_time(meta.get("created_at")):
        meta["created_at"] = utc_now().replace(microsecond=0).isoformat()
    return packet
