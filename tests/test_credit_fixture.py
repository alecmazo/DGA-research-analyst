"""The Paramount fixture keeps sourced facts and leaves weak ones out of the math."""

from decimal import Decimal

from credit.calc import usable
from credit.fixture import CIK, build_fixture, load_json, structure_totals
from credit.market import install_benchmarks, missing_benchmarks
from credit.present import build_view
from credit.prices import priced_packet_body
from credit.store import MemoryStore

CURVE = {
    "ok": True,
    "curve": {"5Y": Decimal("5.01"), "7Y": Decimal("5.12"), "10Y": Decimal("5.24")},
    "oas": {"ig": "0.86", "bbb": "1.06", "bb": "2.04", "b": "3.29", "hy": "3.24", "ccc": "12.15"},
    "treasury_as_of": "2026-10-02",
    "oas_as_of": "2026-10-02",
    "note": "Test curve as of 2026-10-02.",
}


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
    priced = build_view(build_fixture(), {
        "prices": {"psky_1l_2031": {"clean_price": "100"}},
        "settlement": "2026-10-05",
        "benchmarks": CURVE,
    })
    row = next(item for item in priced["quotes"] if item["id"] == "psky_1l_2031")
    assert row["clean_price"] == "100"
    assert row["ytm"] == "7.05"
    assert row["g_spread_bp"]
    assert row["verdict"] in {"Buy", "Watch", "Avoid"}
    assert "not public" in row["ytw_note"]
    assert priced["curve_as_of"] == "2026-10-02"
    assert "2026-10-01" not in priced["badge_reason"]
    assert "2026-10-01" not in priced["oas_note"]


def test_yield_settlement_is_the_next_business_day():
    tuesday = build_view(build_fixture(), {"as_of": "2026-10-06", "benchmarks": missing_benchmarks("not loaded")})
    assert tuesday["settlement"] == "2026-10-07"
    friday = build_view(build_fixture(), {"as_of": "2026-10-02", "benchmarks": missing_benchmarks("not loaded")})
    assert friday["settlement"] == "2026-10-05"


def test_missing_curve_does_not_reuse_the_fixture_close():
    install_benchmarks(missing_benchmarks("Treasury curve is not loaded."))
    view = build_view(build_fixture(), {
        "prices": {"psky_1l_2031": {"clean_price": "100"}},
        "settlement": "2026-10-05",
    })
    row = next(item for item in view["quotes"] if item["id"] == "psky_1l_2031")
    assert row["g_spread_bp"] is None
    assert view["oas"]["hy"] == "not loaded"
    assert view["curve_as_of"] == ""
    assert "2026-10-01" not in view["badge_reason"]
    assert "2026-10-01" not in view["oas_note"]


def test_exchange_notes_do_not_use_a_january_first_maturity():
    packet = build_fixture()
    exchanges = [row for row in packet["instruments"] if row.get("group") == "exchange"]
    assert exchanges
    for row in exchanges:
        maturity = str((row.get("maturity") or {}).get("value") or "")
        assert not maturity.endswith("-01-01")
        assert len(maturity) == 4 and maturity.isdigit()
    view = build_view(packet, {
        "prices": {"wbd_dcl_2029": {"clean_price": "100"}},
        "settlement": "2026-10-05",
        "benchmarks": CURVE,
    })
    row = next(item for item in view["quotes"] if item["id"] == "wbd_dcl_2029")
    assert row["maturity"] == "2029"
    assert row["ytm"] is None
    assert row["clean_price"] == "100"
    assert row["note"] == "maturity day is not public"
    saved = load_json()
    for item in saved["instruments"]:
        if item.get("group") == "exchange":
            assert not str(item["maturity"]["value"]).endswith("-01-01")


def test_typed_price_is_still_there_on_the_next_view():
    store = MemoryStore()
    packet = build_fixture()
    first = priced_packet_body(store, packet, {"prices": {"psky_1l_2031": {"clean_price": "101.25"}, "psky_1l_2033": {"clean_price": "98"}}}, "desk")
    view = build_view(packet, {**first, "settlement": "2026-10-05", "benchmarks": CURVE})
    kept = {row["id"]: row["clean_price"] for row in view["quotes"] if row.get("clean_price")}
    assert kept["psky_1l_2031"] == "101.25"
    assert kept["psky_1l_2033"] == "98"
    again = priced_packet_body(store, packet, None, "")
    assert again["prices"]["psky_1l_2031"]["clean_price"] == "101.25"
    assert again["prices"]["psky_1l_2033"]["clean_price"] == "98"
    cleared = priced_packet_body(store, packet, {"prices": {"psky_1l_2031": {"clean_price": ""}}}, "desk")
    assert "psky_1l_2031" not in cleared["prices"]
    assert cleared["prices"]["psky_1l_2033"]["clean_price"] == "98"


def test_combined_stress_names_a_default_year():
    view = build_view(build_fixture())
    combined = next(row for row in view["scenarios"] if row["id"] == "combined")
    assert combined["default_year"] == 2033
    assert combined["confidence"] == "model_estimate"
