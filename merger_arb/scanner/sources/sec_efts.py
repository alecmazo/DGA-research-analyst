"""EDGAR full-text search. Falls back to an error string when the JSON shape changes."""

from __future__ import annotations

import json

from merger_arb.scanner.classify import classify_filing
from merger_arb.scanner.models import FetchResult
from merger_arb.scanner.sources.sec_common import (
    NEW_FORMS,
    loads,
    parse_efts,
    search_url,
    seen_filter,
    window,
)


class SecEftsSource:
    name = "sec_efts"
    label = "SEC efts"
    tier = 1

    def __init__(self, config, urls=None):
        self.config = config
        self.urls = urls

    def enabled(self) -> bool:
        return bool(self.config.sec_ok)

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        if not self.enabled():
            return FetchResult(cursor=cursor, detail="SEC user agent is not set")
        start, end = window(
            ctx.today, full=ctx.full, since=ctx.since, cursor=cursor, lookback_days=self.config.lookback_days,
        )
        urls = list(self.urls or [])
        if not urls:
            for form, phrase in NEW_FORMS:
                urls.append(search_url(form, start, end, phrase))
        records = []
        shape_error = ""
        for url in urls:
            try:
                body = ctx.get(url)
            except Exception as exc:
                return FetchResult(records=records, cursor=cursor, error=str(exc)[:300])
            phrase = "Agreement and Plan of Merger" in url
            try:
                payload = loads(body)
            except json.JSONDecodeError:
                return FetchResult(records=records, cursor=cursor, error="search JSON could not be read")
            parsed, error = parse_efts(
                payload,
                pulled_at=ctx.now.isoformat(),
                query_has_merger=phrase,
                allow_form_15=self.config.enable_form_15,
            )
            if error:
                shape_error = error
                continue
            for row in parsed:
                if row.event_type == "" and row.text:
                    row.event_type = classify_filing(
                        row.form, row.items, row.text, query_has_merger=row.query_has_merger,
                    ) or ""
            records.extend(parsed)
            self._maybe_documents(parsed, ctx)
        if shape_error and not records:
            return FetchResult(records=[], cursor=cursor, error=shape_error)
        fresh, new_cursor = seen_filter(records, cursor or {})
        detail = shape_error
        return FetchResult(records=fresh, cursor=new_cursor, error="" if records or not shape_error else shape_error, detail=detail)

    def _maybe_documents(self, records, ctx) -> None:
        for row in records:
            if not row.url or row.text:
                continue
            try:
                body = ctx.get(row.url)
            except Exception:
                continue
            if not body:
                continue
            row.text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body)
            event = classify_filing(
                row.form,
                row.items,
                row.text,
                query_has_merger=row.query_has_merger,
                allow_form_15=self.config.enable_form_15,
            )
            if event:
                row.event_type = event
