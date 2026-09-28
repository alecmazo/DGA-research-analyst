"""Folder labels for the transcript library. No network and no database."""

from __future__ import annotations

_SOURCE_LABELS = {
    "motley_fool": "Motley Fool",
    "fool": "Motley Fool",
    "fmp": "FMP",
    "alpha_vantage": "Alpha Vantage",
    "av": "Alpha Vantage",
    "huggingface": "Hugging Face",
    "grok": "Grok",
    "youtube": "YouTube",
    "unknown": "",
}


def enabled() -> bool:
    import os
    return os.environ.get("PODCAST_INTEL_ENABLED", "true").strip().lower() != "false"


def _day(row: dict) -> str:
    for key in ("published_at", "created_at", "call_date"):
        raw = str(row.get(key) or "").strip()
        if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
            return raw[:10]
    return ""


def source_label(source: str | None) -> str:
    raw = (source or "").strip()
    if not raw:
        return ""
    return _SOURCE_LABELS.get(raw.lower(), raw.replace("_", " "))


def interview_folder(row: dict) -> str:
    channel = str(row.get("channel") or "").strip()
    if channel:
        return channel
    person = str(row.get("person") or "").strip()
    if person:
        return person
    source = source_label(row.get("source"))
    return source or "Unlabeled"


def interview_label(row: dict, folder: str) -> str:
    title = str(row.get("title") or "").strip() or "Untitled"
    day = _day(row)
    person = str(row.get("person") or "").strip()
    head = f"{day} · {title}" if day else title
    if person and person.lower() != folder.lower():
        return f"{head} · {person}"
    return head


def call_label(row: dict) -> str:
    quarter = str(row.get("quarter") or "").strip() or "Undated"
    bits = [quarter]
    day = _day(row)
    if day:
        bits.append(day)
    source = source_label(row.get("source"))
    if source:
        bits.append(source)
    return " · ".join(bits)


def group_interviews(rows: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for row in rows or []:
        folder = interview_folder(row)
        buckets.setdefault(folder, []).append({
            "id": row.get("id"),
            "label": interview_label(row, folder),
            "person": str(row.get("person") or "").strip(),
            "channel": str(row.get("channel") or "").strip(),
            "words": row.get("word_count"),
            "url": row.get("video_url") or "",
            "day": _day(row),
        })
    folders = []
    for name in sorted(buckets, key=str.casefold):
        items = sorted(buckets[name], key=lambda item: item.get("day") or "", reverse=True)
        folders.append({"label": name, "count": len(items), "items": items})
    return folders


def group_calls(rows: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for row in rows or []:
        ticker = str(row.get("ticker") or "").strip().upper() or "—"
        item = {
            "ticker": ticker,
            "quarter": str(row.get("quarter") or "").strip() or "Undated",
            "label": call_label(row),
            "call_date": _day(row),
            "source": source_label(row.get("source")),
            "chunks": int(row.get("chunks") or 0),
        }
        buckets.setdefault(ticker, []).append(item)
    folders = []
    for ticker in sorted(buckets, key=str.casefold):
        items = sorted(
            buckets[ticker],
            key=lambda item: (item.get("call_date") or "", item.get("quarter") or ""),
            reverse=True,
        )
        folders.append({"label": ticker, "count": len(items), "items": items})
    return folders
