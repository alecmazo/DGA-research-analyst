"""The Paramount fixture keeps sourced facts and leaves weak ones out of the math."""

from credit.calc import usable
from credit.fixture import CIK, build_fixture, load_json, structure_totals
from credit.present import build_view


def test_capital_structure_totals():
    totals = structure_totals(build_fixture())
    assert totals == {
        "new_1l_usd": "30000",
        "new_2l_usd": "11400",
        "new_2l_eur": "885",
        "tlb_usd": "8500",
        "tlb_eur": "850",
    }


def test_json_fixture_matches_the_builder():
    assert load_json()["issuer"]["cik"] == CIK
    assert structure_totals(load_json())["new_1l_usd"] == "30000"


def test_low_and_unconfirmed_stay_out_of_math():
    packet = build_fixture()
    by_id = {row["id"]: row for row in packet["fields"]}
    assert not usable(by_id["rating.2l_fitch"])
    assert not usable(by_id["rating.issuer_sp"])
    assert usable(by_id["rating.1l_sp"])
    assert by_id["xbrl.maturities"]["value"]["2026"] == "433"
    assert by_id["xbrl.maturities"]["value"]["after_2030"] == "11632"


def test_unknowns_are_labeled_and_a_price_recomputes():
    view = build_view(build_fixture())
    calls = {row["key"]: row["status"] for row in view["covenants"]}
    assert calls["call_schedule"] == "not_public"
    assert calls["lien_release_ig"] == "found"
    assert view["pd"]["rating"] == "reference table not loaded"
    bare = next(row for row in view["quotes"] if row["id"] == "psky_1l_2031")
    assert bare["note"] == "not found"
    priced = build_view(build_fixture(), {"prices": {"psky_1l_2031": {"clean_price": "100"}}})
    row = next(item for item in priced["quotes"] if item["id"] == "psky_1l_2031")
    assert row["ytm"] == "7.05"
    assert row["g_spread_bp"]
    assert row["verdict"] in {"Buy", "Watch", "Avoid"}
    assert "not public" in row["ytw_note"]


def test_combined_stress_names_a_default_year():
    view = build_view(build_fixture())
    combined = next(row for row in view["scenarios"] if row["id"] == "combined")
    assert combined["default_year"] == 2033
    assert combined["confidence"] == "model_estimate"
