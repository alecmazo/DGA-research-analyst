"""Watchlist earnings chips. No live Nasdaq calls."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import market_data as md


def test_earnings_day_stays_on_pacific_after_utc_midnight():
    # 7pm Pacific on Nov 9 is already Nov 10 in UTC. The chip day is still Nov 9.
    now = datetime(2026, 11, 10, 3, 0, tzinfo=ZoneInfo("UTC"))
    assert md.earnings_as_of(now) == date(2026, 11, 9)


def test_reported_print_says_beat_not_a_countdown():
    assert md.earnings_chip_label(0, None, None) == "TODAY"
    assert md.earnings_chip_label(3, None, None) == "3d"
    assert md.earnings_chip_label(-4, "beat", 1.55) == "BEAT"
    assert md.earnings_chip_label(-1, "miss", 0.2) == "MISS"
    assert md.earnings_chip_label(-2, None, 1.0) == "RPT"
    assert md.earnings_chip_label(-4, None, None) == "4d ago"


def test_thursday_report_is_still_on_mondays_list(monkeypatch):
    """HHH reported Nov 5. On Monday Nov 9 a two-day lookback had already dropped it."""
    monday = date(2026, 11, 9)

    def fake_day(day_iso: str):
        if day_iso == "2026-11-05":
            return [{
                "symbol": "HHH",
                "name": "Howard Hughes Holdings Inc.",
                "time": "time-not-supplied",
                "fiscal_quarter": "Sep/2026",
                "eps_forecast": "$1.03",
                "eps_actual": 1.55,
                "surprise_pct": 50.49,
                "beat": "beat",
                "date": "2026-11-05",
            }]
        return []

    monkeypatch.setattr(md, "nasdaq_earnings_for_day", fake_day)
    gone = md.earnings_upcoming(["HHH"], horizon_days=14, include_past_days=2, today=monday)
    assert "HHH" not in gone
    kept = md.earnings_upcoming(["HHH"], horizon_days=14, include_past_days=7, today=monday)
    assert kept["HHH"]["date"] == "2026-11-05"
    assert kept["HHH"]["days_until"] == -4
    assert kept["HHH"]["beat"] == "beat"
    assert md.earnings_chip_label(-4, kept["HHH"]["beat"], kept["HHH"]["eps_actual"]) == "BEAT"


def test_same_day_headline_turns_a_scheduled_chip_into_beat_or_miss():
    """CEG was still 'today' and IBRX was still '1d' after the release.
    Nasdaq had no EPS yet. The headline is the beat or the miss."""
    from datetime import datetime
    today = date(2026, 11, 9)
    morning = datetime(2026, 11, 9, 14, 31, tzinfo=ZoneInfo("UTC"))
    ceg = [{
        "title": "CEG Q3 Earnings Beat on Calpine, Strong Commercial Performance",
        "published": morning,
    }, {
        "title": "Constellation Energy Shares Rise Over 4% as Q3 Earnings Beat Estimates",
        "published": morning,
    }]
    ibrx = [{
        "title": "ImmunityBio (IBRX) Reports Q3 Loss, Misses Revenue Estimates",
        "published": datetime(2026, 11, 9, 12, 50, tzinfo=ZoneInfo("UTC")),
    }]
    old = [{
        "title": "Constellation Energy Q2 Earnings Beat Estimates",
        "published": datetime(2026, 8, 6, 12, 0, tzinfo=ZoneInfo("UTC")),
    }]
    assert md.headline_print_verdict(ceg, today) == "beat"
    assert md.headline_print_verdict(ibrx, today) == "miss"
    assert md.headline_print_verdict(old, today) is None
    scheduled = {"date": "2026-11-10", "eps_actual": None, "beat": None}
    stamped = md.apply_headline_print(scheduled, today, "miss")
    assert stamped["date"] == "2026-11-09"
    assert stamped["beat"] == "miss"
    assert md.earnings_chip_label(0, stamped["beat"], None, reported=True) == "MISS"
    assert md.earnings_chip_label(0, "beat", None, reported=True) == "BEAT"
