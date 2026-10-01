"""PR Newswire, GlobeNewswire, Yahoo ticker RSS, and the opt-in wires."""

from __future__ import annotations

from urllib.parse import quote

from merger_arb.scanner.models import FetchResult
from merger_arb.scanner.sources.nasdaq_eca import _guid_cursor
from merger_arb.scanner.sources.rss_parse import parse_rss

PRN_URL = (
    "https://www.prnewswire.com/rss/financial-services-latest-news/"
    "acquisitions-mergers-and-takeovers-list.rss"
)
GNW_URL = (
    "https://www.globenewswire.com/RssFeed/subjectcode/27-Mergers%20And%20Acquisitions/"
    "feedTitle/GlobeNewswire%20-%20Mergers%20And%20Acquisitions"
)
GOOGLE_URL = (
    "https://news.google.com/rss/search?q="
    + quote('"definitive agreement to acquire" when:7d')
    + "&hl=en-US&gl=US&ceid=US:en"
)


def yahoo_rss_url(ticker: str) -> str:
    from api.domains.yahoo_finance_news import YAHOO_RSS
    return YAHOO_RSS.format(ticker=quote((ticker or "").strip().upper()))


class RssFeedSource:
    tier = 3

    def __init__(self, name: str, label: str, url: str, enabled: bool):
        self.name = name
        self.label = label
        self.url = url
        self._enabled = enabled and bool(url)

    def enabled(self) -> bool:
        return self._enabled

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        if not self.enabled():
            return FetchResult(cursor=cursor, detail=f"{self.label} is off")
        try:
            body = ctx.get(self.url)
        except Exception as exc:
            return FetchResult(cursor=cursor, error=str(exc)[:300])
        if not body:
            return FetchResult(cursor=cursor, error=f"{self.label} returned nothing")
        text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body)
        records = parse_rss(text, source=self.name, pulled_at=ctx.now.isoformat())
        return _guid_cursor(records, cursor)


class YahooTickerSource:
    name = "yahoo_rss"
    label = "Yahoo"
    tier = 3

    def __init__(self, config):
        self.config = config

    def enabled(self) -> bool:
        return bool(self.config.enable_yahoo_rss)

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        if not self.enabled():
            return FetchResult(cursor=cursor, detail="Yahoo ticker RSS is off")
        tickers = []
        for deal in ctx.desk_deals or []:
            if deal.get("id") == "fixture-acme" or deal.get("sample"):
                continue
            for key in ("target_ticker", "acquirer_ticker"):
                ticker = str(deal.get(key) or "").upper()
                if ticker and ticker not in tickers:
                    tickers.append(ticker)
        if not tickers:
            return FetchResult(cursor=cursor, detail="No desk tickers")
        records = []
        for ticker in tickers[:20]:
            try:
                body = ctx.get(yahoo_rss_url(ticker))
            except Exception as exc:
                return FetchResult(records=records, cursor=cursor, error=str(exc)[:300])
            text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body or "")
            parsed = parse_rss(text, source="yahoo_rss", pulled_at=ctx.now.isoformat())
            for row in parsed:
                if ticker not in row.tickers:
                    row.tickers.append(ticker)
                row.extra["desk_ticker"] = ticker
            records.extend(parsed)
        return _guid_cursor(records, cursor)
