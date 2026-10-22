"""Fund and managed-account Run uses the committee review, not EV weights."""
from pathlib import Path

from api.domains.committee_sizing import (
    BINARY_RUIN_MAX_PCT,
    MISSING_THESIS_MAX_PCT,
    committee_dossier,
    reviews_for_book,
    rows_from_committee,
)

ROOT = Path(__file__).resolve().parents[1]


def _book():
    return [
        {"ticker": "XYZ", "weight_pct": 8.0},
        {"ticker": "ACME", "weight_pct": 6.0},
        {"ticker": "CASHCO", "weight_pct": 5.0},
    ]


def test_binary_ruin_weight_is_capped():
    answer = committee_dossier("Demo Book", [
        {
            "ticker": "XYZ",
            "current_pct": 8,
            "target_pct": 8,
            "action": "hold",
            "why": "The price target implies large upside.",
            "downside": "Single pivotal readout.",
            "binary": True,
            "thesis_on_file": True,
            "industry": "Biotechnology",
            "market_cap": 2_000_000_000,
        },
        {
            "ticker": "ACME",
            "current_pct": 6,
            "target_pct": 6,
            "why": "Durable installed base and recurring revenue.",
            "downside": "Multiple compression in a recession.",
            "binary": False,
            "thesis_on_file": True,
            "industry": "Software",
            "market_cap": 80_000_000_000,
        },
        {
            "ticker": "CASHCO",
            "current_pct": 5,
            "target_pct": 5,
            "why": "",
            "thesis_on_file": False,
        },
    ])
    rows = rows_from_committee(
        _book(),
        answer=answer,
        theses={
            "XYZ": "Small-cap biotech. The value is a binary Phase 3 readout with risk of ruin.",
            "ACME": "Durable franchise with contracted renewals.",
            "CASHCO": "",
        },
    )
    by = {r["ticker"]: r for r in rows}
    assert by["XYZ"]["suggested_pct"] <= BINARY_RUIN_MAX_PCT
    assert by["XYZ"]["suggested_pct"] < 8
    assert by["XYZ"]["capped"] is True
    assert by["XYZ"]["action"] == "trim"
    assert "4%" in by["XYZ"]["downside"]
    assert by["ACME"]["suggested_pct"] == 6
    assert by["CASHCO"]["suggested_pct"] <= MISSING_THESIS_MAX_PCT
    assert by["CASHCO"]["thesis_on_file"] is False
    assert "thesis" in by["CASHCO"]["why"].lower()


def test_upside_does_not_set_the_weight():
    base = {
        "ticker": "ACME",
        "current_pct": 6,
        "target_pct": 7,
        "why": "Thesis: contracted renewals fund a measured add.",
        "downside": "Demand pause.",
        "binary": False,
        "thesis_on_file": True,
        "industry": "Software",
        "market_cap": 80_000_000_000,
    }
    hi = rows_from_committee(
        [{"ticker": "ACME", "weight_pct": 6}],
        proposals=[{**base, "upside_pct": 400, "rating": "Strong Buy"}],
        theses={"ACME": "Contracted renewals."},
    )
    lo = rows_from_committee(
        [{"ticker": "ACME", "weight_pct": 6}],
        proposals=[{**base, "upside_pct": 2, "rating": "Hold"}],
        theses={"ACME": "Contracted renewals."},
    )
    assert hi[0]["suggested_pct"] == lo[0]["suggested_pct"] == 7

    ev_only = rows_from_committee(
        [{"ticker": "ACME", "weight_pct": 5}],
        proposals=[{"ticker": "ACME", "upside_pct": 90, "rating": "Buy"}],
        theses={"ACME": "Contracted renewals."},
    )
    assert ev_only[0]["suggested_pct"] == 5


def test_small_biotech_without_explicit_flag_is_still_capped():
    rows = rows_from_committee(
        [{"ticker": "XYZ", "weight_pct": 3, "industry": "Biotechnology"}],
        proposals=[{
            "ticker": "XYZ",
            "target_pct": 8,
            "why": "Upside to the price target is wide if the trial works.",
            "downside": "The trial can fail.",
            "thesis_on_file": True,
            "industry": "Biotechnology",
            "market_cap": 1_500_000_000,
        }],
        theses={"XYZ": "One asset, one readout."},
    )
    assert rows[0]["suggested_pct"] == BINARY_RUIN_MAX_PCT
    assert rows[0]["binary"] is True


def test_review_id_lists_under_that_book():
    listed = reviews_for_book(
        [
            {"id": "STRAT_fund", "fund_id": "fund-1", "fund_name": "Fund One"},
            {"id": "STRAT_other", "fund_id": "acct-9", "fund_name": "Other"},
            {"fund_id": "fund-1"},
        ],
        "fund-1",
    )
    assert [r["id"] for r in listed] == ["STRAT_fund"]


def test_run_queues_committee_review_and_cards_drop_ev():
    src = (ROOT / "api/server.py").read_text()
    run = src.split("def run_account_rebalance")[1].split("\n@app.")[0]
    assert "_queue_portfolio_strategist" in run
    assert "_demo_committee_rebalance" in run
    assert "compute_rebalance" not in run
    assert "current_ev" not in run
    get = src.split("def get_account_rebalance")[1].split("\n@app.")[0]
    assert "_committee_rebalance_payload" in get
    assert "current_ev" not in get
    payload = src.split("def _committee_rebalance_payload")[1].split("\ndef ")[0]
    assert "source" in payload and "committee" in payload
    assert "review_id" in payload
    listed = src.split("def _strategist_reviews_for_fund")[1].split("\ndef ")[0]
    assert "fund_id" in listed
    assert "suggestions" in listed
    persist = src.split("def _persist_strategist_review")[1].split("\ndef ")[0]
    assert "suggestions" in persist
    assert "rows_from_committee" in persist
    queue = src.split("def _queue_portfolio_strategist")[1].split("\ndef ")[0]
    assert "theses" in queue
    assert "_saved_theses" in queue
    card = (ROOT / "web/gp-app/src/pages/fund/RebalanceCard.tsx").read_text()
    assert "openResearchWindow" in card
    assert "portfolio-strategist" not in card
    assert "/rebalance" in card
    assert "current_ev" not in card
    assert "Expected value" not in card
    assert "suggested_ev" not in card
    assert "RebalanceCard" in (ROOT / "web/gp-app/src/pages/fund/ManagedDetail.tsx").read_text()
    assert "RebalanceCard" in (ROOT / "web/gp-app/src/pages/fund/LpDetail.tsx").read_text()
    legacy = (ROOT / "web/gp/js/gp-main.js").read_text()
    render = legacy.split("function renderRebalanceResult")[1].split("function _updatePositionsReturnTile")[0]
    assert "EXPECTED VALUE" not in render
    assert "source === 'committee'" in render or 'source==="committee"' in render or "committee" in render
