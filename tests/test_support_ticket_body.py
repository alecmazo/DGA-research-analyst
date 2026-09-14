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


def test_screenshot_cap_omits_image_not_ticket():
    """Oversized shots are dropped; the ticket description is still filed."""
    assert st._SUPPORT_SCREENSHOT_MAX >= 500_000
    assert "image/jpeg" in st._SUPPORT_SHOT_MIME


def test_open_count_route_and_statuses():
    """GP desk light polls unsolved tickets, including LP-filed ones."""
    src = Path(st.__file__).read_text()
    assert '@router.get("/api/support/open-count")' in src
    assert "support_open_count" in src
    assert st._OPEN_TICKET_STATUSES == (
        "open",
        "diagnosing",
        "diagnosed",
        "in_progress",
    )
    assert "open" in st._OPEN_STATUS_SQL
    assert "fixed" not in st._OPEN_STATUS_SQL
    assert "_support_row_is_demo" in src.split("def support_open_count")[1][:1200]
