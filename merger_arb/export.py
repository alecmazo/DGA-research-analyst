"""Markdown and JSON exports of one saved packet."""

from __future__ import annotations

import json

from merger_arb.present import present_packet


def _row_lines(row: dict) -> list[str]:
    lines = [f"- **{row.get('label') or row.get('id')}:** {row.get('display') or '—'}"]
    source = row.get("source_name") or "No source"
    url = row.get("source_url") or ""
    if url:
        lines.append(f"  - Source: [{source}]({url})")
    else:
        lines.append(f"  - Source: {source}")
    if row.get("locator"):
        lines.append(f"  - Locator: {row['locator']}")
    if row.get("pulled_at_pt"):
        lines.append(f"  - Pulled: {row['pulled_at_pt']}")
    if row.get("as_of_pt"):
        lines.append(f"  - As of: {row['as_of_pt']}")
    if row.get("unverified"):
        lines.append("  - UNVERIFIED")
    if row.get("notes"):
        lines.append(f"  - Notes: {row['notes']}")
    return lines


def to_markdown(packet: dict, deal: dict | None = None) -> str:
    view = present_packet(packet)
    deal = deal or {}
    title = deal.get("target_ticker") or view.get("deal_id") or "deal"
    other = deal.get("acquirer_ticker") or ""
    lines = [
        f"# Merger arb analysis: {title}" + (f" / {other}" if other else ""),
        "",
        f"Version {view.get('version')} · {view.get('model') or ''} · {view.get('stage') or ''}",
        f"As of {view.get('as_of_pt') or '—'} · {view.get('badge') or ''}",
        "",
    ]
    for card in view.get("sections") or []:
        lines.append(f"## {card['title']}")
        lines.append("")
        for row in card.get("rows") or []:
            lines.extend(_row_lines(row))
        for block in card.get("blocks") or []:
            lines.append(f"### {block.get('title') or 'Item'}")
            for row in block.get("rows") or []:
                lines.extend(_row_lines(row))
        if not card.get("rows") and not card.get("blocks"):
            lines.append("Nothing stored.")
        lines.append("")
    lines.append("## Flags")
    lines.append("")
    flags = view.get("flags") or []
    if not flags:
        lines.append("None.")
    for flag in flags:
        lines.append(f"- {flag.get('kind')}: {flag.get('id')} — {flag.get('detail')}")
    lines.append("")
    lines.append("## Deep dive notes")
    lines.append("")
    notes = view.get("stage1_notes") or []
    if not notes:
        lines.append("None.")
    for note in notes:
        ids = ", ".join(note.get("field_ids") or [])
        lines.append(f"- {note.get('text')} ({ids})")
    lines.append("")
    return "\n".join(lines)


def to_json(packet: dict) -> str:
    return json.dumps(packet, indent=2, default=str) + "\n"
