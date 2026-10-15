"""8-K exhibit 99 revenue parser: company total, not a segment line.

SUP_20260911_1d199fdf: ORCL card showed Actual Revenue $1.40B (Services)
vs SEC total $19.3B and Street ~$21B.
"""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import market_data as md  # noqa: E402
from market_data import (  # noqa: E402
    _extract_eps_from_earnings_text,
    _extract_revenue_from_earnings_text,
    _revenue_plausible_vs_estimate,
    _score_earnings_eps_hit,
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
    # TSM local-currency total vs Street USD
    assert _revenue_plausible_vs_estimate(1_494.24e9, 45.62e9) is False
    assert _revenue_plausible_vs_estimate(46.72e9, 45.62e9) is True
    assert _revenue_plausible_vs_estimate(4.60, 4.45) is True
    assert _revenue_plausible_vs_estimate(29.43, 4.45) is False


TSM_EX99 = """
TSMC Reports Third Quarter EPS of NT$29.43
HSINCHU, Taiwan, R.O.C., Oct. 15, 2026 -- TSMC (TWSE: 2330, NYSE: TSM) today
announced consolidated revenue of NT$1,494.24 billion, net income of NT$763.06
billion, and diluted earnings per share of NT$29.43 (US$4.60 per ADR unit) for
the third quarter ended September 30, 2026.
In US dollars, third quarter revenue was $46.72 billion, which increased 41.2%
year-over-year and increased 16.2% from the previous quarter.
Revenue is expected to be between US$52.3 billion and US$54.3 billion.
"""

TSM_EX99_HTML = """
<html><body>
<div>TSMC Reports Third Quarter EPS of NT$29.43</div>
<font>TSMC today announced consolidated revenue of NT$1,494.24 billion, net
income of NT$763.06 billion, and diluted earnings per share of NT$29.43
(US$4.60 per ADR unit) for the third quarter ended September 30, 2026.</font>
<font>In US dollars, third quarter revenue was $46.72 billion, which increased
41.2% year-over-year.</font>
</body></html>
"""


def test_tsm_picks_usd_revenue_not_ntd():
    out = _extract_revenue_from_earnings_text(TSM_EX99)
    assert out.get("revenue_actual") == 46_720_000_000.0
    snip = (out.get("snippet") or "").lower()
    assert "46.72" in snip
    assert "1,494" not in snip and "1494" not in snip.replace(",", "")


def test_tsm_html_exhibit_same_usd_print():
    out = _extract_revenue_from_earnings_text(TSM_EX99_HTML)
    assert out.get("revenue_actual") == 46_720_000_000.0
    eps = _extract_eps_from_earnings_text(TSM_EX99_HTML)
    assert eps.get("eps_actual") == 4.60


def test_tsm_picks_adr_eps_not_ntd():
    out = _extract_eps_from_earnings_text(TSM_EX99)
    assert out.get("eps_actual") == 4.60
    snip = (out.get("snippet") or "").lower()
    assert "4.60" in snip
    assert "adr" in snip or "us$" in snip


def test_score_prefers_usd_over_ntd_revenue():
    usd = _score_earnings_revenue_hit(
        46_720_000_000.0,
        "In US dollars, third quarter revenue was $46.72 billion",
    )
    ntd = _score_earnings_revenue_hit(
        1_494_240_000_000.0,
        "announced consolidated revenue of NT$1,494.24 billion",
    )
    assert usd > ntd


def test_score_prefers_adr_eps_over_ntd():
    adr = _score_earnings_eps_hit(4.60, "diluted earnings per share of NT$29.43 (US$4.60 per ADR unit)")
    ntd = _score_earnings_eps_hit(29.43, "diluted earnings per share of NT$29.43")
    assert adr > ntd


def test_headline_eps_per_adr():
    out = _extract_eps_from_earnings_text(
        "TSMC reported earnings of $4.60 per ADR unit, beating $4.45"
    )
    assert out.get("eps_actual") == 4.60


def test_sec_release_accepts_6k_and_extracts_eps():
    src = Path(md.__file__).read_text(encoding="utf-8")
    fn = src.split("def sec_8k_earnings_release_actuals")[1].split(
        "\ndef yfinance_earnings_calendar_context"
    )[0]
    assert '"6-K"' in fn
    assert '"6-K/A"' in fn
    assert "_extract_eps_from_earnings_text" in fn
    assert "is_6k" in fn


def test_earnings_card_fills_tsm_from_6k(monkeypatch):
    md._EARNINGS_CARD_CACHE.clear()
    monkeypatch.setattr(md, "earnings_upcoming", lambda *_a, **_k: {
        "TSM": {
            "date": "2026-10-15",
            "days_until": 0,
            "time": "time-pre-market",
            "fiscal_quarter": "Sep 2026",
            "eps_forecast": "4.45",
            "name": "TSMC",
        }
    })
    monkeypatch.setattr(md, "nasdaq_earnings_surprise", lambda _s: {
        "history": [], "latest": None, "source": "nasdaq",
    })
    monkeypatch.setattr(md, "yfinance_earnings_surprise", lambda _s: {
        "history": [], "latest": None, "source": "yfinance",
    })
    monkeypatch.setattr(md, "yfinance_earnings_calendar_context", lambda _s: {
        "eps_avg": 4.45, "revenue_avg": 45.62e9,
    })
    monkeypatch.setattr(md, "yfinance_quarterly_actuals", lambda *_a, **_k: {})
    monkeypatch.setattr(md, "sec_8k_earnings_release_actuals", lambda *_a, **_k: {
        "eps_actual": 4.60,
        "revenue_actual": 46.72e9,
        "source": "sec_8k_ex99",
        "filed": "2026-10-15",
        "form": "6-K",
        "press_release_url": "https://www.sec.gov/Archives/edgar/data/1046179/x.htm",
    })
    monkeypatch.setattr(md, "company_ir_links", lambda _s: {})
    monkeypatch.setattr(md, "_earnings_report_window_passed", lambda *_a, **_k: True)
    monkeypatch.setattr(md, "_actuals_from_yahoo_headlines", lambda *_a, **_k: {})
    out = md.earnings_card("TSM", horizon_days=5, include_past_days=1)
    assert out.get("ok") is True
    assert out.get("status") == "reported"
    assert out.get("result", {}).get("eps_actual") == 4.60
    assert out.get("result", {}).get("revenue_actual") == 46.72e9
    assert out.get("result", {}).get("beat") == "beat"


def test_pending_sec_runs_before_yahoo_calendar(monkeypatch):
    md._EARNINGS_CARD_CACHE.clear()
    order: list[str] = []

    def cal(_s):
        order.append("cal")
        return {"eps_avg": 4.45, "revenue_avg": 45.62e9}

    def k8(*_a, **_k):
        order.append("k8")
        return {
            "eps_actual": 4.60,
            "revenue_actual": 46.72e9,
            "source": "sec_8k_ex99",
            "filed": "2026-10-15",
            "form": "6-K",
        }

    monkeypatch.setattr(md, "earnings_upcoming", lambda *_a, **_k: {
        "TSM": {
            "date": "2026-10-15",
            "days_until": 0,
            "time": "time-pre-market",
            "fiscal_quarter": "Sep 2026",
            "eps_forecast": "4.45",
            "name": "TSMC",
        }
    })
    monkeypatch.setattr(md, "nasdaq_earnings_surprise", lambda _s: {
        "history": [], "latest": None, "source": "nasdaq",
    })
    monkeypatch.setattr(md, "yfinance_earnings_surprise", lambda _s: {
        "history": [], "latest": None, "source": "yfinance",
    })
    monkeypatch.setattr(md, "yfinance_earnings_calendar_context", cal)
    monkeypatch.setattr(md, "yfinance_quarterly_actuals", lambda *_a, **_k: order.append("stmt") or {})
    monkeypatch.setattr(md, "sec_8k_earnings_release_actuals", k8)
    monkeypatch.setattr(md, "company_ir_links", lambda _s: {})
    monkeypatch.setattr(md, "_earnings_report_window_passed", lambda *_a, **_k: True)
    monkeypatch.setattr(md, "_actuals_from_yahoo_headlines", lambda *_a, **_k: {})
    out = md.earnings_card("TSM", horizon_days=5, include_past_days=1)
    assert order[0] == "k8"
    assert out.get("result", {}).get("eps_actual") == 4.60
    src = Path(md.__file__).read_text(encoding="utf-8")
    fn = src.split("def earnings_card")[1].split("\ndef _fiscal_quarter_labels_match")[0]
    assert "_left() > 0.2" in fn
    assert "_EARNINGS_PENDING_TTL_S" in src
    assert md._EARNINGS_PENDING_TTL_S == 60
