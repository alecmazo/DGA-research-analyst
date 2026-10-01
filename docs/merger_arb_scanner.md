# Merger arb deal scanner

A **Scan for deals** button on Merger Arb (`/gp/merger-arb`) reads free sources in the background and lists candidate deals. Nothing is written to the desk until Add, Ignore, or Open in analysis.

The sample deal `fixture-acme` stays in memory. Demo accounts cannot POST these routes.

## Sources

SEC full-text search is the primary source. If that JSON shape changes, the daily form index is the fallback. The EDGAR `cgi-bin` Atom feed is not called.

RSS is parsed with the standard-library XML reader, the same way Yahoo headlines are read. `feedparser` is not installed.

| Source | Default | Notes |
|---|---|---|
| SEC search, daily index, submissions, ticker map | On, if `SEC_USER_AGENT` is a real contact | Shared limit, hard cap 10 requests/second. A 403 or 429 stops only this scan's SEC tier. |
| FTC early-termination API | On | Blank `FTC_API_KEY` uses `DEMO_KEY`. The progress row says that limit is tiny. A missing notice is not "HSR uncleared". Notices never create a candidate by themselves. |
| Nasdaq corporate-actions RSS | On | Completion corroboration. |
| PR Newswire and GlobeNewswire | On | A dead feed marks that row error. The rest of the scan finishes. |
| Yahoo ticker RSS | On | Desk tickers only. Reuses the existing Yahoo RSS URL. |
| Google News and Business Wire | Off | Google News is disallowed by its robots file. Business Wire runs only when `BUSINESSWIRE_MA_FEED_URL` is set. |
| Trackers | Off | The interface is there. No adapter is enabled. |
| FMP | Off | Runs only when `FMP_API_KEY` is set. |
| Local model | Off | `SCANNER_LLM_ENABLED=false`. It never calls Grok or Claude. |

## Config

```
SEC_USER_AGENT=Name <you@example.com>
SEC_MAX_RPS=5
SCANNER_INITIAL_LOOKBACK_DAYS=120
SCANNER_HTTP_CACHE_PATH=data/cache/scanner_http.sqlite
FTC_API_KEY=
SCANNER_ENABLE_FTC=true
SCANNER_ENABLE_FTC_HTML=false
SCANNER_ENABLE_NASDAQ_ECA=true
SCANNER_ENABLE_PRNEWSWIRE=true
SCANNER_ENABLE_GLOBENEWSWIRE=true
SCANNER_ENABLE_YAHOO_TICKER_RSS=true
SCANNER_ENABLE_GOOGLE_NEWS=false
BUSINESSWIRE_MA_FEED_URL=
SCANNER_ENABLE_TRACKERS=false
FMP_API_KEY=
SCANNER_LLM_ENABLED=false
OLLAMA_BASE_URL=
OLLAMA_MODEL=gpt-oss-20b-finance
SCANNER_LLM_ALLOW_REMOTE=false
SCANNER_DAILY_TIME=
SCANNER_PRICE_CACHE_SECONDS=300
```

`SCANNER_DAILY_TIME` is a Pacific `HH:MM`. Empty means no daily scan. There is no launchd job and no scheduler package. The CLI is `python -m merger_arb.scanner.cli scan --incremental` or `--full --since YYYY-MM-DD`.

Prices use `market_data.get_quotes` first, then the Yahoo chart JSON, then `yfinance`. Tiingo is not required.

## FTC key

The early-termination API takes a free api.data.gov key. Sign up with an email at https://api.data.gov/signup/ — no card. Put the key in `FTC_API_KEY`. Without it the scan uses `DEMO_KEY`, which is only enough for a smoke check.

## Spread math on the scan table

Cash, stock, and mixed use `Decimal`. Collar, election, and proration show "—" and `needs_manual_terms`. A CVR is not in the base offer. Quarter words map to quarter-end, and that assumption is labeled. Annualized is `(1 + spread) ** (365 / days) - 1`. After you add a deal, the analysis page recomputes with the existing packet math.

## Tests

Scanner tests use fixtures and do not open the network. `responses`, `freezegun`, and `pytest-socket` are test-only. They are not in `requirements.txt`. `rapidfuzz` and `beautifulsoup4` are.

`scripts/capture_scanner_fixtures.py` is run by hand. Tests do not call it.
