"""Support ticket body salvage — description must survive a truncated screenshot."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.domains import support_tickets as st


def test_salvage_description_from_truncated_json():
    desc = "amazon market pulse card has dcf (base) and base price."
    raw = (
        json.dumps({"description": desc})[:-1].encode()
        + b', "screenshot_b64": "'
        + b"A" * 200
    )
    got = st._salvage_ticket_json(raw)
    assert got.get("description") == desc


def test_ticket_description_aliases():
    assert st._ticket_description({"desc": "  hello world there  "}) == "hello world there"
    assert st._ticket_description({"description": "full sentence here"}) == "full sentence here"
    assert st._ticket_description({}) == ""
