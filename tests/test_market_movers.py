"""Unit tests for Desk Top Movers ranking ($1B+ equities, |day %|)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import market_data as md


def _row(tk, pct, mcap, qtype="EQUITY", name=""):
    return {
        "ticker": tk,
        "pct_change": pct,
        "market_cap": mcap,
        "quote_type": qtype,
        "name": name or tk,
        "price": 10.0,
    }


def test_top_10_by_abs_pct_either_direction():
    rows = [
        _row("UP1", 12.0, 2e9),
        _row("DN1", -11.0, 3e9),
        _row("UP2", 9.0, 5e9),
        _row("FLAT", 0.1, 8e9),
        _row("DN2", -8.5, 4e9),
        _row("UP3", 7.0, 1.5e9),
        _row("DN3", -6.0, 2e9),
        _row("UP4", 5.0, 10e9),
        _row("DN4", -4.0, 2e9),
        _row("UP5", 3.0, 2e9),
        _row("TINY", 20.0, 2e9),
        _row("MID", 2.0, 2e9),
    ]
    out = md.rank_session_movers(rows, limit=10, min_market_cap=1e9)
    assert len(out) == 10
    tickers = [r["ticker"] for r in out]
    assert tickers[0] == "TINY"          # +20
    assert tickers[1] == "UP1"           # +12
    assert tickers[2] == "DN1"           # -11
    assert "MID" not in tickers          # 12th-largest abs
    assert "FLAT" not in tickers         # smallest abs among the 12


def test_drops_sub_billion_unknown_cap_and_etfs():
    rows = [
        _row("BIG", 10.0, 2e9),
        _row("SMALL", 40.0, 5e8),          # < $1B
        _row("NOCAP", 30.0, None),         # unknown cap
        _row("SOXL", 25.0, 12e9, "ETF"),
        _row("BTC", 50.0, 1e12, "CRYPTOCURRENCY"),
        _row("BTC-USD", 15.0, 2e9),
    ]
    out = md.rank_session_movers(rows, limit=10, min_market_cap=1e9)
    assert [r["ticker"] for r in out] == ["BIG"]


def test_limit_none_returns_all_ranked():
    rows = [_row(f"T{i}", i + 1.0, 2e9) for i in range(5)]
    out = md.rank_session_movers(rows, limit=None, min_market_cap=1e9)
    assert len(out) == 5
    assert out[0]["ticker"] == "T4"


def test_dedup_keeps_larger_abs_move():
    rows = [
        _row("AAA", 3.0, 2e9),
        _row("AAA", -8.0, 2e9),
        _row("BBB", 4.0, 2e9),
    ]
    out = md.rank_session_movers(rows, limit=10)
    assert [r["ticker"] for r in out] == ["AAA", "BBB"]
    assert out[0]["pct_change"] == -8.0
