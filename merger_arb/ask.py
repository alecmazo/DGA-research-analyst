"""Follow-up questions. The local model answers from the packet, or says to escalate."""

from __future__ import annotations

import json
import re

from merger_arb.deep_dive import parse_json_object
from merger_arb.freshness import CORE_IDS
from merger_arb.prompts import ASK_JSON, LOCAL_RULES
from merger_arb.refresh import context_limit, deal_header, estimate_tokens
from merger_arb.schema import field_map

_WORDS = re.compile(r"[a-z0-9]+")


def _public(field: dict) -> dict:
    source = field.get("source") if isinstance(field.get("source"), dict) else {}
    return {
        "id": field.get("id"),
        "value": field.get("value"),
        "unit": field.get("unit") or "",
        "source_name": source.get("name") or "",
        "source_url": source.get("url") or "",
        "pulled_at": field.get("pulled_at") or "",
        "as_of": field.get("as_of") or "",
        "notes": str(field.get("notes") or "")[:240],
        "unverified": bool(field.get("unverified")),
    }


def _rank(packet: dict, question: str) -> list[dict]:
    fields = field_map(packet)
    words = {word for word in _WORDS.findall((question or "").lower()) if len(word) > 2}
    def score(field: dict) -> int:
        blob = f"{field.get('id')} {field.get('notes') or ''} {field.get('value')}".lower()
        return sum(1 for word in words if word in blob)

    ranked = sorted(fields.values(), key=score, reverse=True)
    chosen = []
    seen = set()
    for field_id in CORE_IDS:
        field = fields.get(field_id)
        if field and field_id not in seen:
            chosen.append(field)
            seen.add(field_id)
    for field in ranked:
        if score(field) <= 0 or field["id"] in seen:
            continue
        chosen.append(field)
        seen.add(field["id"])
        if len(chosen) >= 16:
            break
    return chosen


def _message(packet: dict, question: str, fields: list[dict], bundle: dict | None) -> str:
    fresh = {}
    if bundle:
        fresh = {
            "prices": bundle.get("prices") or [],
            "filings": [
                {"form": row.get("form"), "url": row.get("url"), "excerpt": str(row.get("excerpt") or "")[:240]}
                for row in (bundle.get("filings") or [])[:6]
            ],
            "headlines": [
                {"title": row.get("title"), "url": row.get("url")}
                for row in (bundle.get("headlines") or [])[:6]
            ],
        }
    return json.dumps({
        "packet_meta": {
            "deal_id": (packet.get("packet_meta") or {}).get("deal_id"),
            "version": (packet.get("packet_meta") or {}).get("version"),
        },
        "deal_header": deal_header(packet),
        "fields": [_public(field) for field in fields],
        "fresh_data": fresh,
        "question": question,
    }, default=str)


def run_ask(packet: dict, question: str, complete, bundle: dict | None = None) -> dict:
    """complete(system, user, num_ctx=) -> text. Does not change the packet or call a paid model."""
    question = (question or "").strip()
    fields = _rank(packet, question)
    limit = context_limit()
    budget = max(1, limit - int(limit * 0.25))
    system = LOCAL_RULES + "\n" + ASK_JSON
    cut = False
    while fields and estimate_tokens(system) + estimate_tokens(_message(packet, question, fields, bundle)) > budget:
        cut = True
        if len(fields) <= 3:
            break
        fields.pop()
    user = _message(packet, question, fields, bundle)
    raw = complete(system, user, num_ctx=limit)
    parsed = parse_json_object(raw if isinstance(raw, str) else "")
    retried = False
    if not isinstance(parsed, dict) or "answer" not in parsed:
        retried = True
        raw = complete(system, user + "\n\nOutput the follow-up JSON only.", num_ctx=limit)
        parsed = parse_json_object(raw if isinstance(raw, str) else "")
    if not isinstance(parsed, dict):
        parsed = {}
    answer = str(parsed.get("answer") or "").strip()
    if not answer:
        answer = "not in packet, escalate to Deep Dive"
    known = set(field_map(packet))
    citations = []
    for item in parsed.get("citations") or []:
        text = str(item)
        if text in known and text not in citations:
            citations.append(text)
    low = answer.lower()
    escalate = bool(parsed.get("escalate")) or "not in packet" in low or "escalate to deep dive" in low
    return {
        "answer": answer,
        "citations": citations,
        "escalate": escalate,
        "cut_warning": "Some packet fields were cut to fit the local model." if cut else "",
        "tokens": estimate_tokens(system) + estimate_tokens(user),
        "retried": retried,
        "num_ctx": limit,
    }
