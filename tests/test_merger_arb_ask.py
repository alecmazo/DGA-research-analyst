"""Follow-up answers and export. The model is a fake. No network."""

import json

from merger_arb.ask import run_ask
from merger_arb.export import to_json, to_markdown
from merger_arb.fixture import build_fixture
from merger_arb.prompts import ASK_JSON, LOCAL_RULES


def _answer(payload):
    def complete(system, user, num_ctx=8192):
        assert system.startswith(LOCAL_RULES)
        assert system.rstrip().endswith(ASK_JSON)
        return json.dumps(payload)
    return complete


def test_a_follow_up_cites_a_packet_field():
    result = run_ask(
        build_fixture(),
        "What is the gross spread?",
        _answer({
            "answer": "The gross spread is $2.50.",
            "citations": ["spread.gross_dollars", "not.a.field"],
            "escalate": False,
        }),
    )
    assert result["answer"] == "The gross spread is $2.50."
    assert result["citations"] == ["spread.gross_dollars"]
    assert result["escalate"] is False


def test_an_unknown_question_escalates_and_does_not_invent():
    result = run_ask(
        build_fixture(),
        "What did the board say in the last dinner?",
        _answer({
            "answer": "not in packet, escalate to Deep Dive",
            "citations": [],
            "escalate": False,
        }),
    )
    assert result["escalate"] is True
    assert "not in packet" in result["answer"]


def test_invalid_follow_up_json_is_retried_once():
    calls = {"n": 0}

    def complete(system, user, num_ctx=8192):
        calls["n"] += 1
        if calls["n"] == 1:
            return "nope"
        return json.dumps({"answer": "Offer value is $50.", "citations": ["overview.offer_value"], "escalate": False})

    result = run_ask(build_fixture(), "What is the offer value?", complete)
    assert calls["n"] == 2
    assert result["retried"] is True
    assert result["citations"] == ["overview.offer_value"]


def test_markdown_and_json_export_include_the_sourced_offer():
    packet = build_fixture()
    markdown = to_markdown(packet, {"target_ticker": "ACME", "acquirer_ticker": "BUYR"})
    assert "# Merger arb analysis: ACME / BUYR" in markdown
    assert "Deal overview" in markdown
    assert "$50.00" in markdown
    assert "https://example.invalid/sample-acme-8k" in markdown
    assert "Spread and implied probability" in markdown
    exported = json.loads(to_json(packet))
    assert exported["packet_meta"]["deal_id"] == "fixture-acme"
    assert exported["sections"]["overview"]["offer_value"]["source"]["type"] == "derived"


def test_ask_and_export_routes_do_not_call_a_paid_model():
    from pathlib import Path
    text = Path(__file__).resolve().parents[1].joinpath("api/domains/merger_arb_analysis.py").read_text()
    ask = text[text.index("def ask"):text.index("def export")]
    export = text[text.index("def export"):text.index("return router", text.index("def export"))]
    assert "complete_refresh" in ask
    assert "call_grok" not in ask
    assert "call_claude" not in ask
    assert "call_grok" not in export
    assert "to_markdown" in export
