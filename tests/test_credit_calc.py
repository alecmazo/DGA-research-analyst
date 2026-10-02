"""Credit math. No network."""

from datetime import date
from decimal import Decimal

from credit.calc import (
    coverage,
    expected_loss,
    g_spread_bp,
    hazard_pd,
    interpolate_treasury,
    leverage,
    runway_year,
    verdict,
    waterfall,
    years_to_maturity,
    yield_to_worst,
)

D = Decimal


def test_par_bond_yield_equals_coupon():
    settlement = date(2026, 10, 15)
    result = yield_to_worst(
        clean=D("100"), coupon=D("0.06"), maturity=date(2028, 10, 15),
        settlement=settlement, issue=settlement, call_status="not_public",
    )
    assert abs(result["ytm"] - D("0.06")) < D("0.0002")
    assert result["ytw"] == result["ytm"]
    assert "not public" in result["ytw_note"]
    assert result["accrued"] == 0


def test_discount_and_premium():
    settlement = date(2026, 10, 15)
    maturity = date(2028, 10, 15)
    discount = yield_to_worst(clean=D("90"), coupon=D("0.06"), maturity=maturity, settlement=settlement, issue=settlement)
    premium = yield_to_worst(clean=D("110"), coupon=D("0.06"), maturity=maturity, settlement=settlement, issue=settlement)
    assert discount["ytm"] > D("0.06")
    assert premium["ytm"] < D("0.06")


def test_callable_yield_is_the_minimum():
    settlement = date(2026, 10, 15)
    called = yield_to_worst(
        clean=D("110"), coupon=D("0.06"), maturity=date(2028, 10, 15),
        settlement=settlement, issue=settlement, call_status="ok",
        call_schedule=[{"date": date(2027, 4, 15), "price": "100"}],
    )
    assert called["ytw"] < called["ytm"]
    assert called["ytw_note"] == ""


def test_treasury_interpolation_is_linear_and_flat_after_30y():
    curve = {"5Y": D("5.01"), "7Y": D("5.12"), "30Y": D("5.61")}
    mid = interpolate_treasury(curve, D("6"))
    assert abs(mid - D("5.065")) < D("0.0001")
    assert interpolate_treasury(curve, D("40")) == D("5.61")


def test_g_spread_and_hazard():
    spread = g_spread_bp(D("0.0705"), D("5.01"))
    assert spread == D("204.00")
    hazard = hazard_pd(D("0.02"), D("0.40"), [D("1")])
    assert abs(hazard["lambda"] - D("0.02") / D("0.6")) < D("0.0001")
    assert hazard["pd"]["1"] > 0
    blocked = hazard_pd(D("0.02"), D("0.99"), [D("1")])
    assert blocked["recovery"] == D("0.95")


def test_waterfall_pays_senior_first_and_splits_pari():
    result = waterfall(
        stressed_ebitda=D("1000"), multiple=D("5"), admin_pct=D("0.05"),
        draw_revolver=False,
        classes=[
            {"id": "1l", "name": "1L", "priority_rank": 1, "claim": "4000", "accrued": "0"},
            {"id": "2l", "name": "2L", "priority_rank": 2, "claim": "2000", "accrued": "0"},
        ],
    )
    assert result["distributable"] == D("4750.00")
    assert result["rows"][0]["recovery"] == D("1.0000")
    assert result["rows"][1]["paid"] == D("750.00")


def test_waterfall_pari_passu_and_revolver_draw():
    result = waterfall(
        stressed_ebitda=D("100"), multiple=D("4"), admin_pct=D("0"),
        draw_revolver=True,
        classes=[
            {"id": "a", "priority_rank": 1, "claim": "100", "accrued": "0"},
            {"id": "b", "priority_rank": 1, "claim": "100", "accrued": "0", "undrawn": "100"},
        ],
    )
    # 400 distributable, claims 100 and 200. Both paid in full.
    assert result["rows"][0]["paid"] == D("100.00")
    assert result["rows"][1]["claim"] == D("200.00")
    assert result["rows"][1]["recovery"] == D("1.0000")
    short = waterfall(
        stressed_ebitda=D("150"), multiple=D("1"), admin_pct=D("0"),
        draw_revolver=False,
        classes=[
            {"id": "a", "priority_rank": 1, "claim": "100", "accrued": "0"},
            {"id": "b", "priority_rank": 1, "claim": "200", "accrued": "0"},
        ],
    )
    assert short["rows"][0]["paid"] == D("50.00")
    assert short["rows"][1]["paid"] == D("100.00")


def test_leverage_with_and_without_synergies_and_negative_ebitda():
    gross_with = leverage(D("82435"), D("18000"))
    gross_without = leverage(D("82435"), D("12000"))
    net_with = leverage(D("82435"), D("18000"), D("7803"))
    assert gross_with == D("4.58")
    assert gross_without == D("6.87")
    assert net_with < gross_with
    assert leverage(D("100"), D("0")) == "n/m"
    assert leverage(D("100"), D("-5")) == "n/m"
    assert coverage(D("10"), D("0")) == "n/m"


def test_runway_year():
    assert runway_year(
        cash=D("100"), undrawn_revolver=D("50"), fcf=D("-40"),
        maturities={2026: D("80"), 2027: D("100")}, start_year=2026,
    ) == "2027"
    assert runway_year(
        cash=D("500"), undrawn_revolver=D("0"), fcf=D("10"),
        maturities={}, start_year=2026, horizon=3,
    ) == "beyond horizon"


def test_verdict_thresholds():
    buy = verdict(spread=D("0.05"), expected_losses=[D("0.01"), D("0.02"), D("0.03")])
    watch = verdict(spread=D("0.03"), expected_losses=[D("0.01"), D("0.02"), D("0.03")])
    avoid = verdict(spread=D("0.01"), expected_losses=[D("0.01"), D("0.02"), D("0.03")])
    short = verdict(spread=D("0.20"), expected_losses=[D("0.01")], runway_months=12)
    assert buy["call"] == "Buy"
    assert watch["call"] == "Watch"
    assert avoid["call"] == "Avoid"
    assert short["call"] == "Avoid"
    assert expected_loss(D("0.02"), D("0.40")) == D("0.012000")


def test_years_between_settlement_and_maturity():
    assert years_to_maturity(date(2026, 10, 15), date(2031, 10, 15)) == D("5.0000")
