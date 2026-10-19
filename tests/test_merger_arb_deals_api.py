"""Deals list/detail/patch, score-config, and FMP removal. No network."""

from __future__ import annotations

import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.domains.merger_arb_analysis import create_router
from merger_arb.score import DEFAULT_WEIGHTS
from merger_arb.store import MemoryStore


def _app(store=None, role="gp"):
    desk = store if store is not None else MemoryStore()
    app = FastAPI()
    app.include_router(create_router(lambda _request: {"role": role, "email": "alec@dgacapital.com", "name": "Alec"}, store=desk))
    return TestClient(app), desk


def _seed(store: MemoryStore) -> None:
    store.upsert_deal({
        "id": "cash-one",
        "target_ticker": "ACME",
        "target_name": "Acme Corp",
        "acquirer_ticker": "BIG",
        "acquirer_name": "Big Co",
        "stage": "watch",
        "deal_type": "cash",
        "sector": "Tech",
        "deal_value_usd": 400_000_000,
        "offer_value": 50,
        "target_price": 47.5,
        "gross_pct": 0.0526,
        "ann_pct": 0.12,
        "downside_pct": -0.24,
        "implied_p": 0.821,
        "score": 82,
        "score_band": "A",
        "data_confidence": 90,
        "expected_close": "2026-12-01",
        "reg_flags": ["HSR"],
        "metrics_json": {
            "offer_value": 50,
            "target_price": 47.5,
            "gross_pct": 0.0526,
            "annualized_pct": 0.12,
            "downside_pct": -0.24,
            "implied_p": 0.821,
            "tbill_pct": 4.2,
            "days_to_close": 43,
            "break_price": 36,
            "consideration": "cash",
        },
        "terms_json": {"cash_per_share": 50},
    })
    store.upsert_deal({
        "id": "stock-two",
        "target_ticker": "FOO",
        "target_name": "Foo Inc",
        "acquirer_ticker": "BAR",
        "acquirer_name": "Bar LLC",
        "stage": "screen",
        "deal_type": "stock",
        "sector": "Health",
        "deal_value_usd": 3_000_000_000,
        "offer_value": 20,
        "target_price": 18,
        "gross_pct": 0.111,
        "ann_pct": 0.08,
        "score": 64,
        "score_band": "C",
        "data_confidence": 40,
        "expected_close": "2027-06-01",
        "reg_flags": ["CFIUS", "2R"],
        "hostile": True,
        "acquirer_kind": "pe",
        "metrics_json": {
            "offer_value": 20,
            "target_price": 18,
            "gross_pct": 0.111,
            "annualized_pct": 0.08,
            "tbill_pct": 4.2,
            "days_to_close": 220,
            "acquirer_price_sensitive": True,
            "break_price": 14,
            "implied_p": 0.67,
        },
    })
    store.upsert_deal({
        "id": "closed-three",
        "target_ticker": "OLD",
        "target_name": "Old Co",
        "acquirer_ticker": "NEW",
        "acquirer_name": "New Co",
        "stage": "closed",
        "deal_type": "cash",
        "sector": "Tech",
        "score": 50,
        "score_band": "C",
        "gross_pct": 0.01,
        "ann_pct": 0.02,
    })
    store.merge_deal_fields("cash-one", [{
        "field_name": "cash_per_share",
        "value": 50,
        "source_name": "SEC 8-K",
        "source_url": "https://www.sec.gov/Archives/edgar/data/1/acme.htm",
        "pulled_at": "2026-10-01T15:00:00+00:00",
        "is_current": True,
        "method": "sec",
    }])
    store.upsert_regulatory("cash-one", {"regulator": "HSR", "stage": "pending", "filed_on": "2026-09-01"})
    store.add_event("cash-one", {"kind": "announce", "actual_on": "2026-06-01"})
    store.upsert_spread_history("cash-one", "2026-10-01", {
        "current_price": 47.5,
        "metrics": {"offer_value": 50, "gross_pct": 0.0526, "annualized_pct": 0.12, "implied_p": 0.821},
        "score": 82,
    })


def test_list_filters_sorts_pages_and_facets():
    store = MemoryStore()
    _seed(store)
    client, _desk = _app(store)

    all_rows = client.get("/api/merger-arb/deals")
    assert all_rows.status_code == 200
    body = all_rows.json()
    assert body["ok"] is True
    assert "deals" in body
    assert body["total"] == 3
    assert body["facets"]["type"]["cash"] == 2
    assert body["facets"]["band"]["A"] == 1
    assert body["facets"]["flag"]["HSR"] == 1

    stage = client.get("/api/merger-arb/deals", params={"stage": "watch,screen"})
    assert {row["id"] for row in stage.json()["deals"]} == {"cash-one", "stock-two"}

    cash = client.get("/api/merger-arb/deals", params={"type": "cash"})
    assert [row["id"] for row in cash.json()["deals"]] == ["cash-one", "closed-three"] or set(
        row["id"] for row in cash.json()["deals"]
    ) == {"cash-one", "closed-three"}

    tech = client.get("/api/merger-arb/deals", params={"sector": "Tech"})
    assert {row["id"] for row in tech.json()["deals"]} == {"cash-one", "closed-three"}

    size = client.get("/api/merger-arb/deals", params={"size": "lt500"})
    assert [row["id"] for row in size.json()["deals"]] == ["cash-one"]

    band = client.get("/api/merger-arb/deals", params={"band": "A"})
    assert [row["id"] for row in band.json()["deals"]] == ["cash-one"]

    flag = client.get("/api/merger-arb/deals", params={"regulatory": "2R"})
    assert [row["id"] for row in flag.json()["deals"]] == ["stock-two"]

    close = client.get("/api/merger-arb/deals", params={"close": "30-90"})
    assert "cash-one" in {row["id"] for row in close.json()["deals"]}

    search = client.get("/api/merger-arb/deals", params={"q": "acme"})
    assert [row["id"] for row in search.json()["deals"]] == ["cash-one"]

    spread = client.get("/api/merger-arb/deals", params={"spread_min": 8})
    assert [row["id"] for row in spread.json()["deals"]] == ["stock-two"]

    sorted_rows = client.get("/api/merger-arb/deals", params={"sort": "-score"})
    scores = [row["score"] for row in sorted_rows.json()["deals"]]
    assert scores == sorted(scores, reverse=True)

    by_target = client.get("/api/merger-arb/deals", params={"sort": "target"})
    tickers = [row["target_ticker"] for row in by_target.json()["deals"]]
    assert tickers == sorted(tickers)

    page = client.get("/api/merger-arb/deals", params={"sort": "-score", "page": 1, "page_size": 2})
    paged = page.json()
    assert paged["page"] == 1
    assert paged["page_size"] == 2
    assert paged["total"] == 3
    assert len(paged["deals"]) == 2
    assert paged["deals"][0]["id"] == "cash-one"


def test_detail_patch_and_score_config():
    store = MemoryStore()
    _seed(store)
    client, desk = _app(store)

    missing = client.get("/api/merger-arb/deals/nope")
    assert missing.status_code == 404

    detail = client.get("/api/merger-arb/deals/cash-one")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["deal"]["target_ticker"] == "ACME"
    assert payload["terms"]["cash_per_share"] == 50
    assert payload["fields"]
    assert payload["regulatory"][0]["regulator"] == "HSR"
    assert payload["events"][0]["kind"] == "announce"
    assert payload["spread_history"][0]["d"] == "2026-10-01"
    assert payload["filings"][0]["url"].startswith("https://www.sec.gov/")

    bad_stage = client.patch("/api/merger-arb/deals/cash-one", json={"stage": "maybe"})
    assert bad_stage.status_code == 400

    tracked = client.patch("/api/merger-arb/deals/cash-one", json={"stage": "active"})
    assert tracked.status_code == 200
    assert tracked.json()["deal"]["stage"] == "active"
    assert desk.get_deal("cash-one")["stage"] == "active"

    no_note = client.patch("/api/merger-arb/deals/cash-one", json={"overrides": {"house_p": {"value": 0.95}}})
    assert no_note.status_code == 400

    override = client.patch("/api/merger-arb/deals/cash-one", json={
        "overrides": {"house_p": {"value": 0.95, "note": "vote locked"}},
    })
    assert override.status_code == 200
    scored = desk.get_deal("cash-one")
    assert scored["score_json"]["house_source"] == "override"
    assert scored["score_json"]["p_house"] == 0.95
    assert scored["score_json"]["overrides"]["house_p"]["note"] == "vote locked"
    assert scored["score_json"]["overrides"]["house_p"]["user"] == "alec@dgacapital.com"
    assert "PT" in (scored["score_json"]["overrides"]["house_p"].get("at_pt") or "")

    desk.score_deal_row(scored, {
        "net_annualized": 0.12,
        "tbill_pct": 4.2,
        "offer": 50,
        "price": 47.5,
        "break_price": 36,
        "implied_p": 0.50,
        "days_to_close": 43,
        "consideration": "cash",
    })
    assert desk.get_deal("cash-one")["score_json"]["p_house"] == 0.95

    cfg = client.get("/api/merger-arb/score-config")
    assert cfg.status_code == 200
    assert cfg.json()["config"]["weights"]["return"] == 25

    bad_w = client.put("/api/merger-arb/score-config", json={"weights": {**DEFAULT_WEIGHTS, "return": 26}})
    assert bad_w.status_code == 400

    saved = client.put("/api/merger-arb/score-config", json={"weights": {**DEFAULT_WEIGHTS, "return": 30, "optionality": 0}})
    assert saved.status_code == 200
    assert saved.json()["config"]["version"] == 1
    assert saved.json()["rescored"] >= 3
    assert desk.get_deal("cash-one")["score_json"]["weights"]["return"] == 30


def test_demo_cannot_patch_and_lp_is_forbidden():
    store = MemoryStore()
    _seed(store)
    lp, _desk = _app(store, role="lp")
    assert lp.get("/api/merger-arb/deals").status_code == 403
    assert lp.patch("/api/merger-arb/deals/cash-one", json={"stage": "active"}).status_code == 403
    assert lp.put("/api/merger-arb/score-config", json={"weights": DEFAULT_WEIGHTS}).status_code == 403


def test_list_300_deals_under_300ms():
    store = MemoryStore()
    for i in range(300):
        store.upsert_deal({
            "id": f"d{i:03d}",
            "target_ticker": f"T{i:03d}",
            "target_name": f"Target {i}",
            "acquirer_ticker": f"A{i:03d}",
            "stage": "watch" if i % 2 == 0 else "screen",
            "deal_type": "cash" if i % 3 else "stock",
            "sector": "Tech" if i % 2 else "Health",
            "score": i % 100,
            "score_band": "A" if i % 5 == 0 else "B",
            "gross_pct": 0.01 + (i % 20) / 1000.0,
            "ann_pct": 0.05,
            "deal_value_usd": 100_000_000 * (1 + i % 40),
        })
    client, _desk = _app(store)
    t0 = time.perf_counter()
    body = client.get("/api/merger-arb/deals", params={"stage": "watch,screen", "sort": "-score", "page": 1, "page_size": 50})
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert body.status_code == 200
    assert body.json()["total"] == 300
    assert len(body.json()["deals"]) == 50
    assert elapsed_ms < 300
