"""Memory store. The fixture is not inserted by a bare store."""

from credit.fixture import CIK, build_fixture
from credit.store import MemoryStore


def test_memory_store_round_trip_and_reference_table():
    store = MemoryStore()
    assert store.get_issuer(CIK) is None
    packet = build_fixture()
    store.save_issuer(packet["issuer"], packet)
    assert store.latest(CIK)["issuer"]["cik"] == CIK
    store.add_price({"instrument_id": "psky_1l_2031", "clean_price": "99.5", "trade_date": "2026-10-02", "source_note": "FINRA site, manual"})
    assert store.prices_for("psky_1l_2031")[0]["clean_price"] == "99.5"
    store.add_price({"instrument_id": "psky_1l_2031", "clean_price": "98", "trade_date": "2026-10-03", "source_note": "typed again"})
    assert store.latest_prices()["psky_1l_2031"]["clean_price"] == "98"
    store.forget_price("psky_1l_2031")
    assert store.latest_prices() == {}
    store.save_reference("moodys_default", "2025", "https://ratings.moodys.com/sec-17g-7b", "2026-10-02", [{"rating": "Ba1", "year1": "0.5"}])
    assert store.reference("moodys_default")["rows"][0]["rating"] == "Ba1"
    assert store.reference("missing") is None
