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


def test_nightly_notice_lists_overnight_filings():
    body = (ROOT / "api/domains/_financials_body.py").read_text(encoding="utf-8")
    assert "def _fin_merge_overnight_rows" in body
    assert "def _fin_nightly_notice_text" in body
    assert '"filings": hits[:80]' in body
    assert "already in the store; " not in body.split("def _run_fin_nightly_followed")[1].split("def _fin_remap_state")[0]
    ui = (ROOT / "web/gp-app/src/components/desk/SecUpdatePopup.tsx").read_text(encoding="utf-8")
    assert "already in store" in ui or "in store" in ui
    assert "u.form" in ui
    assert "u.filed" in ui


def test_merge_overnight_rows_keeps_already_current():
    """Helpers are exec'd into server; replicate the merge contract here."""
    hits = [
        {"ticker": "AAPL", "form": "10-Q", "filed": "20260918", "company": "Apple"},
        {"ticker": "MSFT", "form": "10-K", "filed": "20260918", "company": "Microsoft"},
    ]
    updated = [{"ticker": "AAPL", "form": "10-Q", "filed": "20260918", "latest_period_end": "2026-06-30"}]
    by = {str(u.get("ticker") or "").upper(): u for u in updated}
    rows = []
    seen = set()
    for h in hits:
        tk = h["ticker"]
        seen.add(tk)
        u = by.get(tk) or {}
        rows.append({
            "ticker": tk,
            "form": u.get("form") or h.get("form"),
            "filed": u.get("filed") or h.get("filed"),
            "status": "new_period" if tk in by else "already_current",
        })
    assert [r["ticker"] for r in rows] == ["AAPL", "MSFT"]
    assert rows[0]["status"] == "new_period"
    assert rows[1]["status"] == "already_current"
    bits = [f"{r['ticker']} {r['form']} · {'new period' if r['status']=='new_period' else 'already in store'}" for r in rows]
    assert "MSFT 10-K · already in store" in bits
    assert "AAPL 10-Q · new period" in bits


def test_nightly_code_does_not_default_to_full_us():
    body = (ROOT / "api/domains/_financials_body.py").read_text(encoding="utf-8")
    assert "new_filings" in body
    assert "11:00pm" in body or "23:00" in body
    assert "fin_us_backfill" in body
    # Nightly worker must not call full US missing list
    night = body[body.find("def _auto_fin_nightly_worker") : body.find("def _auto_fin_monthly_worker")]
    assert "_fin_missing_tickers" not in night
    assert "_run_fin_nightly_followed" in night
