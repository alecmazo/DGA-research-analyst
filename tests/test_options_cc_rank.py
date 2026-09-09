"""Covered calls: held first, then GS/MS overwrite risk/reward — not share count."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import options_engine as opt  # noqa: E402


def _strike(*, dte, static, delta, iv, otm, oi, prem=1.5):
    return {
        "strategy": "covered_call",
        "dte": dte,
        "static_return": static,
        "static_return_annualized": static * (365.0 / dte),
        "assignment_prob": delta,
        "iv": iv,
        "pct_otm": otm,
        "open_interest": oi,
        "premium": prem,
        "if_called_return": static + otm,
    }


def test_rich_monthly_beats_annualized_weekly_junk():
    hv = 0.32
    great = _strike(dte=30, static=0.024, delta=0.22, iv=0.45, otm=0.08, oi=2000)
    junk = _strike(dte=7, static=0.004, delta=0.08, iv=0.28, otm=0.18, oi=40)
    # Junk weekly annualizes higher (0.004*365/7 ≈ 21% vs 0.024*365/30 ≈ 29%
    # is actually close; make weekly look better on raw ann):
    junk["static_return_annualized"] = 0.80  # 80% "ann" from a 7-day 40¢
    sg = opt.overwrite_score(great, hv=hv)
    sj = opt.overwrite_score(junk, hv=hv)
    assert sg > sj, (sg, sj)
    assert sg >= 70
    assert sj < sg


def test_cheap_vol_scores_worse_than_rich_vol():
    rich = _strike(dte=30, static=0.022, delta=0.22, iv=0.48, otm=0.07, oi=800)
    cheap = _strike(dte=30, static=0.022, delta=0.22, iv=0.22, otm=0.07, oi=800)
    assert opt.overwrite_score(rich, hv=0.32) > opt.overwrite_score(cheap, hv=0.32)


def test_delta_sweet_spot_beats_pin_or_stock_sale():
    sweet = _strike(dte=28, static=0.020, delta=0.22, iv=0.40, otm=0.07, oi=500)
    pin = _strike(dte=28, static=0.020, delta=0.08, iv=0.40, otm=0.16, oi=500)
    sale = _strike(dte=28, static=0.020, delta=0.36, iv=0.40, otm=0.02, oi=500)
    ss = opt.overwrite_score(sweet, hv=0.32)
    assert ss > opt.overwrite_score(pin, hv=0.32)
    assert ss > opt.overwrite_score(sale, hv=0.32)


def test_rank_held_uncovered_first_then_score_not_shares():
    # Huge book, junk setup
    big_junk = {
        "ticker": "LCID",
        "held": True,
        "fully_covered": False,
        "shares_held": 154000,
        "iv_hv_ratio": 0.9,
        "realized_vol": 0.50,
        "covered_calls": {
            "weekly": _strike(dte=7, static=0.003, delta=0.07, iv=0.40, otm=0.22, oi=30),
        },
    }
    # Small book, professional overwrite
    small_great = {
        "ticker": "WFC",
        "held": True,
        "fully_covered": False,
        "shares_held": 100,
        "iv_hv_ratio": 1.35,
        "realized_vol": 0.28,
        "covered_calls": {
            "monthly": _strike(dte=32, static=0.025, delta=0.21, iv=0.40, otm=0.07, oi=4000),
        },
    }
    covered_ok = {
        "ticker": "CMCSA",
        "held": True,
        "fully_covered": True,
        "shares_held": 11250,
        "iv_hv_ratio": 1.4,
        "realized_vol": 0.25,
        "covered_calls": {
            "monthly": _strike(dte=30, static=0.023, delta=0.20, iv=0.36, otm=0.08, oi=2000),
        },
    }
    not_held = {
        "ticker": "NVDA",
        "held": False,
        "fully_covered": False,
        "shares_held": 0,
        "iv_hv_ratio": 1.6,
        "realized_vol": 0.40,
        "covered_calls": {
            "monthly": _strike(dte=30, static=0.030, delta=0.22, iv=0.55, otm=0.08, oi=9000),
        },
    }
    ranked = opt.rank_covered_calls([not_held, covered_ok, big_junk, small_great])
    tickers = [r["ticker"] for r in ranked]
    assert tickers[0] == "WFC", tickers  # held uncovered, better setup
    assert tickers[1] == "LCID", tickers  # held uncovered, worse setup, more shares
    assert tickers[2] == "CMCSA", tickers  # held but already covered
    assert tickers[3] == "NVDA", tickers  # not held, even if best premium
    assert ranked[0]["setup_score"] > ranked[1]["setup_score"]


def test_best_in_picks_score_not_weekly_ann():
    spot = 100.0
    # Far OTM weekly: tiny premium, huge annualized if someone used raw ann
    weekly_junk = {
        "strike": 118, "bid": 0.40, "impliedVolatility": 0.28,
        "openInterest": 40, "delta": 0.08, "option_type": "call",
    }
    monthly_setup = {
        "strike": 108, "bid": 2.40, "impliedVolatility": 0.45,
        "openInterest": 2000, "delta": 0.22, "option_type": "call",
    }
    hv = 0.32
    iv_hv = 1.4

    def scorefn(c):
        return opt.overwrite_score(c, hv=hv, iv_hv_fallback=iv_hv)

    best = opt._best_in(
        [weekly_junk, monthly_setup], opt._eval_call, "static_return_annualized",
        spot, 30, "2026-10-16", 0.30, 0.043, 25, scorefn=scorefn,
    )
    assert best is not None
    assert best["strike"] == 108.0
    assert best["setup_score"] > 0


def test_client_does_not_sort_cc_by_shares():
    src = (ROOT / "web/gp-app/src/pages/OptionsPage.tsx").read_text()
    assert "shares_held" in src  # still displayed
    fn = src.split("function sortHeldFirst", 1)[1].split("\n}", 1)[0]
    assert "setup_score" in fn
    assert "b.shares_held" not in fn
    assert "a.shares_held" not in fn


def test_server_uses_engine_rank_for_cc():
    text = (ROOT / "api" / "server.py").read_text()
    start = text.index("def _run_options_scan")
    nxt = text.find("\ndef ", start + 1)
    src = text[start:nxt]
    assert "rank_covered_calls" in src
    assert 'r, "covered_calls", "static_return_annualized"' not in src
