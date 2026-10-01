"""Deep dive validation. The model is a fake. No network and no paid call."""

import json
from copy import deepcopy

import pytest

from merger_arb.bundle import assemble_bundle, is_watch_form
from merger_arb.deep_dive import DeepDiveError, run_deep_dive
from merger_arb.fixture import build_fixture, fixture_deal
from merger_arb.schema import field_map


def _bundle() -> dict:
    pulled = "2026-10-01T15:00:00+00:00"
    return {
        "pulled_at": pulled,
        "since": "2026-01-01",
        "prices": [{
            "ticker": "ACME",
            "role": "target",
            "price": 47.5,
            "url": "https://example.invalid/quote/acme",
            "source_name": "SAMPLE market quote",
            "as_of": "2026-10-01T11:00:00-04:00",
            "pulled_at": pulled,
            "missing": False,
        }],
        "filings": [{
            "ticker": "ACME",
            "form": "8-K",
            "url": "https://example.invalid/sample-acme-8k",
            "source_name": "SAMPLE fixture 8-K, not a live filing",
            "excerpt": "Item 1.01",
            "terms_change": True,
            "pulled_at": pulled,
        }],
        "headlines": [{
            "ticker": "ACME",
            "title": "sample",
            "url": "https://example.invalid/sample-news",
            "source_name": "SAMPLE speculation label",
            "published": pulled,
            "pulled_at": pulled,
        }],
        "errors": [],
    }


def _model_body(*, gross: float = 999, drop_source: bool = False) -> dict:
    packet = build_fixture()
    sections = deepcopy(packet["sections"])
    sections["spread"]["gross_dollars"]["value"] = gross
    if drop_source:
        sections["overview"]["target_price"]["source"] = {}
        sections["overview"]["target_price"]["unverified"] = False
    return {"stage1_notes": packet["stage1_notes"], "sections": sections}


def test_deep_dive_keeps_only_the_picked_model_and_recomputes():
    called = []

    def grok(system, user):
        called.append("grok")
        assert "live_search" not in system
        return json.dumps(_model_body())

    def claude(system, user):
        called.append("claude")
        raise AssertionError("claude must not run")

    packet = run_deep_dive(fixture_deal(), _bundle(), grok, model_name="grok", parent_version=None)
    assert called == ["grok"]
    assert claude  # referenced so the unused guard stays obvious
    fields = field_map(packet)
    assert packet["packet_meta"]["model"] == "grok"
    assert packet["packet_meta"]["stage"] == "deep_dive"
    assert packet["packet_meta"]["version"] is None
    assert fields["spread.gross_dollars"]["value"] == 2.5
    assert fields["overview.offer_value"]["value"] == 50
    assert fields["overview.offer_value"]["source"]["type"] == "derived"
    assert fields["spread.implied_probability"]["value"] == 0.75
    assert fields["overview.target_price"]["unverified"] is False


def test_an_unsourced_model_number_is_unverified_and_left_out():
    def grok(system, user):
        return json.dumps(_model_body(drop_source=True))

    packet = run_deep_dive(fixture_deal(), _bundle(), grok, model_name="grok")
    fields = field_map(packet)
    assert fields["overview.target_price"]["unverified"] is True
    assert "UNVERIFIED" in fields["overview.target_price"]["notes"]
    assert fields["spread.gross_dollars"]["value"] is None
    assert any(flag["id"] == "overview.target_price" for flag in packet["flags"])


def test_invalid_json_is_repaired_once_and_then_rejected():
    calls = {"n": 0}

    def flaky(system, user):
        calls["n"] += 1
        if calls["n"] == 1:
            return "not json at all"
        return json.dumps(_model_body())

    packet = run_deep_dive(fixture_deal(), _bundle(), flaky, model_name="claude")
    assert calls["n"] == 2
    assert packet["packet_meta"]["model"] == "claude"
    assert field_map(packet)["overview.offer_value"]["value"] == 50

    def always_bad(system, user):
        return "still not json"

    with pytest.raises(DeepDiveError):
        run_deep_dive(fixture_deal(), _bundle(), always_bad, model_name="grok")


def test_a_number_whose_source_is_not_in_the_bundle_is_unverified():
    body = _model_body()
    body["sections"]["overview"]["target_price"]["source"] = {
        "type": "market_data",
        "name": "invented tape",
        "url": "https://example.invalid/not-in-the-bundle",
        "locator": "last",
    }

    def grok(system, user):
        return json.dumps(body)

    packet = run_deep_dive(fixture_deal(), _bundle(), grok, model_name="grok")
    assert field_map(packet)["overview.target_price"]["unverified"] is True
    assert field_map(packet)["spread.gross_dollars"]["value"] is None


def test_bundle_assembly_uses_the_injected_sources_and_skips_other_forms():
    assert is_watch_form("SC TO-T")
    assert is_watch_form("8-K/A")
    assert not is_watch_form("10-K")

    def quotes(tickers):
        assert "ACME" in tickers
        return {"ACME": {"price": 11.5, "as_of": "2026-10-01", "source": "yahoo-chart"}}

    def resolve_cik(ticker):
        return "0000000123"

    def submissions(cik):
        assert cik == "0000000123"
        return {
            "cik": "123",
            "filings": {"recent": {
                "form": ["8-K", "10-K", "SC TO-T", "4"],
                "filingDate": ["2026-09-02", "2026-08-01", "2026-09-03", "2026-09-04"],
                "accessionNumber": ["0001-22-000001", "0001-22-000002", "0001-22-000003", "0001-22-000004"],
                "primaryDocument": ["deal.htm", "annual.htm", "tender.htm", "form4.htm"],
                "items": ["1.01", "", "", ""],
            }},
        }

    def news(ticker):
        return [{
            "title": "Buyer agrees to acquire Sample Target",
            "link": "https://finance.yahoo.com/news/sample",
            "publisher": "Yahoo Finance",
            "summary": "A cash offer.",
            "published": "Wed, 02 Sep 2026 12:00:00 GMT",
        }]

    bundle = assemble_bundle(
        fixture_deal(),
        since="2026-06-01",
        quotes_fn=quotes,
        resolve_cik=resolve_cik,
        submissions_fn=submissions,
        news_fn=news,
        pulled_at="2026-10-01T18:00:00+00:00",
    )
    forms = [row["form"] for row in bundle["filings"] if row["ticker"] == "ACME"]
    assert forms == ["8-K", "SC TO-T"]
    assert bundle["filings"][0]["terms_change"] is True
    assert bundle["filings"][0]["url"].startswith("https://www.sec.gov/Archives/edgar/data/123/")
    assert bundle["prices"][0]["price"] == 11.5
    assert bundle["prices"][0]["url"] == "https://finance.yahoo.com/quote/ACME"
    assert bundle["headlines"][0]["url"].endswith("/sample")
    assert any("no price for BUYR" in item for item in bundle["errors"])


def test_the_route_calls_only_the_named_provider():
    from pathlib import Path
    text = Path(__file__).resolve().parents[1].joinpath("api/domains/merger_arb_analysis.py").read_text()
    start = text.index('def deep_dive')
    body = text[start:text.index("return router", start)]
    assert "live_search=False" in body
    assert "call_grok" in body and "call_claude" in body
    assert "fallback" not in body.lower()
    grok_at = body.index("call_grok")
    claude_at = body.index("call_claude")
    assert body.index('provider == "grok"') < grok_at < claude_at
