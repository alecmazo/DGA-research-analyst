"""FMP mergers feed. Off unless FMP_API_KEY is set. Not a required source."""

from __future__ import annotations

import json

from merger_arb.scanner.models import FetchResult, SourceRecord

FMP_URL = "https://financialmodelingprep.com/stable/mergers-acquisitions-latest?page=0&limit=100&apikey="


def parse_fmp(payload, *, pulled_at: str) -> list[SourceRecord]:
    rows = payload if isinstance(payload, list) else []
    records = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("targetedSymbol") or row.get("symbol") or "")
        acquirer = str(row.get("companyName") or row.get("acquirerName") or "")
        external = str(row.get("cik") or row.get("targetedCik") or "") + ":" + symbol + ":" + acquirer
        if external == "::":
            continue
        records.append(SourceRecord(
            source="fmp",
            external_id=external[:200],
            url=str(row.get("link") or row.get("url") or ""),
            title=f"{acquirer} / {symbol}".strip(),
            published_at=str(row.get("transactionDate") or row.get("date") or "")[:10],
            pulled_at=pulled_at,
            event_type="NEW_DEAL",
            tickers=[symbol.upper()] if symbol else [],
            extra={"acquirer_name": acquirer, "target_name": str(row.get("targetedCompanyName") or "")},
        ))
    return records


class FmpSource:
    name = "fmp"
    label = "FMP"
    tier = 4

    def __init__(self, config):
        self.config = config

    def enabled(self) -> bool:
        return bool((self.config.fmp_api_key or "").strip())

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        if not self.enabled():
            return FetchResult(cursor=cursor, detail="FMP key is not set")
        url = FMP_URL + self.config.fmp_api_key
        try:
            body = ctx.get(url)
        except Exception as exc:
            return FetchResult(cursor=cursor, error=str(exc)[:300])
        try:
            payload = json.loads(body or b"null")
        except json.JSONDecodeError:
            return FetchResult(cursor=cursor, error="FMP JSON could not be read")
        if isinstance(payload, dict):
            return FetchResult(cursor=cursor, error=str(payload.get("Error Message") or "FMP JSON shape changed")[:300])
        records = parse_fmp(payload, pulled_at=ctx.now.isoformat())
        return FetchResult(records=records, cursor={"seen": len(records)})
