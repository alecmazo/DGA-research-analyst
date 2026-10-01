"""Local refresh rules. The model is a fake. No network."""

import json
from copy import deepcopy

from merger_arb.deep_dive import parse_json_object
from merger_arb.fixture import build_fixture, fixture_deal
from merger_arb.prompts import LOCAL_RULES
from merger_arb.schema import field_map
from merger_arb.store import MemoryStore
from merger_arb.refresh import (
    GROUP_ORDER,
    apply_updates,
    build_chunks,
    context_limit,
    estimate_tokens,
    refresh_groups,
    run_refresh,
)


PULLED = "2026-10-02T21:00:00+00:00"


def _bundle(*, price=48.0, include_price=True) -> dict:
    prices = []
    if include_price:
        prices.append({
            "ticker": "ACME",
            "role": "target",
            "price": price,
            "url": "https://finance.yahoo.com/quote/ACME",
            "source_name": "Yahoo chart ACME",
            "source_type": "market_data",
            "as_of": "2026-10-02",
            "pulled_at": PULLED,
            "missing": False,
        })
    return {
        "pulled_at": PULLED,
        "since": "2026-06-01",
        "prices": prices,
        "filings": [{
            "ticker": "ACME",
            "form": "8-K",
            "filed": "2026-10-02",
            "url": "https://www.sec.gov/Archives/edgar/data/1/0001/deal.htm",
            "source_name": "SEC 8-K ACME 2026-10-02",
            "source_type": "sec_filing",
            "excerpt": "x" * 5000,
            "terms_change": True,
            "pulled_at": PULLED,
        }],
        "headlines": [{
            "ticker": "ACME",
            "title": "Sample headline",
            "url": "https://finance.yahoo.com/news/sample-headline",
            "source_name": "Sample headline",
            "source_type": "news",
            "summary": "y" * 3000,
            "published": "2026-10-02",
            "pulled_at": PULLED,
        }],
        "errors": [],
    }


def _fake_factory(seen, *, invent_price=False):
    def complete(system, user, num_ctx=8192):
        seen.append(system)
        assert system == LOCAL_RULES
        payload = parse_json_object(user) or {}
        updates = []
        flags = []
        prices = {row.get("role"): row for row in (payload.get("fresh_data") or {}).get("prices") or []}
        for field in payload["fields"]:
            field_id = field["id"]
            target = prices.get("target") or {}
            if field_id == "overview.target_price" and target.get("price") is not None and not invent_price:
                updates.append({
                    "id": field_id,
                    "status": "refreshed",
                    "value": target["price"],
                    "source": {
                        "type": "market_data",
                        "name": target["source_name"],
                        "url": target["url"],
                        "locator": "last",
                    },
                    "pulled_at": target["pulled_at"],
                    "as_of": target["as_of"],
                })
                continue
            if invent_price and field_id == "overview.target_price":
                updates.append({
                    "id": field_id,
                    "status": "refreshed",
                    "value": 99,
                    "source": {
                        "type": "market_data",
                        "name": "invented tape",
                        "url": "https://example.invalid/invented",
                        "locator": "last",
                    },
                    "pulled_at": PULLED,
                    "as_of": PULLED,
                })
                continue
            if field_id == "downside.break_price":
                updates.append({
                    "id": field_id,
                    "status": "refreshed",
                    "value": 1,
                    "source": {"type": "model_estimate", "name": "new guess", "url": "", "locator": ""},
                    "pulled_at": PULLED,
                    "as_of": PULLED,
                })
                continue
            updates.append({
                "id": field_id,
                "status": "flagged",
                "value": None,
                "source": {},
                "pulled_at": "",
                "as_of": "",
            })
            flags.append({"id": field_id, "kind": "unverifiable", "detail": "not in the fresh data"})
        return json.dumps({"updates": updates, "flags": flags, "narrative_edits": []})

    return complete


def test_groups_follow_the_spec_order_and_skip_the_acquirer_on_a_cash_deal():
    groups = refresh_groups(build_fixture())
    names = [group["name"] for group in groups]
    assert names == [name for name in GROUP_ORDER if name in names]
    assert names[0] == "market_prices"
    assert names[-1] == "sources"
    market_ids = [field["id"] for field in groups[0]["fields"]]
    assert market_ids[0] == "overview.target_price"
    assert "overview.acquirer_price" not in market_ids
    stock = build_fixture()
    stock["sections"]["structure"]["consideration"]["value"] = "stock"
    stock_market = [field["id"] for field in refresh_groups(stock)[0]["fields"]]
    assert "overview.acquirer_price" in stock_market


def test_a_day_old_packet_refreshes_the_price_and_keeps_the_judgment():
    seen = []
    packet = build_fixture()
    notes = deepcopy(packet["stage1_notes"])
    updated = run_refresh(
        packet,
        _bundle(price=48),
        _fake_factory(seen),
        now=PULLED,
    )
    fields = field_map(updated)
    assert seen and seen[0] == LOCAL_RULES
    assert fields["overview.target_price"]["value"] == 48
    assert fields["overview.target_price"]["source"]["url"] == "https://finance.yahoo.com/quote/ACME"
    assert fields["spread.gross_dollars"]["value"] == 2
    assert fields["spread.implied_probability"]["value"] == 0.8
    assert fields["spread.gross_dollars"]["source"]["type"] == "derived"
    assert fields["downside.break_price"]["value"] == 40
    assert fields["downside.break_price"]["rationale"].startswith("unaffected")
    assert updated["stage1_notes"][0]["field_ids"] == notes[0]["field_ids"]
    assert updated["packet_meta"]["stage"] == "local_refresh"
    assert updated["done"]["complete"] is True
    assert any(
        flag["id"] == "overview.expected_close" and flag["kind"] == "stale_source"
        for flag in updated["flags"]
    )
    assert updated["done"]["failed"] == []
    flagged = [row for row in updated["refresh_log"] if row["status"] == "flagged"]
    assert flagged
    store = MemoryStore()
    store.upsert_deal(fixture_deal())
    store.save_version(build_fixture())
    saved = store.save_version(updated)
    assert saved["packet_meta"]["version"] == 2


def test_a_missing_price_is_flagged_and_not_invented():
    packet = build_fixture()
    before = field_map(packet)["overview.target_price"]["value"]
    updated = run_refresh(
        packet,
        _bundle(include_price=False),
        _fake_factory([], invent_price=True),
        now=PULLED,
    )
    field = field_map(updated)["overview.target_price"]
    assert field["value"] == before
    assert field["value"] != 99
    row = next(item for item in updated["refresh_log"] if item["id"] == "overview.target_price")
    assert row["status"] == "flagged"
    assert any(flag["id"] == "overview.target_price" for flag in updated["flags"])


def test_rules_reject_off_list_edits_and_unsourced_refreshes():
    packet = build_fixture()
    logs = apply_updates(
        packet,
        ["overview.target_price"],
        {
            "updates": [
                {"id": "overview.target_name", "status": "refreshed", "value": "Renamed", "source": {"type": "news", "name": "x", "url": "https://finance.yahoo.com/quote/ACME"}, "pulled_at": PULLED},
                {"id": "overview.target_price", "status": "refreshed", "value": 12, "source": {"type": "market_data"}, "pulled_at": ""},
            ],
            "flags": [],
            "narrative_edits": [{
                "section": "stage1_notes",
                "old": packet["stage1_notes"][0]["text"],
                "new": "Reworded sample note. The break price still uses the same method.",
                "reason": "tighter wording",
            }],
        },
        _bundle(),
    )
    assert field_map(packet)["overview.target_name"]["value"] == "Sample Target"
    assert field_map(packet)["overview.target_price"]["value"] == 47.5
    assert any(row["status"] == "rejected" for row in logs)
    assert packet["stage1_notes"][0]["field_ids"] == ["downside.break_price"]
    assert packet["stage1_notes"][0]["text"].startswith("Reworded")


def test_chunks_stay_inside_the_context_budget(monkeypatch):
    monkeypatch.setenv("MERGER_ARB_LOCAL_CTX_TOKENS", "2048")
    assert context_limit() == 2048
    chunks = build_chunks(build_fixture(), _bundle())
    assert chunks
    assert any(chunk["cut"] for chunk in chunks)
    budget = int(2048 * 0.75)
    for chunk in chunks:
        assert chunk["num_ctx"] == 2048
        assert chunk["tokens"] <= budget
        assert estimate_tokens(chunk["system"]) + estimate_tokens(chunk["user"]) <= budget


def test_invalid_json_is_retried_once():
    calls = {"n": 0}

    def complete(system, user, num_ctx=8192):
        calls["n"] += 1
        if calls["n"] % 2 == 1:
            return "not json"
        return _fake_factory([])(system, user, num_ctx=num_ctx)

    updated = run_refresh(build_fixture(), _bundle(), complete, now=PULLED)
    assert calls["n"] >= 2
    assert any(row["retried"] for row in updated["local_calls"])
    assert field_map(updated)["overview.target_price"]["value"] == 48


def test_the_refresh_route_has_no_paid_model():
    from pathlib import Path
    text = Path(__file__).resolve().parents[1].joinpath("merger_arb/refresh.py").read_text()
    text += Path(__file__).resolve().parents[1].joinpath("merger_arb/local_model.py").read_text()
    route = Path(__file__).resolve().parents[1].joinpath("api/domains/merger_arb_analysis.py").read_text()
    body = route[route.index("def refresh"):route.index("return router")]
    assert "call_grok" not in text
    assert "call_claude" not in text
    assert "call_grok" not in body
    assert "call_claude" not in body
    assert '"temperature": 0' in text
