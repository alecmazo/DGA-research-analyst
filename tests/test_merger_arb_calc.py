"""Formula tests, including collar edges. No network."""

from merger_arb.calc import (
    annualized,
    downside_return,
    gross_spread,
    implied_probability,
    offer_value,
    recompute,
    upside_return,
)
from merger_arb.fixture import build_fixture
from merger_arb.schema import field_map, sourced


def test_cash_stock_and_mixed_offer_values():
    cash = offer_value(consideration="cash", cash=50, ratio=None, acquirer_price=20)
    assert cash["value"] == 50
    assert cash["walkaway_triggered"] is False
    stock = offer_value(consideration="stock", cash=None, ratio=1.5, acquirer_price=20)
    assert stock["value"] == 30
    mixed = offer_value(consideration="mixed", cash=10, ratio=1.5, acquirer_price=20)
    assert mixed["value"] == 40


def test_fixed_value_collar_inside_and_outside_the_band():
    inside = offer_value(
        consideration="stock", cash=None, ratio=1, acquirer_price=20,
        collar_type="fixed_value", collar_low=18, collar_high=22, collar_value=40,
    )
    assert inside["value"] == 40
    above = offer_value(
        consideration="stock", cash=None, ratio=1, acquirer_price=30,
        collar_type="fixed_value", collar_low=18, collar_high=22, collar_value=40,
    )
    assert above["value"] == 40 / 22 * 30
    below = offer_value(
        consideration="stock", cash=None, ratio=1, acquirer_price=10,
        collar_type="fixed_value", collar_low=18, collar_high=22, collar_value=40,
    )
    assert below["value"] == 40 / 18 * 10


def test_fixed_ratio_collar_pins_the_value_outside_the_band():
    inside = offer_value(
        consideration="stock", cash=None, ratio=2, acquirer_price=20,
        collar_type="fixed_ratio", collar_low=18, collar_high=22,
    )
    assert inside["value"] == 40
    above = offer_value(
        consideration="stock", cash=None, ratio=2, acquirer_price=30,
        collar_type="fixed_ratio", collar_low=18, collar_high=22,
        walkaway_high=28,
    )
    assert above["value"] == 44
    assert above["walkaway_triggered"] is True
    below = offer_value(
        consideration="stock", cash=None, ratio=2, acquirer_price=10,
        collar_type="fixed_ratio", collar_low=18, collar_high=22,
        walkaway_low=12,
    )
    assert below["value"] == 36
    assert below["walkaway_triggered"] is True


def test_election_uses_the_cash_fraction():
    elected = offer_value(
        consideration="election", cash=50, ratio=2, acquirer_price=20, proration_cash=0.25,
    )
    assert elected["value"] == 0.25 * 50 + 0.75 * 40


def test_spread_probability_and_annualized_dividends():
    dollars, pct = gross_spread(50, 47.5)
    assert dollars == 2.5
    assert pct == 2.5 / 47.5
    inclusive = (50 + 0.25 - 47.5) / 47.5
    compound, simple = annualized(inclusive, 0.5)
    assert compound == (1 + inclusive) ** 2 - 1
    assert simple == inclusive / 0.5
    prob, warnings = implied_probability(47.5, 50, 40)
    assert prob == 0.75
    assert warnings == []
    held, warnings = implied_probability(5, 10, 8)
    assert held == 0
    assert warnings
    missing, warnings = implied_probability(10, 12, None)
    assert missing is None
    down_d, down_p = downside_return(40, 47.5)
    assert down_d == 40 - 47.5
    assert down_p == (40 - 47.5) / 47.5
    up_d, up_p = upside_return(50, 47.5)
    assert up_d == 2.5
    assert up_p == 2.5 / 47.5


def test_unverified_price_is_left_out_until_confirmed():
    packet = build_fixture()
    fields = field_map(packet)
    fields["overview.target_price"]["unverified"] = True
    recompute(packet)
    assert field_map(packet)["spread.gross_dollars"]["value"] is None
    assert field_map(packet)["spread.gross_dollars"]["unverified"] is True
    packet["confirmed_ids"] = ["overview.target_price"]
    recompute(packet, confirmed={"overview.target_price"})
    assert field_map(packet)["spread.gross_dollars"]["value"] == 2.5


def test_fixture_derived_numbers_match_the_formulas():
    packet = build_fixture()
    fields = field_map(packet)
    assert fields["overview.offer_value"]["value"] == 50
    assert fields["overview.offer_value"]["source"]["type"] == "derived"
    assert fields["spread.gross_dollars"]["value"] == 2.5
    assert fields["spread.implied_probability"]["value"] == 0.75
    assert fields["spread.sensitivity"]["value"][4]["downside"] == "base"
    assert "downside.break_price" in fields["spread.implied_probability"]["inputs"]
    assert sourced("x", 1, freshness_class="static")["id"] == "x"
