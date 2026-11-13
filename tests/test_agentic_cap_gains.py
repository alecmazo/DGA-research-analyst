"""Desk Agentic Analyst must weigh capital gains on rebalance advice."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_agentic_system_requires_capital_gains_math():
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    system = src.split("_AGENTIC_SYSTEM_DEFAULT = (", 1)[1].split("\n)\n", 1)[0]
    assert "CAPITAL GAINS TAX" in system
    assert "You MUST take capital gains taxes into consideration" in system
    assert "after-tax" in system.lower() or "AFTER tax" in system
    assert "early next calendar year" in system
    assert "Tax-advantaged accounts" in system
    assert 'WEB_BUILD_VERSION = "ui826-20261113-cap-gains"' in src
