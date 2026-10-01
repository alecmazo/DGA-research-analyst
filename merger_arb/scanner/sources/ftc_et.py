"""FTC early-termination API. Notices attach to a candidate. They never create one."""

from __future__ import annotations

import json
from urllib.parse import quote

from merger_arb.scanner.models import FetchResult, SourceRecord

FTC_URL = "https://api.ftc.gov/v0/hsr-early-termination-notices"


def ftc_url(api_key: str) -> str:
    return (
        FTC_URL
        + "?api_key=" + quote(api_key or "DEMO_KEY")
        + "&page[limit]=50&sort[d][path]=created&sort[d][direction]=DESC"
    )


def parse_ftc(payload: dict, *, pulled_at: str) -> list[SourceRecord]:
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    records = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        attrs = row.get("attributes") if isinstance(row.get("attributes"), dict) else {}
        number = str(attrs.get("transaction-number") or row.get("id") or "")
        if not number:
            continue
        acquired = str(attrs.get("acquired-party") or "")
        acquiring = str(attrs.get("acquiring-party") or "")
        records.append(SourceRecord(
            source="ftc_et",
            external_id=number,
            url=FTC_URL,
            title=str(attrs.get("title") or ""),
            published_at=str(attrs.get("date") or attrs.get("created") or "")[:10],
            pulled_at=pulled_at,
            raw_excerpt=str(attrs.get("title") or "")[:300],
            event_type="HSR_ET",
            extra={
                "acquired_party": acquired,
                "acquiring_party": acquiring,
                "acquired_entities": attrs.get("acquired-entities") or [],
                "created": attrs.get("created") or "",
            },
        ))
    return records


class FtcSource:
    name = "ftc"
    label = "FTC"
    tier = 2

    def __init__(self, config):
        self.config = config

    def enabled(self) -> bool:
        return bool(self.config.enable_ftc)

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        if not self.enabled():
            return FetchResult(cursor=cursor, detail="FTC is off")
        detail = "DEMO_KEY rate limit is tiny" if self.config.ftc_is_demo else ""
        url = ftc_url(self.config.ftc_key_used)
        try:
            body = ctx.get(url)
        except Exception as exc:
            return FetchResult(cursor=cursor, error=str(exc)[:300], detail=detail)
        try:
            payload = json.loads(body or b"{}")
        except json.JSONDecodeError:
            return FetchResult(cursor=cursor, error="FTC JSON could not be read", detail=detail)
        if isinstance(payload, dict) and payload.get("error"):
            return FetchResult(cursor=cursor, error=str(payload.get("error"))[:300], detail=detail)
        records = parse_ftc(payload, pulled_at=ctx.now.isoformat())
        if payload and "data" not in payload:
            return FetchResult(cursor=cursor, error="FTC JSON shape changed", detail=detail)
        last = str((cursor or {}).get("max_created") or "")
        fresh = []
        created_values = []
        for row in records:
            created = str((row.extra or {}).get("created") or row.published_at)
            created_values.append(created)
            if not last or created > last:
                fresh.append(row)
        new_cursor = {"max_created": max(created_values) if created_values else last}
        return FetchResult(records=fresh if last else records, cursor=new_cursor, detail=detail)
