"""The sample packet renders all nine sections. No network."""

import json

from merger_arb.fixture import build_fixture
from merger_arb.freshness import score_packet
from merger_arb.present import present_packet
from merger_arb.schema import SECTION_TITLES, mark_unsourced, require_sections
from merger_arb.store import SCHEMA_SQL, MemoryStore


def test_fixture_shows_nine_sections_with_sources_dates_and_dots():
    view = present_packet(build_fixture())
    assert [card["title"] for card in view["sections"]] == [title for _key, title in SECTION_TITLES]
    assert view["badge"] == "Fresh"
    priced = next(row for row in view["sections"][0]["rows"] if row["id"] == "overview.target_price")
    assert priced["source_name"]
    assert priced["source_url"].startswith("https://")
    assert priced["pulled_at_pt"].endswith("PT")
    assert priced["dot"] == "green"
    assert priced["display"].startswith("$")
    offer = next(row for row in view["sections"][0]["rows"] if row["id"] == "overview.offer_value")
    assert offer["display"] == "$50.00"
    regulatory = view["sections"][3]
    assert regulatory["blocks"] and regulatory["blocks"][0]["rows"]


def test_a_day_later_the_market_price_is_stale():
    packet = build_fixture()
    score_packet(packet, now="2026-10-02T21:00:00+00:00")
    view = present_packet(packet)
    assert view["badge"] == "Stale"
    priced = next(row for row in view["sections"][0]["rows"] if row["id"] == "overview.target_price")
    assert priced["dot"] == "red"


def test_an_unsourced_number_is_unverified_and_not_a_guess():
    packet = build_fixture()
    packet["sections"]["overview"]["target_price"]["source"] = {}
    flags = mark_unsourced(packet)
    assert packet["sections"]["overview"]["target_price"]["unverified"] is True
    assert any(flag["detail"].startswith("UNVERIFIED") for flag in flags)
    assert require_sections(packet) == []


def test_memory_store_keeps_versions_and_the_sql_names_every_table():
    store = MemoryStore()
    store.upsert_deal({"id": "fixture-acme", "target_ticker": "ACME"})
    first = store.save_version(build_fixture())
    assert first["packet_meta"]["version"] == 1
    assert store.latest("fixture-acme")["packet_meta"]["deal_id"] == "fixture-acme"
    text = "\n".join(SCHEMA_SQL)
    for name in (
        "merger_arb_deals",
        "merger_arb_packet_versions",
        "merger_arb_field_values",
        "merger_arb_sources",
        "merger_arb_flags",
    ):
        assert name in text
    json.dumps(build_fixture())


def test_the_json_fixture_loads_nine_sections():
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "merger_arb" / "fixtures" / "acme.json"
    packet = json.loads(path.read_text())
    view = present_packet(packet)
    assert [card["title"] for card in view["sections"]] == [title for _key, title in SECTION_TITLES]
    assert view["badge"] == "Fresh"
    offer = next(row for row in view["sections"][0]["rows"] if row["id"] == "overview.offer_value")
    assert offer["value"] == 50
    sensitivity = next(row for row in view["sections"][1]["rows"] if row["id"] == "spread.sensitivity")
    assert len(sensitivity["value"]) == 9


def test_the_main_desk_page_is_not_rewired():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    desk = (root / "web/gp-app/src/pages/DeskPage.tsx").read_text()
    assert "merger-arb" not in desk
    assert "Merger Arb" not in desk
