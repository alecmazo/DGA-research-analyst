"""Hot-path load times: earnings N+1, SEC 8-K, financials universe HTTP.

These assertions lock the fixes that were stalling the single uvicorn worker
(p95 ~15s on Railway). No live Nasdaq/SEC in unit tests.
"""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import market_data as md


def test_nasdaq_earnings_timeouts_are_short():
    src = Path(md.__file__).read_text()
    assert "timeout=3.5" in src
    assert "timeout=12" not in src.split("def nasdaq_earnings_surprise")[1][:800]


def test_earnings_card_cache_skips_second_network(monkeypatch):
    md._EARNINGS_CARD_CACHE.clear()
    calls = {"n": 0}

    def fake_upcoming(*_a, **_k):
        calls["n"] += 1
        return {
            "AAPL": {
                "date": "2026-09-16",
                "days_until": 3,
                "time": "time-pre-market",
                "fiscal_quarter": "Sep 2026",
                "eps_forecast": "1.50",
                "name": "Apple",
            }
        }

    def boom(*_a, **_k):
        raise AssertionError("must not hit yfinance on a cache hit")

    monkeypatch.setattr(md, "earnings_upcoming", fake_upcoming)
    monkeypatch.setattr(md, "nasdaq_earnings_surprise", lambda _s: {
        "history": [], "latest": None, "source": "nasdaq",
    })
    monkeypatch.setattr(md, "yfinance_earnings_surprise", lambda _s: {
        "history": [], "latest": None, "source": "yfinance",
    })
    monkeypatch.setattr(md, "yfinance_earnings_calendar_context", lambda _s: {})
    monkeypatch.setattr(md, "yfinance_quarterly_actuals", boom)
    monkeypatch.setattr(md, "sec_8k_earnings_release_actuals", boom)
    monkeypatch.setattr(md, "company_ir_links", lambda _s: {})
    a = md.earnings_card("AAPL", horizon_days=14, include_past_days=14)
    b = md.earnings_card("AAPL", horizon_days=14, include_past_days=14)
    assert a.get("ok") is True
    assert a.get("ticker") == "AAPL"
    assert calls["n"] == 1
    assert b.get("ticker") == "AAPL"


def test_earnings_batch_route_registered_before_ticker():
    src = Path(ROOT / "api" / "server.py").read_text()
    i_batch = src.find('@app.get("/api/earnings/batch")')
    i_one = src.find('@app.get("/api/earnings/{ticker}")')
    assert i_batch > 0 and i_one > 0
    assert i_batch < i_one
    assert "def earnings_batch(" in src
    assert "_EARNINGS_INFLIGHT" in src
    assert "batch_quotes(tk)" not in src.split("def _earnings_attach_extras")[1][:2500]


def test_financials_hot_path_uses_cache_not_live_http():
    body = Path(ROOT / "api" / "domains" / "_financials_body.py").read_text()
    assert "_FIN_DASH_CACHE" in body
    assert "_FIN_8K_CACHE" in body
    assert "timeout=2.5" in body.split("def _fin_recent_earnings_8k")[1][:1200]
    assert "timeout=25" not in body.split("def _fin_recent_earnings_8k")[1][:1200]
    # GET /universes must not block on a live us_listed HTTP fetch
    uni = body.split("def financials_universes")[1].split("def financials_settings_get")[0]
    assert "_FIN_UNIVERSE_CACHE.get" in uni
    assert "_fin_universe_rows(key)" not in uni.split("def _warm_universes")[0]


def test_mobile_earnings_strip_uses_batch():
    home = Path(ROOT / "mobile" / "src" / "screens" / "HomeScreen.js").read_text()
    client = Path(ROOT / "mobile" / "src" / "api" / "client.js").read_text()
    assert "getEarningsBatch" in client
    assert "api.getEarningsBatch" in home
    assert "tickers.map(async (tk)" not in home
    assert "api.getEarnings(tk)" not in home
