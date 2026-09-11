"""8-K exhibit 99 revenue parser: company total, not a segment line.

SUP_20260911_1d199fdf: ORCL card showed Actual Revenue $1.40B (Services)
vs SEC total $19.3B and Street ~$21B.
"""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from market_data import (  # noqa: E402
    _extract_revenue_from_earnings_text,
    _revenue_plausible_vs_estimate,
    _score_earnings_revenue_hit,
)


ORCL_EX99 = """
Oracle Announces Q1 Results Driven by Triple Digit Growth in Cloud Infrastructure Revenues
Record Q1 Total Revenues up 30% in USD and constant currency to $19.3 billion.
Record Q1 Total Cloud Revenues up 62% in USD up 61% in constant currency to $11.6 billion.
Q1 Cloud Infra (IaaS) Revenue up 121% in USD to $7.4 billion.
Oracle Corporation today announced Q1 FY27 results with strong revenue growth.
Total quarterly revenues increased 30% to $19.3 billion, reflecting strong execution.
Cloud revenues (IaaS + SaaS) increased 62% to $11.6 billion.
Software revenues were down 3% to $5.5 billion.
Services revenues were $1.4 billion, up 5%, and Hardware revenues were $0.8 billion, up 15%.
"""

CMI_NET_SALES = """
Cummins Inc. today reported second quarter results.
Net sales of $418 million increased 8% from last year.
"""


def test_orcl_picks_total_not_services():
    out = _extract_revenue_from_earnings_text(ORCL_EX99)
    assert out.get("revenue_actual") == 19_300_000_000.0
    snip = (out.get("snippet") or "").lower()
    assert "1.4" not in snip
    assert "19.3" in snip or "total" in snip


def test_cmi_net_sales_still_wins():
    out = _extract_revenue_from_earnings_text(CMI_NET_SALES)
    assert out.get("revenue_actual") == 418_000_000.0


def test_score_prefers_total_over_services():
    total = _score_earnings_revenue_hit(
        19_300_000_000.0,
        "Total quarterly revenues increased 30% to $19.3 billion",
    )
    svc = _score_earnings_revenue_hit(
        1_400_000_000.0,
        "Services revenues were $1.4 billion, up 5%",
    )
    assert total > svc


def test_plausible_vs_street_rejects_segment_scale():
    assert _revenue_plausible_vs_estimate(19.3e9, 21.24e9) is True
    assert _revenue_plausible_vs_estimate(1.4e9, 21.24e9) is False
    assert _revenue_plausible_vs_estimate(None, 21e9) is True
