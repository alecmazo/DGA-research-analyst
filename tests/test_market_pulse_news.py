"""Unit tests for Market Pulse headline ranking (newest public item first)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import market_data as md


def test_newest_headline_wins():
    items = [
        {"title": "Old wire", "pub_ts": 1_700_000_000, "publisher": "A"},
        {"title": "Breaking", "pub_ts": 1_800_000_000, "publisher": "B"},
        {"title": "Mid", "pub_ts": 1_750_000_000, "publisher": "C"},
    ]
    out = md.sort_news_newest(items, limit=1)
    assert len(out) == 1
    assert out[0]["title"] == "Breaking"


def test_missing_timestamp_sorts_last():
    items = [
        {"title": "No date"},
        {"title": "Dated", "pub_ts": 1_800_000_000},
        {"title": "Also none", "pub_ts": None},
    ]
    out = md.sort_news_newest(items)
    assert [r["title"] for r in out] == ["Dated", "No date", "Also none"]


def test_drops_blank_titles_and_honors_limit():
    items = [
        {"title": "", "pub_ts": 9},
        {"title": "Keep me", "pub_ts": 8},
        {"title": "Second", "pub_ts": 7},
        {"publisher": "no title", "pub_ts": 10},
    ]
    out = md.sort_news_newest(items, limit=2)
    assert [r["title"] for r in out] == ["Keep me", "Second"]
