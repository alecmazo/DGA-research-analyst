"""Portfolio Roundup keeps heaviest weights and drops anything under 1%."""
from podcast_engine import (
    FORMAT_SECTIONS,
    ROUNDUP_WEIGHT_FLOOR_PCT,
    _portfolio_roundup_budget,
    _prepare_roundup_book,
    _system_prompt,
)


def test_floor_is_one_percent_and_order_is_heaviest_first():
    assert ROUNDUP_WEIGHT_FLOOR_PCT == 1.0
    tickers, rows, dropped, sized = _prepare_roundup_book(
        ["DUST", "MID", "HEAVY", "TINY"],
        [
            {"ticker": "dust", "weight_pct": 0.2},
            {"ticker": "mid", "weight_pct": 4.5},
            {"ticker": "heavy", "weight_pct": 18.0},
            {"ticker": "tiny", "weight_pct": 0.0},
            {"ticker": "edge", "weight_pct": 1.0},
            {"ticker": "cash", "weight_pct": 0.4},
        ],
    )
    assert sized is True
    assert tickers == ["HEAVY", "MID", "EDGE"]
    assert [r["weight_pct"] for r in rows] == [18.0, 4.5, 1.0]
    assert dropped == ["DUST", "TINY", "CASH"]


def test_unsized_book_keeps_caller_order():
    tickers, rows, dropped, sized = _prepare_roundup_book(
        ["MSFT", "AAPL", "NVDA", "AMZN", "GOOG"],
        [{"ticker": t} for t in ["MSFT", "AAPL", "NVDA", "AMZN", "GOOG"]],
    )
    assert sized is False
    assert dropped == []
    assert tickers == ["MSFT", "AAPL", "NVDA", "AMZN", "GOOG"]
    assert all("weight_pct" not in r for r in rows)


def test_prompt_asks_for_rebalance_rates_politics_and_bans_metaphor():
    sections = FORMAT_SECTIONS["portfolio_roundup"]
    assert sections[:3] == ["cold_open", "portfolio_snapshot", "position_walk"]
    assert "rates" in sections and "politics" in sections
    assert "rebalance" in sections and "twelve_month" in sections
    assert "bolt_ons" not in sections
    assert "wipeout_scenarios" not in sections
    text = _system_prompt("portfolio_roundup")
    assert "under 1%" in text
    assert "heaviest weight first" in text
    assert "No metaphors" in text
    assert "AI capex" in text  # named only as a phrase the script must not use
    assert "MUST cover EVERY" not in text
    budget = _portfolio_roundup_budget(30)
    assert budget["target"] <= 2400
