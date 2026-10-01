"""Stage 2. The local model may refresh, confirm, or flag. It may not judge."""

from __future__ import annotations

import json
import os
from copy import deepcopy
from datetime import datetime, timezone

from merger_arb.bundle import source_keys
from merger_arb.calc import recompute
from merger_arb.deep_dive import parse_json_object
from merger_arb.freshness import CORE_IDS, score_packet
from merger_arb.prompts import LOCAL_RULES
from merger_arb.schema import field_map, iter_fields, judgment_ids, parse_time, utc_now

GROUP_ORDER = (
    "market_prices",
    "deal_terms",
    "regulatory",
    "shareholder_vote",
    "catalysts",
    "expected_close",
    "downside_inputs",
    "sources",
)

TERMS_IDS = (
    "overview.offer_terms",
    "structure.consideration",
    "structure.cash_per_share",
    "structure.exchange_ratio",
    "structure.collar_type",
    "structure.collar_low",
    "structure.collar_high",
    "structure.collar_value",
    "structure.walkaway_low",
    "structure.walkaway_high",
    "structure.proration_cash",
    "structure.cvr",
    "structure.special_dividend",
    "structure.financing",
    "structure.financing_condition",
    "structure.acquirer_cash",
    "structure.mac",
    "downside.target_break_fee",
    "downside.reverse_break_fee",
    "upside.dividends",
)
VOTE_IDS = (
    "votes.record_date",
    "votes.meeting_date",
    "votes.iss",
    "votes.glass_lewis",
    "votes.threshold",
    "votes.locked_up_pct",
)
CLOSE_IDS = (
    "overview.expected_close",
    "overview.years_to_close",
    "overview.outside_date",
    "overview.extensions",
    "overview.status",
)
HEADER_IDS = (
    "overview.target_name",
    "overview.target_ticker",
    "overview.acquirer_name",
    "overview.acquirer_ticker",
    "overview.offer_terms",
    "overview.target_price",
    "overview.offer_value",
    "downside.break_price",
)


def context_limit() -> int:
    raw = (os.environ.get("MERGER_ARB_LOCAL_CTX_TOKENS") or "8192").strip()
    try:
        value = int(raw)
    except ValueError:
        value = 8192
    return max(1024, min(32768, value))


def estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // 4)


def _oldest(field: dict) -> datetime:
    parsed = parse_time(field.get("pulled_at"))
    return parsed or datetime.min.replace(tzinfo=timezone.utc)


def _take(fields: dict, ids: list[str]) -> list[dict]:
    rows = [fields[field_id] for field_id in ids if field_id in fields]
    rows.sort(key=_oldest)
    return rows


def _source_rows(packet: dict) -> list[dict]:
    rows = []
    for source in (packet.get("sections") or {}).get("sources") or []:
        if not isinstance(source, dict) or not source.get("id"):
            continue
        rows.append({
            "id": f"sources.{source['id']}",
            "value": source.get("name") or "",
            "unit": "",
            "pulled_at": source.get("pulled_at") or "",
            "as_of": source.get("published_at") or "",
            "freshness_class": "static",
            "source": {
                "type": source.get("type") or "",
                "name": source.get("name") or "",
                "url": source.get("url") or "",
                "locator": source.get("locator") or "",
            },
            "unverified": False,
            "notes": "",
        })
    rows.sort(key=_oldest)
    return rows


def refresh_groups(packet: dict) -> list[dict]:
    fields = field_map(packet)
    consideration = str((fields.get("structure.consideration") or {}).get("value") or "").lower()
    market = ["overview.target_price"]
    if consideration in ("stock", "mixed", "election"):
        market.append("overview.acquirer_price")
    if "downside.peer_index" in fields:
        market.append("downside.peer_index")
    regulatory = [
        field_id for field_id in fields
        if field_id.startswith("regulatory.")
        and field_id.rsplit(".", 1)[-1] in ("status", "filing_date", "expected_timeline", "risks", "remedies")
    ]
    catalysts = [field_id for field_id in fields if field_id.startswith("catalysts.")]
    named = {
        "market_prices": _take(fields, market),
        "deal_terms": _take(fields, list(TERMS_IDS)),
        "regulatory": _take(fields, regulatory),
        "shareholder_vote": _take(fields, list(VOTE_IDS)),
        "catalysts": _take(fields, catalysts),
        "expected_close": _take(fields, list(CLOSE_IDS)),
        "downside_inputs": _take(fields, ["downside.peer_move", "downside.break_price"]),
        "sources": _source_rows(packet),
    }
    groups = []
    for name in GROUP_ORDER:
        rows = named[name]
        if rows:
            groups.append({"name": name, "fields": rows})
    return groups


def _public_field(field: dict) -> dict:
    source = field.get("source") if isinstance(field.get("source"), dict) else {}
    return {
        "id": field.get("id"),
        "value": field.get("value"),
        "unit": field.get("unit") or "",
        "source": {
            "type": source.get("type") or "",
            "name": source.get("name") or "",
            "url": source.get("url") or "",
            "locator": source.get("locator") or "",
        },
        "pulled_at": field.get("pulled_at") or "",
        "as_of": field.get("as_of") or "",
        "freshness_class": field.get("freshness_class") or "",
        "notes": str(field.get("notes") or "")[:240],
    }


def deal_header(packet: dict) -> list[dict]:
    fields = field_map(packet)
    rows = []
    for field_id in HEADER_IDS:
        field = fields.get(field_id)
        if not field:
            continue
        rows.append({
            "id": field_id,
            "value": field.get("value"),
            "as_of": field.get("as_of") or "",
            "pulled_at": field.get("pulled_at") or "",
        })
    while rows and estimate_tokens(json.dumps(rows, default=str)) > 300:
        rows.pop()
    return rows


def _fresh_for(name: str, bundle: dict) -> dict:
    prices = [dict(row) for row in (bundle or {}).get("prices") or []]
    filings = [dict(row) for row in (bundle or {}).get("filings") or []]
    headlines = [dict(row) for row in (bundle or {}).get("headlines") or []]
    if name == "market_prices":
        return {"prices": prices}
    if name == "deal_terms":
        return {"filings": [row for row in filings if row.get("terms_change")]}
    if name == "downside_inputs":
        return {"prices": [row for row in prices if row.get("role") in ("peer", "target")]}
    if name == "sources":
        return {"prices": prices, "filings": filings, "headlines": headlines}
    return {"filings": filings, "headlines": headlines}


def _shrink(fresh: dict) -> bool:
    changed = False
    for row in fresh.get("filings") or []:
        excerpt = row.get("excerpt") or ""
        if len(excerpt) > 80:
            row["excerpt"] = excerpt[:80]
            changed = True
    for row in fresh.get("headlines") or []:
        summary = row.get("summary") or ""
        if len(summary) > 80:
            row["summary"] = summary[:80]
            changed = True
    return changed


def build_chunk(packet: dict, group: dict, bundle: dict, *, limit: int | None = None) -> dict:
    limit = context_limit() if limit is None else int(limit)
    fresh = _fresh_for(group["name"], bundle)
    header = deal_header(packet)
    fields = [_public_field(field) for field in group["fields"]]
    ids = [field["id"] for field in fields]
    system = LOCAL_RULES
    input_budget = max(1, limit - int(limit * 0.25))
    cut = False

    def user_text() -> str:
        return json.dumps({
            "packet_meta": {
                "deal_id": (packet.get("packet_meta") or {}).get("deal_id"),
                "version": (packet.get("packet_meta") or {}).get("version"),
                "stage": (packet.get("packet_meta") or {}).get("stage"),
            },
            "deal_header": header,
            "refresh_ids": ids,
            "fields": fields,
            "fresh_data": fresh,
        }, default=str)

    text = user_text()
    while estimate_tokens(system) + estimate_tokens(text) > input_budget:
        cut = True
        if _shrink(fresh):
            text = user_text()
            continue
        if fresh.get("headlines"):
            fresh["headlines"].pop()
            text = user_text()
            continue
        if fresh.get("filings"):
            fresh["filings"].pop()
            text = user_text()
            continue
        if fresh.get("prices") and len(fresh["prices"]) > 1:
            fresh["prices"].pop()
            text = user_text()
            continue
        break
    return {
        "group": group["name"],
        "system": system,
        "user": text,
        "ids": ids,
        "tokens": estimate_tokens(system) + estimate_tokens(text),
        "cut": cut,
        "num_ctx": limit,
    }


def _pop_fitted_chunk(packet: dict, queue: list, bundle: dict) -> dict | None:
    """Next chunk that fits the budget. Oversized groups are split in place."""
    while queue:
        group = queue.pop(0)
        chunk = build_chunk(packet, group, bundle)
        budget = max(1, chunk["num_ctx"] - int(chunk["num_ctx"] * 0.25))
        if chunk["tokens"] > budget and len(group["fields"]) > 1:
            mid = max(1, len(group["fields"]) // 2)
            queue.insert(0, {"name": group["name"], "fields": group["fields"][mid:]})
            queue.insert(0, {"name": group["name"], "fields": group["fields"][:mid]})
            continue
        return chunk
    return None


def build_chunks(packet: dict, bundle: dict) -> list[dict]:
    queue = list(refresh_groups(packet))
    chunks = []
    while True:
        chunk = _pop_fitted_chunk(packet, queue, bundle)
        if chunk is None:
            break
        chunks.append(chunk)
    return chunks


def _add_flag(packet: dict, field_id: str, kind: str, detail: str) -> None:
    flags = packet.setdefault("flags", [])
    kind = kind if kind in ("unverifiable", "conflict", "new_info", "stale_source") else "unverifiable"
    key = (field_id, kind, detail)
    seen = {(row.get("id"), row.get("kind"), row.get("detail")) for row in flags}
    if key not in seen:
        flags.append({"id": field_id, "kind": kind, "detail": detail})


def _flag_detail(result: dict, field_id: str) -> str:
    for flag in result.get("flags") or []:
        if isinstance(flag, dict) and flag.get("id") == field_id and flag.get("detail"):
            return str(flag["detail"])[:500]
    return ""


def _in_bundle(source: dict, bundle: dict) -> bool:
    allowed = source_keys(bundle)
    url = str(source.get("url") or "")
    name = str(source.get("name") or "").lower()
    return bool((url and url in allowed) or (name and name in allowed))


def _source_ok(source: dict, pulled_at) -> bool:
    return bool(source.get("type") and str(source.get("name") or "").strip() and parse_time(pulled_at))


def _update_source(packet: dict, field_id: str, update: dict) -> None:
    source_id = field_id.split(".", 1)[1]
    for source in (packet.get("sections") or {}).get("sources") or []:
        if isinstance(source, dict) and source.get("id") == source_id:
            source["pulled_at"] = update.get("pulled_at") or source.get("pulled_at")
            return


def _maybe_add_source(packet: dict, flag: dict, bundle: dict) -> None:
    if flag.get("kind") != "new_info":
        return
    detail = str(flag.get("detail") or "")
    sources = (packet.get("sections") or {}).setdefault("sources", [])
    known = {row.get("url") for row in sources if isinstance(row, dict)}
    pool = []
    for key in ("filings", "headlines", "prices"):
        pool.extend((bundle or {}).get(key) or [])
    for row in pool:
        url = row.get("url") or ""
        if not url or url not in detail or url in known:
            continue
        sources.append({
            "id": f"src-{len(sources) + 1}",
            "type": row.get("source_type") or "news",
            "name": row.get("source_name") or url,
            "url": url,
            "locator": row.get("form") or "",
            "published_at": row.get("filed") or row.get("published") or "",
            "pulled_at": row.get("pulled_at") or "",
            "field_ids": [],
            "refresh_priority": 2,
            "time_limit_hours": None,
        })
        known.add(url)


def _apply_narrative(packet: dict, edits) -> None:
    if not isinstance(edits, list):
        return
    notes = packet.get("stage1_notes") or []
    fields = field_map(packet)
    for edit in edits:
        if not isinstance(edit, dict):
            continue
        old = str(edit.get("old") or "")
        new = str(edit.get("new") or "")
        section = str(edit.get("section") or "")
        if not old or not new or old == new:
            continue
        if section in ("stage1_notes", "notes"):
            for note in notes:
                if note.get("text") == old:
                    note["text"] = new
            continue
        field = fields.get(section)
        if not field:
            continue
        source = field.get("source") if isinstance(field.get("source"), dict) else {}
        if str(field.get("notes") or "") == old:
            field["notes"] = new
        if source.get("type") == "model_estimate":
            continue


def apply_updates(packet: dict, refresh_ids: list[str], result: dict, bundle: dict) -> list[dict]:
    """Apply one chunk. Rejects anything the rules do not allow."""
    allowed = set(refresh_ids)
    fields = field_map(packet)
    locked = judgment_ids(packet)
    conflict_ids = set()
    for flag in (result or {}).get("flags") or []:
        if isinstance(flag, dict) and flag.get("kind") == "conflict" and flag.get("id"):
            conflict_ids.add(str(flag["id"]))
    logs = []
    seen = set()
    for update in (result or {}).get("updates") or []:
        if not isinstance(update, dict):
            continue
        field_id = str(update.get("id") or "")
        status = str(update.get("status") or "")
        if field_id not in allowed:
            logs.append({"id": field_id or "?", "status": "rejected", "detail": "not on the refresh list"})
            continue
        if field_id in seen:
            continue
        if status not in ("refreshed", "unchanged", "flagged"):
            _add_flag(packet, field_id, "unverifiable", "the local model did not return a usable status")
            logs.append({"id": field_id, "status": "flagged", "detail": "unusable status"})
            seen.add(field_id)
            continue
        field = fields.get(field_id)
        if field_id in locked or (field and (field.get("source") or {}).get("type") == "model_estimate"):
            if status == "refreshed":
                _add_flag(packet, field_id, "unverifiable", "refused a change to a judgment")
                logs.append({"id": field_id, "status": "flagged", "detail": "judgment fields cannot be changed"})
            else:
                detail = _flag_detail(result, field_id) if status == "flagged" else ""
                if status == "flagged":
                    _add_flag(packet, field_id, "unverifiable", detail or "flagged")
                logs.append({"id": field_id, "status": "flagged" if status == "flagged" else "unchanged", "detail": detail})
            seen.add(field_id)
            continue
        if field_id in conflict_ids:
            detail = _flag_detail(result, field_id) or "conflict between the packet and the fresh data"
            _add_flag(packet, field_id, "conflict", detail)
            logs.append({"id": field_id, "status": "flagged", "detail": detail})
            seen.add(field_id)
            continue
        if status == "flagged":
            detail = _flag_detail(result, field_id) or "flagged"
            _add_flag(packet, field_id, "unverifiable", detail)
            logs.append({"id": field_id, "status": "flagged", "detail": detail})
            seen.add(field_id)
            continue
        source = update.get("source") if isinstance(update.get("source"), dict) else {}
        pulled = update.get("pulled_at")
        if status == "refreshed" and not _source_ok(source, pulled):
            _add_flag(packet, field_id, "unverifiable", "refused a refreshed value with no source and pulled_at")
            logs.append({"id": field_id, "status": "flagged", "detail": "refreshed value had no source and pulled_at"})
            seen.add(field_id)
            continue
        if not _in_bundle(source, bundle) or not parse_time(pulled):
            _add_flag(packet, field_id, "unverifiable", "source was not in the fresh data")
            logs.append({"id": field_id, "status": "flagged", "detail": "source was not in the fresh data"})
            seen.add(field_id)
            continue
        if field_id.startswith("sources."):
            _update_source(packet, field_id, update)
            logs.append({"id": field_id, "status": status, "detail": ""})
            seen.add(field_id)
            continue
        if field is None:
            _add_flag(packet, field_id, "unverifiable", "field is not in the packet")
            logs.append({"id": field_id, "status": "flagged", "detail": "field is not in the packet"})
            seen.add(field_id)
            continue
        if status == "refreshed":
            field["value"] = update.get("value")
            field["unverified"] = False
        field["source"] = {
            "type": source.get("type"),
            "name": source.get("name"),
            "url": source.get("url") or "",
            "locator": source.get("locator") or "",
        }
        field["pulled_at"] = pulled
        if update.get("as_of"):
            field["as_of"] = update.get("as_of")
        note = str(field.get("notes") or "")
        if "UNVERIFIED" in note:
            field["notes"] = note.replace("UNVERIFIED", "").strip()
        logs.append({"id": field_id, "status": status, "detail": ""})
        seen.add(field_id)
    for field_id in refresh_ids:
        if field_id not in seen:
            _add_flag(packet, field_id, "unverifiable", "no status returned; the old number was not treated as verified")
            logs.append({"id": field_id, "status": "flagged", "detail": "no status returned"})
    for flag in (result or {}).get("flags") or []:
        if isinstance(flag, dict) and flag.get("id") and flag.get("detail"):
            _add_flag(packet, str(flag["id"]), str(flag.get("kind") or "unverifiable"), str(flag["detail"])[:500])
            _maybe_add_source(packet, flag, bundle)
    _apply_narrative(packet, (result or {}).get("narrative_edits"))
    return logs


def _estimates(packet: dict) -> dict:
    snap = {}
    for field in iter_fields(packet):
        source = field.get("source") if isinstance(field.get("source"), dict) else {}
        if source.get("type") == "model_estimate":
            snap[field["id"]] = (
                deepcopy(field.get("value")),
                field.get("rationale") or "",
                list(field.get("inputs") or []),
            )
    return snap


def _note_ids(packet: dict) -> list:
    return [tuple(note.get("field_ids") or []) for note in packet.get("stage1_notes") or []]


def _restore_estimates(packet: dict, before: dict) -> None:
    fields = field_map(packet)
    for field_id, (value, rationale, inputs) in before.items():
        field = fields.get(field_id)
        if not field:
            continue
        field["value"] = value
        field["rationale"] = rationale
        field["inputs"] = list(inputs)


def complete_json(complete, chunk: dict) -> tuple[dict | None, str, bool]:
    raw = complete(chunk["system"], chunk["user"], num_ctx=chunk["num_ctx"])
    text = raw if isinstance(raw, str) else ""
    parsed = parse_json_object(text)
    if isinstance(parsed, dict) and isinstance(parsed.get("updates"), list):
        return parsed, text, False
    repair = chunk["user"] + "\n\nThat was not the required JSON. Output strict JSON only."
    raw = complete(chunk["system"], repair, num_ctx=chunk["num_ctx"])
    text = raw if isinstance(raw, str) else ""
    parsed = parse_json_object(text)
    if isinstance(parsed, dict) and isinstance(parsed.get("updates"), list):
        return parsed, text, True
    return None, text, True


def done_check(packet: dict, refresh_ids: list[str], logs: list[dict], before_estimates: dict, before_notes: list) -> dict:
    failed = []
    by_id = {}
    for row in logs:
        if row["id"] not in by_id or row["status"] != "rejected":
            by_id[row["id"]] = row
    for field_id in refresh_ids:
        if (by_id.get(field_id) or {}).get("status") not in ("refreshed", "unchanged", "flagged"):
            failed.append(f"{field_id}: no status")
    dots = (packet.get("freshness") or {}).get("dots") or {}
    flags = packet.get("flags") or []
    flagged_ids = {flag.get("id") for flag in flags}
    for field_id in CORE_IDS:
        if dots.get(field_id) == "red" and field_id not in flagged_ids:
            failed.append(f"{field_id}: stale or unverified and not flagged")
    if (packet.get("packet_meta") or {}).get("derived_by") != "code":
        failed.append("derived fields were not recomputed")
    fields = field_map(packet)
    for row in logs:
        if row.get("status") != "refreshed" or str(row["id"]).startswith("sources."):
            continue
        field = fields.get(row["id"]) or {}
        source = field.get("source") if isinstance(field.get("source"), dict) else {}
        if not source.get("name") or not parse_time(field.get("pulled_at")):
            failed.append(f"{row['id']}: refreshed without a source and date")
    for field_id, before in before_estimates.items():
        field = fields.get(field_id) or {}
        after = (field.get("value"), field.get("rationale") or "", list(field.get("inputs") or []))
        if after != before:
            failed.append(f"{field_id}: judgment changed")
    if _note_ids(packet) != before_notes:
        failed.append("stage1 note judgments changed")
    return {"complete": not failed, "failed": failed}


def _apply_bundle_staleness(packet: dict, bundle: dict, logs: list[dict]) -> None:
    """A newer filing or headline makes an unconfirmed event or terms field stale."""
    status = {row["id"]: row.get("status") for row in logs}
    newest_any = None
    newest_terms = None
    for row in (bundle or {}).get("filings") or []:
        when = parse_time(row.get("filed") or row.get("pulled_at"))
        if when is None:
            continue
        if newest_any is None or when > newest_any:
            newest_any = when
        if row.get("terms_change") and (newest_terms is None or when > newest_terms):
            newest_terms = when
    for row in (bundle or {}).get("headlines") or []:
        when = parse_time(row.get("published") or row.get("pulled_at"))
        if when and (newest_any is None or when > newest_any):
            newest_any = when
    changed = False
    for field in iter_fields(packet):
        if status.get(field["id"]) in ("refreshed", "unchanged"):
            continue
        pulled = parse_time(field.get("pulled_at"))
        if pulled is None:
            continue
        kind = field.get("freshness_class")
        reason = ""
        if kind == "event" and newest_any and newest_any > pulled:
            reason = "a newer filing or headline is in the bundle"
        elif kind == "terms" and newest_terms and newest_terms > pulled:
            reason = "a newer amendment or terms filing is in the bundle"
        if not reason:
            continue
        field["dot"] = "red"
        changed = True
        _add_flag(packet, field["id"], "stale_source", reason + "; the old number was not treated as verified")
    if not changed:
        return
    dots = {field["id"]: field.get("dot") or "red" for field in iter_fields(packet)}
    core_bad = any(dots.get(field_id, "red") == "red" for field_id in CORE_IDS)
    if core_bad:
        badge = "Stale"
    elif any(dot != "green" for dot in dots.values()):
        badge = "Partly stale"
    else:
        badge = "Fresh"
    freshness = packet.setdefault("freshness", {})
    freshness["badge"] = badge
    freshness["dots"] = dots


def _flag_stale_core(packet: dict, logs: list[dict]) -> None:
    dots = (packet.get("freshness") or {}).get("dots") or {}
    refreshed = {row["id"] for row in logs if row.get("status") == "refreshed"}
    for field_id in CORE_IDS:
        if dots.get(field_id) == "red" and field_id not in refreshed:
            _add_flag(
                packet,
                field_id,
                "stale_source",
                "still outside its time limit; the old number was not treated as verified",
            )


def run_refresh(packet: dict, bundle: dict, complete, *, model_name: str = "gpt-oss-20b-finance", now=None) -> dict:
    """Chunked local refresh. complete(system, user, num_ctx=) -> text. Never a paid model."""
    before_estimates = _estimates(packet)
    before_notes = _note_ids(packet)
    logs: list[dict] = []
    calls = []
    cut = False
    queue = list(refresh_groups(packet))
    while True:
        chunk = _pop_fitted_chunk(packet, queue, bundle)
        if chunk is None:
            break
        cut = cut or chunk["cut"]
        print(
            f"[merger-arb] refresh group={chunk['group']} tokens={chunk['tokens']} "
            f"num_ctx={chunk['num_ctx']} cut={chunk['cut']}",
            flush=True,
        )
        parsed, raw, retried = complete_json(complete, chunk)
        if parsed is None:
            parsed = {"updates": [], "flags": [], "narrative_edits": []}
        logs.extend(apply_updates(packet, chunk["ids"], parsed, bundle))
        calls.append({
            "group": chunk["group"],
            "tokens": chunk["tokens"],
            "reply_tokens": estimate_tokens(raw),
            "retried": retried,
            "num_ctx": chunk["num_ctx"],
        })
    _restore_estimates(packet, before_estimates)
    recompute(packet)
    score_packet(packet, now=now)
    _apply_bundle_staleness(packet, bundle, logs)
    _flag_stale_core(packet, logs)
    done = done_check(packet, [field_id for group in refresh_groups(packet) for field in group["fields"] for field_id in [field["id"]]], logs, before_estimates, before_notes)
    # refresh_groups after updates still lists the same ids. Sources added later are not required this pass.
    meta = packet.setdefault("packet_meta", {})
    meta["parent_version"] = meta.get("version")
    meta["version"] = None
    meta["stage"] = "local_refresh"
    meta["model"] = model_name
    meta["created_at"] = (parse_time(now) or utc_now()).replace(microsecond=0).isoformat()
    packet["refresh_log"] = logs
    packet["done"] = done
    packet["cut_warning"] = "Some fresh data was cut to fit the local model." if cut else ""
    packet["local_calls"] = calls
    return packet
