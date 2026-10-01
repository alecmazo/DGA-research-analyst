"""A sample packet. The companies are not a real deal."""

from __future__ import annotations

from merger_arb.calc import recompute
from merger_arb.freshness import score_packet
from merger_arb.schema import parse_time, sourced

PULLED = "2026-10-01T15:00:00+00:00"
AS_OF = "2026-10-01T11:00:00-04:00"


def _src(name: str, kind: str, url: str, locator: str = "") -> dict:
    return {"type": kind, "name": name, "url": url, "locator": locator}


def _f(field_id, value, unit, source, freshness, confidence="confirmed", notes="", **extra):
    return sourced(
        field_id,
        value,
        unit=unit,
        source=source,
        pulled_at=PULLED,
        as_of=AS_OF,
        freshness_class=freshness,
        confidence=confidence,
        notes=notes,
        **extra,
    )


def build_fixture() -> dict:
    """Cash deal so the derived numbers are easy to check. Not a live situation."""
    filing = _src(
        "SAMPLE fixture 8-K, not a live filing",
        "sec_filing",
        "https://example.invalid/sample-acme-8k",
        "Item 1.01",
    )
    price = _src(
        "SAMPLE market quote",
        "market_data",
        "https://example.invalid/quote/acme",
        "last",
    )
    packet = {
        "packet_meta": {
            "deal_id": "fixture-acme",
            "version": 1,
            "model": "fixture",
            "created_at": PULLED,
            "stage": "deep_dive",
            "parent_version": None,
        },
        "stage1_notes": [{
            "text": "Sample only. The break price uses the unaffected price plus the peer move.",
            "field_ids": ["downside.break_price"],
        }],
        "flags": [],
        "confirmed_ids": [],
        "sections": {
            "overview": {
                "target_name": _f("overview.target_name", "Sample Target", "", filing, "static"),
                "target_ticker": _f("overview.target_ticker", "ACME", "", filing, "static"),
                "acquirer_name": _f("overview.acquirer_name", "Sample Buyer", "", filing, "static"),
                "acquirer_ticker": _f("overview.acquirer_ticker", "BUYR", "", filing, "static"),
                "announced_date": _f("overview.announced_date", "2026-06-01", "", filing, "static"),
                "offer_terms": _f("overview.offer_terms", "$50.00 cash", "", filing, "terms"),
                "target_price": _f("overview.target_price", 47.50, "USD", price, "market", notes="SAMPLE"),
                "acquirer_price": _f("overview.acquirer_price", 20.0, "USD", price, "market", notes="SAMPLE"),
                "status": _f("overview.status", "pending", "", filing, "event"),
                "expected_close": _f("overview.expected_close", "2027-04-01", "", filing, "event"),
                "years_to_close": _f("overview.years_to_close", 0.5, "years", filing, "event"),
                "outside_date": _f("overview.outside_date", "2027-06-01", "", filing, "terms"),
                "extensions": _f("overview.extensions", "one 3-month extension", "", filing, "terms"),
            },
            "spread": {},
            "structure": {
                "consideration": _f("structure.consideration", "cash", "", filing, "terms"),
                "cash_per_share": _f("structure.cash_per_share", 50.0, "USD", filing, "terms"),
                "exchange_ratio": _f("structure.exchange_ratio", None, "ratio", filing, "terms"),
                "collar_type": _f("structure.collar_type", "none", "", filing, "terms"),
                "collar_low": _f("structure.collar_low", None, "USD", filing, "terms"),
                "collar_high": _f("structure.collar_high", None, "USD", filing, "terms"),
                "collar_value": _f("structure.collar_value", None, "USD", filing, "terms"),
                "walkaway_low": _f("structure.walkaway_low", None, "USD", filing, "terms"),
                "walkaway_high": _f("structure.walkaway_high", None, "USD", filing, "terms"),
                "proration_cash": _f("structure.proration_cash", None, "pct", filing, "terms"),
                "cvr": _f("structure.cvr", "none", "", filing, "terms"),
                "special_dividend": _f("structure.special_dividend", 0, "USD", filing, "terms"),
                "financing": _f("structure.financing", "cash on hand", "", filing, "terms"),
                "financing_condition": _f("structure.financing_condition", "no", "", filing, "terms"),
                "acquirer_cash": _f("structure.acquirer_cash", 1200, "USD millions", filing, "terms"),
                "mac": _f("structure.mac", "customary MAE, no financing out", "", filing, "terms"),
                "minimum_tender": _f("structure.minimum_tender", "not a tender", "", filing, "static"),
                "go_shop": _f("structure.go_shop", "none", "", filing, "terms"),
                "matching_rights": _f("structure.matching_rights", "4 business days", "", filing, "terms"),
            },
            "regulatory": [{
                "authority": _f("regulatory.0.authority", "DOJ/FTC HSR", "", filing, "static"),
                "status": _f("regulatory.0.status", "waiting period", "", filing, "event"),
                "filing_date": _f("regulatory.0.filing_date", "2026-06-15", "", filing, "event"),
                "statutory_timeline": _f("regulatory.0.statutory_timeline", "30 days", "", filing, "static"),
                "expected_timeline": _f("regulatory.0.expected_timeline", "Q1 2027", "", filing, "event"),
                "risks": _f("regulatory.0.risks", "horizontal overlap is small in this sample", "", filing, "event"),
                "remedies": _f("regulatory.0.remedies", "none expected in this sample", "", filing, "event"),
            }],
            "votes": {
                "companies": _f("votes.companies", "target only", "", filing, "terms"),
                "threshold": _f("votes.threshold", "majority of outstanding shares", "", filing, "terms"),
                "record_date": _f("votes.record_date", "2026-11-01", "", filing, "event"),
                "meeting_date": _f("votes.meeting_date", "2026-12-01", "", filing, "event"),
                "locked_up_pct": _f("votes.locked_up_pct", 0.18, "pct", filing, "terms"),
                "iss": _f("votes.iss", "not published", "", filing, "event"),
                "glass_lewis": _f("votes.glass_lewis", "not published", "", filing, "event"),
            },
            "catalysts": [{
                "date": _f("catalysts.0.date", "2026-12-01", "", filing, "event"),
                "event": _f("catalysts.0.event", "target shareholder meeting", "", filing, "event"),
                "impact": _f("catalysts.0.impact", "+", "", filing, "event", confidence="reported"),
                "confidence": _f("catalysts.0.confidence", "reported", "", filing, "event"),
            }],
            "downside": {
                "target_break_fee": _f("downside.target_break_fee", 80, "USD millions", filing, "terms"),
                "reverse_break_fee": _f("downside.reverse_break_fee", 120, "USD millions", filing, "terms"),
                "unaffected_price": _f("downside.unaffected_price", 38.0, "USD", price, "static"),
                "peer_move": _f("downside.peer_move", 0.0526, "pct", price, "market"),
                "peer_index": _f("downside.peer_index", 100, "index", price, "market"),
                "break_price": _f(
                    "downside.break_price",
                    40.0,
                    "USD",
                    _src("SAMPLE break-price method", "model_estimate", "", "unaffected plus peer move"),
                    "market",
                    confidence="estimate",
                    notes="labeled estimate",
                    inputs=["downside.unaffected_price", "downside.peer_move"],
                    rationale="unaffected 38 times 1.0526, rounded to 40",
                ),
            },
            "upside": {
                "dividends": _f("upside.dividends", 0.25, "USD", filing, "terms"),
                "cvr_estimate": _f(
                    "upside.cvr_estimate",
                    0,
                    "USD",
                    _src("SAMPLE no CVR", "model_estimate", "", "none"),
                    "static",
                    confidence="estimate",
                    inputs=["structure.cvr"],
                    rationale="the sample agreement has no CVR",
                ),
                "bump_talk": _f(
                    "upside.bump_talk",
                    "none in the sample",
                    "",
                    _src("SAMPLE speculation label", "news", "https://example.invalid/sample-news", ""),
                    "event",
                    confidence="estimate",
                    notes="speculation",
                ),
            },
            "sources": [{
                "id": "src-filing",
                "type": "sec_filing",
                "name": "SAMPLE fixture 8-K, not a live filing",
                "url": "https://example.invalid/sample-acme-8k",
                "locator": "Item 1.01",
                "published_at": "2026-06-01T20:00:00+00:00",
                "pulled_at": PULLED,
                "field_ids": ["structure.cash_per_share", "overview.announced_date"],
                "refresh_priority": 2,
                "time_limit_hours": 24 * 30,
            }, {
                "id": "src-price",
                "type": "market_data",
                "name": "SAMPLE market quote",
                "url": "https://example.invalid/quote/acme",
                "locator": "last",
                "published_at": AS_OF,
                "pulled_at": PULLED,
                "field_ids": ["overview.target_price"],
                "refresh_priority": 1,
                "time_limit_hours": 26,
            }],
        },
    }
    recompute(packet)
    score_packet(packet, now=parse_time(PULLED))
    return packet


def fixture_deal() -> dict:
    return {
        "id": "fixture-acme",
        "target_ticker": "ACME",
        "target_name": "Sample Target",
        "acquirer_ticker": "BUYR",
        "acquirer_name": "Sample Buyer",
        "announced_on": "2026-06-01",
        "status": "pending",
        "sample": True,
    }
