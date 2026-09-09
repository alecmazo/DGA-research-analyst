"""Options wheel 'held' must match the live Positions book, not demo lots."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _fn_src(name: str) -> str:
    text = (ROOT / "api" / "server.py").read_text()
    start = text.index(f"def {name}")
    nxt = text.find("\ndef ", start + 1)
    return text[start:nxt]


def test_options_live_book_excludes_demo_lane():
    src = _fn_src("_options_live_book_sql")
    assert "_sql_demo_short" in src
    assert "managed_account" in src
    live = _fn_src("_held_share_counts")
    assert "JOIN funds" in live
    assert "_options_live_book_sql" in live
    tick = _fn_src("_held_tickers")
    assert "JOIN funds" in tick


def test_scan_worker_held_is_qty_not_watchlist():
    src = _fn_src("_run_options_scan")
    assert 'r["held"] = qty > 0' in src
    assert "share_counts.get(tk)" in src
    assert "tk in held" not in src.split('r["held"]')[-1][:80]