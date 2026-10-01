"""Nasdaq Trader equity corporate-actions RSS. Completion corroboration, not a new-deal source."""

from __future__ import annotations

from merger_arb.scanner.models import FetchResult
from merger_arb.scanner.sources.rss_parse import parse_rss

NASDAQ_URL = "https://www.nasdaqtrader.com/rss.aspx?feed=currentheadlines&categorylist=105"


class NasdaqSource:
    name = "nasdaq_eca"
    label = "Nasdaq ECA"
    tier = 2

    def __init__(self, config, url: str = NASDAQ_URL):
        self.config = config
        self.url = url

    def enabled(self) -> bool:
        return bool(self.config.enable_nasdaq)

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        if not self.enabled():
            return FetchResult(cursor=cursor, detail="Nasdaq is off")
        try:
            body = ctx.get(self.url)
        except Exception as exc:
            return FetchResult(cursor=cursor, error=str(exc)[:300])
        text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body or "")
        records = parse_rss(text, source="nasdaq_eca", pulled_at=ctx.now.isoformat())
        for row in records:
            if "merger closed" in (row.title or "").lower():
                row.event_type = "COMPLETED"
        return _guid_cursor(records, cursor)


def _guid_cursor(records, cursor: dict) -> FetchResult:
    seen = set((cursor or {}).get("guids") or [])
    fresh = [row for row in records if row.external_id not in seen]
    guids = list(seen)
    for row in records:
        if row.external_id not in seen:
            guids.append(row.external_id)
    return FetchResult(records=fresh if seen else records, cursor={"guids": guids[-2000:]})
