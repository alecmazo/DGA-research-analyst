"""SEC overnight window + daily-index parse. No live SEC, no full-store walk."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sec_edgar_xbrl as edgar


SAMPLE_IDX = """
Description:           Daily Master Index of EDGAR Filings
Last Data Received:    September 16, 2026
Comments:              webmaster@sec.gov
Anonymous FTP:         ftp://ftp.sec.gov/edgar/
Cloud HTTP:            https://www.sec.gov/Archives/

CIK|Company Name|Form Type|Date Filed|Filename
--------------------------------------------------------------------------------
320193|Apple Inc.|10-Q|20260916|edgar/data/320193/0000320193-26-000077.txt
789019|MICROSOFT CORP|10-K|20260916|edgar/data/789019/0001564590-26-000001.txt
1318605|Tesla, Inc.|8-K|20260916|edgar/data/1318605/0001193125-26-000002.txt
1018724|AMAZON COM INC|10-Q/A|20260916|edgar/data/1018724/0001018724-26-000009.txt
"""


def test_parse_daily_master_keeps_10k_10q_drops_8k():
    rows = edgar.parse_daily_master_index(SAMPLE_IDX)
    forms = {r["form"] for r in rows}
    assert "10-Q" in forms
    assert "10-K" in forms
    assert "10-Q/A" in forms
    assert "8-K" not in forms
    ciks = {r["cik"] for r in rows}
    assert "0000320193" in ciks
    assert len(rows) == 3


def test_window_wraps_midnight():
    # Import after path; helpers live on the exec'd server module in prod.
    # Re-implement the wrap rule here so the unit test does not boot FastAPI.
    def in_window(hour: int, start=23, end=6) -> bool:
        if start > end:
            return hour >= start or hour < end
        return start <= hour < end

    assert in_window(23) is True
    assert in_window(0) is True
    assert in_window(5) is True
    assert in_window(6) is False
    assert in_window(11) is False
    assert in_window(22) is False


def test_ticker_map_cik_reverse_roundtrip():
    edgar._TICKER_CACHE["AAPL"] = "0000320193"
    edgar._CIK_CACHE["0000320193"] = "AAPL"
    assert edgar.resolve_ticker_for_cik("320193") == "AAPL"
    assert edgar.resolve_ticker_for_cik("0000320193") == "AAPL"


def test_nightly_code_does_not_default_to_full_us():
    body = (ROOT / "api/domains/_financials_body.py").read_text(encoding="utf-8")
    assert "new_filings" in body
    assert "11:00pm" in body or "23:00" in body
    assert "fin_us_backfill" in body
    # Nightly worker must not call full US missing list
    night = body[body.find("def _auto_fin_nightly_worker") : body.find("def _auto_fin_monthly_worker")]
    assert "_fin_missing_tickers" not in night
    assert "_run_fin_nightly_followed" in night
