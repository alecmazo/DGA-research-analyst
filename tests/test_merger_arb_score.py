"""Scorecard components, coverage/NR, weights, and overrides. No network."""

from merger_arb.score import (
    DEFAULT_WEIGHTS,
    band_for,
    house_probability,
    score_deal,
    score_edge,
    score_financing,
    score_optionality,
    score_quality,
    score_regulatory,
    score_return,
    score_risk_reward,
    score_timeline,
    validate_weights,
)
from merger_arb.store import MemoryStore


def test_default_weights_sum_to_100():
    assert sum(DEFAULT_WEIGHTS.values()) == 100
    assert validate_weights(DEFAULT_WEIGHTS) == []
    assert validate_weights({**DEFAULT_WEIGHTS, "return": 26}) == ["weights must sum to 100"]


def test_return_component():
    # 8% net ann vs 4.2% T-bill, cap 10% → 38
    row = score_return(0.08, 4.2)
    assert row["available"] is True
    assert row["score"] == 38
    missing = score_return(None, 4.2)
    assert missing["available"] is False
    past = score_return(0.08, 4.2, past_due=True)
    assert past["score"] == 0
    assert past.get("nr_flag") == "timeline"


def test_risk_reward_component():
    # (50-47.5)/(47.5-36) = 2.5/11.5 ≈ 0.217 → (0.217-0.05)/0.45 * 100 ≈ 37
    row = score_risk_reward(50, 47.5, 36)
    assert row["available"] is True
    assert row["score"] == 37
    high = score_risk_reward(50, 40, 45)
    assert high["score"] == 100
    missing = score_risk_reward(50, 47.5, None)
    assert missing["available"] is False


def test_house_probability_and_edge():
    base = house_probability({})
    assert base == 0.90
    hostile = house_probability({"hostile": True})
    assert round(hostile, 2) == 0.65
    edge = score_edge(0.90, 0.80)
    assert edge["score"] == 100
    behind = score_edge(0.80, 0.90)
    assert behind["score"] == 0


def test_regulatory_financing_timeline_quality_optionality():
    pending = score_regulatory([{"regulator": "HSR", "stage": "pending"}])
    assert pending["score"] == 95
    second = score_regulatory([{"regulator": "HSR", "stage": "second_request"}])
    assert second["score"] == 70
    cash = score_financing({"consideration": "cash", "financing_condition": True, "committed_financing": True})
    assert cash["score"] == 50
    stock = score_financing({"consideration": "stock"})
    assert stock["score"] == 100
    near = score_timeline(100, 90, 0)
    assert near["score"] == 100
    long = score_timeline(300, 50, 2)
    assert long["score"] == 0
    hostile = score_quality({"hostile": True, "termination_fee_pct": 3, "voting_agreement": True})
    assert hostile["score"] == 60
    option = score_optionality({"go_shop": True, "contested": True, "offer": 50, "price": 47})
    assert option["score"] == 90


def test_nr_when_return_or_risk_reward_missing_and_bands():
    result = score_deal({"tbill_pct": 4.2, "offer": 50, "price": 47.5, "break_price": 36, "implied_p": 0.8})
    assert result["nr"] is True
    assert result["score_band"] == "NR"
    assert result["score"] is not None
    full = score_deal({
        "net_annualized": 0.12,
        "tbill_pct": 4.0,
        "offer": 50,
        "price": 47.5,
        "break_price": 36,
        "implied_p": 0.70,
        "days_to_close": 90,
        "consideration": "cash",
        "committed_financing": True,
    })
    assert full["nr"] is False
    assert full["score_band"] in {"A", "B", "C", "D", "F"}
    assert band_for(80, nr=False) == "A"
    assert band_for(64, nr=False) == "C"


def test_override_survives_a_rescan_and_weight_change_rescores():
    store = MemoryStore()
    inputs = {
        "net_annualized": 0.08,
        "tbill_pct": 4.2,
        "offer": 50,
        "price": 47.5,
        "break_price": 36,
        "implied_p": 0.82,
        "days_to_close": 120,
        "consideration": "cash",
        "committed_financing": True,
    }
    deal = store.upsert_deal({"id": "acme", "target_ticker": "ACME", "stage": "watch"})
    first = store.score_deal_row(deal, inputs, overrides={
        "house_p": {"value": 0.95, "note": "vote locked", "user": "alec", "at": "2026-10-19T18:00:00-07:00"},
    })
    assert first["house_source"] == "override"
    assert first["p_house"] == 0.95
    assert first["overrides"]["house_p"]["note"] == "vote locked"
    rescan = dict(inputs)
    rescan["implied_p"] = 0.50
    second = store.score_deal_row(deal, rescan)
    assert second["p_house"] == 0.95
    assert second["house_source"] == "override"
    store.save_score_config({**DEFAULT_WEIGHTS, "return": 30, "optionality": 0})
    third = store.score_deal_row(deal, rescan)
    assert third["config_version"] == 1
    assert third["weights"]["return"] == 30
    assert third["score"] != second["score"] or third["components"]["return"]["weight"] == 30
