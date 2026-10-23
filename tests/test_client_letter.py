"""Client letter voice follows the audience. Send waits for the button."""
from pathlib import Path

from api.domains.client_letter import (
    MemoryStore,
    draft_letter,
    letter_prompt,
    mail_connected,
    presentation_body,
    save_letter,
    send_letter,
    start_presentation,
    AUDIENCES,
)

ROOT = Path(__file__).resolve().parents[1]

BOOK = {
    "fund_id": "acct-1",
    "name": "Sample account",
    "holdings": [
        {"ticker": "AAPL", "weight_pct": 12.5, "thesis": "Owns the phone franchise."},
        {"ticker": "XYZ", "weight_pct": 4, "thesis": ""},
    ],
    "trades": "    AAPL    still held.",
    "market": "S&P 500 at 5,800, +0.4% on the day",
}


def test_audience_profile_changes_the_prompt():
    retiree_system, retiree_user = letter_prompt("retiree", BOOK)
    school_system, school_user = letter_prompt("school", BOOK)
    assert retiree_system != school_system
    assert "someone living on this account" in retiree_system.lower()
    assert "a school that depends on this account" in school_system.lower()
    assert "Sample account" in retiree_user
    assert "AAPL" in retiree_user
    assert "No thesis is saved for XYZ" in retiree_user
    assert "S&P 500" in retiree_user
    assert "Do not invent a client name" in retiree_user
    voices = [letter_prompt(key, BOOK)[0] for key in AUDIENCES]
    assert len(set(voices)) == len(AUDIENCES)
    for key in ("principal", "foundation", "trustee"):
        assert key in AUDIENCES
        assert AUDIENCES[key]["voice"] not in retiree_system


def test_save_does_not_email_until_send():
    store = MemoryStore()
    calls: list[dict] = []

    def deliver(row):
        calls.append(row)
        return {"ok": True, "sent": 1}

    saved = save_letter(
        store,
        fund_id="acct-1",
        fund_name="Sample account",
        audience="retiree",
        model="grok",
        body="Hello from the book.",
    )
    assert saved["emailed"] is False
    assert saved["sent_at"] is None
    assert calls == []

    quiet = send_letter(store, saved["id"], connected=False, deliver=deliver)
    assert calls == []
    assert quiet["emailed"] is False
    assert "not connected" in quiet["detail"].lower()

    sent = send_letter(store, saved["id"], connected=True, deliver=deliver)
    assert len(calls) == 1
    assert calls[0]["body"] == "Hello from the book."
    assert sent["emailed"] is True
    assert sent["sent"] == 1
    assert store.get(saved["id"])["sent_at"]


def test_save_keeps_a_sent_letter_sent_and_stores_the_date():
    store = MemoryStore()
    saved = save_letter(
        store,
        fund_id="acct-1",
        fund_name="Sample account",
        audience="retiree",
        model="grok",
        body="Hello from the book.",
        letter_date="2026-10-23",
    )
    assert store.get(saved["id"])["letter_date"] == "2026-10-23"
    assert store.get(saved["id"])["status"] == "draft"
    store.mark_sent(saved["id"])
    save_letter(
        store,
        fund_id="acct-1",
        fund_name="Sample account",
        audience="retiree",
        model="grok",
        body="Hello from the book, revised.",
        letter_id=saved["id"],
        letter_date="2026-10-23",
    )
    kept = store.get(saved["id"])
    assert kept["status"] == "sent"
    assert kept["sent_at"]
    assert kept["letter_date"] == "2026-10-23"


def test_cloud_draft_stores_without_emailing_and_local_stays_in_the_browser():
    store = MemoryStore()

    def complete(provider, system, user):
        assert provider == "grok"
        assert "Sample account" in user
        return "The book held AAPL."

    drafted = draft_letter(
        store, audience="school", book=BOOK, provider="grok", complete=complete,
    )
    assert drafted["emailed"] is False
    assert drafted["body"] == "The book held AAPL."
    assert store.get(drafted["id"])["sent_at"] is None

    def explode(*_args, **_kwargs):
        raise AssertionError("local draft called a cloud model")

    local = draft_letter(
        store, audience="trustee", book=BOOK, provider="local", complete=explode,
    )
    assert local["local"] is True
    assert local["emailed"] is False
    assert "XYZ" in local["user"]
    assert "id" not in local


def test_presentation_uses_the_gamma_shape_and_stays_off_without_a_key():
    body = presentation_body("Hello from the book.")
    assert body["textMode"] == "generate"
    assert body["format"] == "presentation"
    assert body["numCards"] == 8
    assert body["exportAs"] == "pptx"
    assert "Hello from the book." in body["inputText"]

    def post(_body, _key):
        raise AssertionError("Gamma was called")

    waiting = start_presentation("Hello from the book.", api_key="", post=post)
    assert waiting["connected"] is False
    assert waiting.get("generation_id") in (None, "")
    assert "presentation" in waiting["detail"].lower()


def test_letter_module_does_not_call_ollama(monkeypatch):
    src = (ROOT / "api" / "domains" / "client_letter.py").read_text(encoding="utf-8")
    assert "127.0.0.1" not in src
    assert "ollama" not in src.lower()
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("GMAIL_USER", raising=False)
    monkeypatch.delenv("GMAIL_APP_PASSWORD", raising=False)
    assert mail_connected() is False
