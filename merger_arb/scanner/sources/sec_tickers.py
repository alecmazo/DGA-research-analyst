"""company_tickers.json. Cached by the HTTP client for 24 hours."""

from __future__ import annotations

import json

from merger_arb.scanner.models import FetchResult

TICKER_URL = "https://www.sec.gov/files/company_tickers.json"


def parse_company_tickers(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {}
    out = {}
    for key, row in payload.items():
        if isinstance(row, dict) and (row.get("ticker") or row.get("cik_str") or row.get("title")):
            out[str(key)] = row
    return out


class SecTickersSource:
    name = "sec_tickers"
    label = "SEC tickers"
    tier = 1

    def __init__(self, config, url: str = TICKER_URL):
        self.config = config
        self.url = url

    def enabled(self) -> bool:
        return bool(self.config.sec_ok)

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        if not self.enabled():
            return FetchResult(cursor=cursor, detail="SEC user agent is not set")
        try:
            body = ctx.get(self.url)
        except Exception as exc:
            return FetchResult(cursor=cursor, error=str(exc)[:300])
        try:
            payload = json.loads(body or b"{}")
        except json.JSONDecodeError:
            return FetchResult(cursor=cursor, error="ticker JSON could not be read")
        mapped = parse_company_tickers(payload)
        if payload and not mapped:
            return FetchResult(cursor=cursor, error="ticker JSON shape changed")
        return FetchResult(cursor={"loaded": True}, ticker_map=mapped)
