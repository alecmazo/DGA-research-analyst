"""Turn a packet into the nine cards the page renders."""

from __future__ import annotations

from merger_arb.freshness import format_pt
from merger_arb.schema import SECTION_TITLES, is_field

LABELS = {
    "overview.target_name": "Target",
    "overview.target_ticker": "Target ticker",
    "overview.acquirer_name": "Acquirer",
    "overview.acquirer_ticker": "Acquirer ticker",
    "overview.announced_date": "Announced",
    "overview.offer_terms": "Offer terms",
    "overview.offer_value": "Offer value per share",
    "overview.target_price": "Target price",
    "overview.acquirer_price": "Acquirer price",
    "overview.status": "Status",
    "overview.expected_close": "Expected close",
    "overview.outside_date": "Outside date",
    "overview.extensions": "Extensions",
    "overview.years_to_close": "Years to expected close",
    "spread.gross_dollars": "Gross spread",
    "spread.gross_percent": "Gross spread %",
    "spread.annualized": "Annualized spread",
    "spread.annualized_simple": "Simple annualized",
    "spread.implied_probability": "Implied probability",
    "spread.sensitivity": "Sensitivity",
    "structure.consideration": "Consideration",
    "structure.cash_per_share": "Cash per share",
    "structure.exchange_ratio": "Exchange ratio",
    "structure.collar_type": "Collar",
    "structure.collar_low": "Collar low",
    "structure.collar_high": "Collar high",
    "structure.collar_value": "Collar value",
    "structure.walkaway_low": "Walk-away low",
    "structure.walkaway_high": "Walk-away high",
    "structure.proration_cash": "Cash election fraction",
    "structure.cvr": "CVR",
    "structure.special_dividend": "Special dividend",
    "structure.financing": "Committed financing",
    "structure.financing_condition": "Financing condition",
    "structure.acquirer_cash": "Acquirer cash",
    "structure.mac": "MAC",
    "structure.minimum_tender": "Minimum tender",
    "structure.go_shop": "Go-shop",
    "structure.matching_rights": "Matching rights",
    "votes.companies": "Votes required",
    "votes.threshold": "Threshold",
    "votes.record_date": "Record date",
    "votes.meeting_date": "Meeting date",
    "votes.locked_up_pct": "Locked up",
    "votes.iss": "ISS",
    "votes.glass_lewis": "Glass Lewis",
    "downside.target_break_fee": "Target break fee",
    "downside.reverse_break_fee": "Reverse break fee",
    "downside.unaffected_price": "Unaffected price",
    "downside.peer_move": "Peer move since unaffected",
    "downside.peer_index": "Peer index",
    "downside.break_price": "Estimated break price",
    "downside.downside_dollars": "Downside",
    "downside.downside_percent": "Downside %",
    "upside.upside_dollars": "Upside",
    "upside.upside_percent": "Upside %",
    "upside.annualized": "Annualized return",
    "upside.dividends": "Pre-close dividends",
    "upside.cvr_estimate": "CVR estimate",
    "upside.bump_talk": "Bump talk",
}


def _display(field: dict) -> str:
    if field.get("unverified"):
        raw = field.get("value")
        shown = "—" if raw is None else str(raw)
        return f"UNVERIFIED {shown}".strip()
    value = field.get("value")
    if isinstance(value, float):
        unit = field.get("unit") or ""
        if unit == "pct":
            return f"{value * 100:.2f}%"
        if unit == "USD":
            return f"${value:,.2f}"
        return f"{value:.4g}"
    if isinstance(value, list):
        return f"{len(value)} rows"
    if value is None:
        return "—"
    return str(value)


def row_for(field: dict) -> dict:
    source = field.get("source") if isinstance(field.get("source"), dict) else {}
    return {
        "id": field["id"],
        "label": LABELS.get(field["id"], field["id"]),
        "display": _display(field),
        "value": field.get("value"),
        "unit": field.get("unit") or "",
        "source_name": source.get("name") or "",
        "source_url": source.get("url") or "",
        "source_type": source.get("type") or "",
        "locator": source.get("locator") or "",
        "pulled_at_pt": format_pt(field.get("pulled_at")),
        "as_of_pt": format_pt(field.get("as_of")),
        "dot": field.get("dot") or "red",
        "unverified": bool(field.get("unverified")),
        "notes": field.get("notes") or "",
    }


def _rows(node) -> list[dict]:
    rows = []
    if isinstance(node, dict):
        for value in node.values():
            if is_field(value):
                rows.append(row_for(value))
    return rows


def _blocks(items, prefix: str) -> list[dict]:
    blocks = []
    if not isinstance(items, list):
        return blocks
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        title = ""
        for key in ("authority", "event", "name"):
            candidate = item.get(key)
            if is_field(candidate):
                title = str(candidate.get("value") or "")
                break
        blocks.append({
            "title": title or f"{prefix} {index + 1}",
            "rows": _rows(item),
        })
    return blocks


def version_history(packets: list[dict]) -> list[dict]:
    from merger_arb.schema import field_map

    rows = []
    previous = None
    for packet in packets or []:
        meta = packet.get("packet_meta") or {}
        diff = []
        if previous is not None:
            old = field_map(previous)
            new = field_map(packet)
            for field_id in sorted(set(old) | set(new)):
                before = (old.get(field_id) or {}).get("value")
                after = (new.get(field_id) or {}).get("value")
                if before != after:
                    diff.append({"id": field_id, "before": before, "after": after})
        rows.append({
            "version": meta.get("version"),
            "stage": meta.get("stage") or "",
            "model": meta.get("model") or "",
            "created_at_pt": format_pt(meta.get("created_at")),
            "diff": diff,
        })
        previous = packet
    return rows


def present_packet(packet: dict, versions: list[dict] | None = None) -> dict:
    sections_in = packet.get("sections") or {}
    cards = []
    for key, title in SECTION_TITLES:
        node = sections_in.get(key)
        if key == "sources" and isinstance(node, list):
            rows = []
            for source in node:
                if not isinstance(source, dict):
                    continue
                rows.append({
                    "id": source.get("id") or "",
                    "label": source.get("name") or source.get("id") or "Source",
                    "display": source.get("type") or "",
                    "value": source.get("name") or "",
                    "unit": "",
                    "source_name": source.get("name") or "",
                    "source_url": source.get("url") or "",
                    "source_type": source.get("type") or "",
                    "locator": source.get("locator") or "",
                    "pulled_at_pt": format_pt(source.get("pulled_at")),
                    "as_of_pt": format_pt(source.get("published_at")),
                    "dot": "green",
                    "unverified": False,
                    "notes": ", ".join(source.get("field_ids") or []),
                })
            cards.append({"id": key, "title": title, "rows": rows, "blocks": []})
            continue
        if key in ("regulatory", "catalysts"):
            cards.append({
                "id": key,
                "title": title,
                "rows": [],
                "blocks": _blocks(node, title),
            })
            continue
        cards.append({"id": key, "title": title, "rows": _rows(node), "blocks": []})
    meta = packet.get("packet_meta") or {}
    freshness = packet.get("freshness") or {}
    return {
        "deal_id": meta.get("deal_id") or "",
        "version": meta.get("version"),
        "stage": meta.get("stage") or "",
        "model": meta.get("model") or "",
        "as_of_pt": format_pt(meta.get("created_at")),
        "badge": freshness.get("badge") or "Stale",
        "sections": cards,
        "flags": list(packet.get("flags") or []),
        "stage1_notes": list(packet.get("stage1_notes") or []),
        "refresh": list(packet.get("refresh_log") or []),
        "done": packet.get("done") or {},
        "versions": versions or [],
        "cut_warning": packet.get("cut_warning") or "",
    }
