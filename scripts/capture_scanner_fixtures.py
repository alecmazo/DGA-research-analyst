"""Save trimmed scanner fixtures. Run by hand. Tests must not call this.

Uses SEC_USER_AGENT and the scanner rate limit. Refuses a placeholder user agent.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures" / "scanner"

URLS = {
    "efts_defm14a.json": "https://efts.sec.gov/LATEST/search-index?forms=DEFM14A&dateRange=custom&startdt=2026-09-01&enddt=2026-10-01",
    "company_tickers_small.json": "https://www.sec.gov/files/company_tickers.json",
    "nasdaq_eca.xml": "https://www.nasdaqtrader.com/rss.aspx?feed=currentheadlines&categorylist=105",
    "prn_ma.xml": "https://www.prnewswire.com/rss/financial-services-latest-news/acquisitions-mergers-and-takeovers-list.rss",
}


def main() -> int:
    if __name__ != "__main__":
        print("capture_scanner_fixtures is manual only", file=sys.stderr)
        return 2
    sys.path.insert(0, str(ROOT))
    from merger_arb.scanner.config import ScannerConfig
    from merger_arb.scanner.http import PoliteClient, ResponseCache

    config = ScannerConfig.from_env()
    if not config.sec_ok:
        print("Set SEC_USER_AGENT to a real contact before capturing.", file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    client = PoliteClient(
        user_agent=config.sec_user_agent,
        sec_rps=config.sec_max_rps,
        cache=ResponseCache(str(ROOT / "data" / "cache" / "scanner_http.sqlite")),
    )
    for name, url in URLS.items():
        body = client.get(url)
        text = body.decode("utf-8", errors="replace")
        (OUT / name).write_text(text[:20000], encoding="utf-8")
        print(name, len(body))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
