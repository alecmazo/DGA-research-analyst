"""Build the source list for a scan. Disabled sources stay in the list so the progress row can say skipped."""

from __future__ import annotations

from merger_arb.scanner.sources.fmp import FmpSource
from merger_arb.scanner.sources.ftc_et import FtcSource
from merger_arb.scanner.sources.nasdaq_eca import NasdaqSource
from merger_arb.scanner.sources.news_rss import (
    GNW_URL,
    GOOGLE_URL,
    PRN_URL,
    RssFeedSource,
    YahooTickerSource,
)
from merger_arb.scanner.sources.sec_efts import SecEftsSource
from merger_arb.scanner.sources.sec_index import SecIndexSource
from merger_arb.scanner.sources.sec_submissions import SecSubmissionsSource
from merger_arb.scanner.sources.sec_tickers import SecTickersSource
from merger_arb.scanner.sources.trackers import enabled_adapters


def build_sources(config) -> list:
    sources = [
        SecEftsSource(config),
        SecIndexSource(config),
        SecSubmissionsSource(config),
        SecTickersSource(config),
        FtcSource(config),
        NasdaqSource(config),
        RssFeedSource("prn", "PR Newswire", PRN_URL, config.enable_prn),
        RssFeedSource("gnw", "GlobeNewswire", GNW_URL, config.enable_gnw),
        YahooTickerSource(config),
        RssFeedSource("google_news", "Google News", GOOGLE_URL, config.enable_google_news),
        RssFeedSource("businesswire", "Business Wire", config.businesswire_url, bool(config.businesswire_url)),
        FmpSource(config),
    ]
    sources.extend(enabled_adapters(config))
    return sources
