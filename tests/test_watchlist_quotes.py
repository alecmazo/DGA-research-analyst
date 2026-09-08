"""Watchlist / quote feed: no yfinance on the hot path; never stamp null prices."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import market_data as md

ET = ZoneInfo("America/New_York")
# Tuesday RTH — live session, expected prior weekday is Monday 2026-09-07.
NOW = datetime(2026, 9, 8, 10, 30, tzinfo=ET)


def _ts(iso: str) -> int:
    return int(datetime.fromisoformat(iso).replace(tzinfo=ET).timestamp())


def test_yf_prior_close_off_by_default(monkeypatch):
    monkeypatch.delenv("QUOTE_USE_YFINANCE", raising=False)

    def boom(*_a, **_k):
        raise AssertionError("yfinance must not import on the quote hot path")

    monkeypatch.setitem(sys.modules, "yfinance", type("X", (), {"Ticker": boom})())
    assert md._yf_prior_close("AAPL") is None


def test_session_prior_close_skips_yfinance(monkeypatch):
    monkeypatch.setattr(md, "_us_now_et", lambda: NOW)

    def boom(*_a, **_k):
        raise AssertionError("yfinance must not run in _session_prior_close")

    monkeypatch.setattr(md, "_yf_prior_close", boom)
    monkeypatch.setattr(md, "_nasdaq_daily_bars", lambda _s: [])
    # Expected prior is 2026-09-07; bars stop at Friday — must still return
    # Friday close, not hang on yfinance.
    prev = md._session_prior_close(
        [("2026-09-03", 10.0), ("2026-09-04", 11.0)],
        live_px=12.0,
        rth_open=True,
        symbol="AAPL",
    )
    assert prev == 11.0
    assert "_yf_prior_close" not in md._session_prior_close.__code__.co_names


def test_yahoo_chart_quote_skips_yfinance(monkeypatch):
    monkeypatch.setattr(md, "_us_now_et", lambda: NOW)
    monkeypatch.setattr(md, "_spark_bars", lambda _s: [])
    monkeypatch.setattr(md, "_nasdaq_daily_bars", lambda _s: [])

    def boom(*_a, **_k):
        raise AssertionError("yfinance must not run in _yahoo_chart_quote")

    monkeypatch.setattr(md, "_yf_prior_close", boom)
    assert "_yf_prior_close" not in md._yahoo_chart_quote.__code__.co_names

    class FakeResp:
        status_code = 200

        def json(self):
            return {
                "chart": {
                    "result": [{
                        "meta": {
                            "regularMarketPrice": 102.5,
                            "marketState": "REGULAR",
                        },
                        "timestamp": [
                            _ts("2026-09-04 16:00:00"),
                            _ts("2026-09-07 16:00:00"),
                            _ts("2026-09-08 16:00:00"),
                        ],
                        "indicators": {
                            "quote": [{"close": [100.0, 101.0, 102.0]}],
                        },
                    }],
                },
            }

    import types
    fake_req = types.ModuleType("requests")
    fake_req.get = lambda *_a, **_k: FakeResp()
    monkeypatch.setitem(sys.modules, "requests", fake_req)

    row = md._yahoo_chart_quote("AAPL")
    assert row is not None
    assert row["price"] == 102.5
    assert row["prev_close"] == 101.0
    assert row["pct_change"] is not None
    assert abs(row["pct_change"] - ((102.5 - 101.0) / 101.0 * 100.0)) < 1e-6


def _fn_src(name: str) -> str:
    text = (ROOT / "api" / "server.py").read_text()
    start = text.index(f"def {name}")
    nxt = text.find("\ndef ", start + 1)
    return text[start:nxt]


def test_batch_quotes_fast_uses_store_not_null():
    """Yahoo miss → last-close store; never emit {price: None}."""
    body = _fn_src("_batch_quotes_fast")
    assert "null_row" not in body
    assert "_db_quotes" in body
    assert "store-fresh" in body
    assert 'result[sym] = dict(' not in body


def test_watchlist_get_never_stamps_null_over_last_close():
    body = _fn_src("watchlist_get")
    assert 'q.get("price") is not None or tk not in quotes' not in body
    assert "4 * 86400" in body
    assert "last-close" in body.lower() or "still_blank" in body


def test_watchlist_ytd_runs_before_yahoo():
    """YTD must not wait on leftover quote budget (SUP_20260908_ad9c15d1)."""
    body = _fn_src("watchlist_get")
    ytd = body.find("_watchlist_fill_ytd")
    yahoo = body.find("_batch_quotes_fast")
    assert ytd != -1 and yahoo != -1
    assert ytd < yahoo
    sql = _fn_src("_watchlist_ytd_pcts")
    assert "upper(p.symbol)" not in sql


def test_watchlist_apply_ytd_stamps_keys():
    ns: dict = {}
    exec(_fn_src("_ytd_entry") + "\n" + _fn_src("_watchlist_apply_ytd"), ns)
    quotes: dict = {"AAPL": {"price": 188.0}}
    n = ns["_watchlist_apply_ytd"](
        ["AAPL", "CBRS"],
        quotes,
        {
            "AAPL": {"ytd": 12.5, "status": "ok"},
            "CBRS": {"ytd": 40.0, "status": "ipo", "since": "2026-03-01"},
        },
    )
    assert n == 2
    assert quotes["AAPL"]["ytd"] == 12.5
    assert quotes["AAPL"]["ytd_status"] == "ok"
    assert quotes["CBRS"]["ytd"] == 40.0
    assert quotes["CBRS"]["ytd_label"] == "IPO"


def test_watchlist_set_price_keeps_ytd():
    ns: dict = {}
    exec(_fn_src("_watchlist_set_price"), ns)
    quotes = {"AAPL": {"ytd": 12.5, "ytd_status": "ok", "ytd_pct": 12.5}}
    ns["_watchlist_set_price"](quotes, "AAPL", 188.4, pct=0.5, as_of="2026-09-08")
    assert quotes["AAPL"]["price"] == 188.4
    assert quotes["AAPL"]["pct"] == 0.5
    assert quotes["AAPL"]["ytd"] == 12.5
    assert quotes["AAPL"]["ytd_status"] == "ok"


def test_watchlist_yahoo_does_not_replace_quote_row():
    body = _fn_src("watchlist_get")
    assert "_watchlist_set_price" in body
    assert 'quotes[tk] = {\n                            "price": q.get("price")' not in body
