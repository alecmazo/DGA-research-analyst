"""Analyst card image attachments. Stdlib helper plus a source pin on the worker."""
import base64
from pathlib import Path

import pytest

from api.domains.analyst_images import (
    analyst_image_content,
    image_system_note,
    normalize_analyst_images,
)

ROOT = Path(__file__).resolve().parents[1]


def _b64(n: int = 40) -> str:
    return base64.b64encode(b"x" * n).decode()


def test_strips_data_url_and_maps_jpg():
    raw = _b64()
    out = normalize_analyst_images([{
        "mime": "image/jpg",
        "data": f"data:image/jpeg;base64,{raw}",
    }])
    assert out == [{"mime": "image/jpeg", "data": raw}]


def test_collapses_whitespace_in_base64():
    raw = _b64()
    spaced = "\n".join(raw[i:i + 8] for i in range(0, len(raw), 8))
    out = normalize_analyst_images([{"mime": "image/png", "data": spaced}])
    assert out[0]["data"] == raw


def test_bad_mime():
    with pytest.raises(ValueError, match="JPEG"):
        normalize_analyst_images([{"mime": "image/svg+xml", "data": _b64()}])


def test_too_small_and_too_large():
    with pytest.raises(ValueError, match="empty"):
        normalize_analyst_images([{"mime": "image/png", "data": _b64(8)}])
    with pytest.raises(ValueError, match="too large"):
        normalize_analyst_images([{"mime": "image/png", "data": _b64(1_500_001)}])


def test_cap_four():
    imgs = [{"mime": "image/webp", "data": _b64()}] * 5
    with pytest.raises(ValueError, match="4"):
        normalize_analyst_images(imgs)


def test_invalid_base64():
    with pytest.raises(ValueError, match="base64"):
        normalize_analyst_images([{"mime": "image/gif", "data": "!!!!not-base64!!!!"}])


def test_none_and_empty_are_no_images():
    assert normalize_analyst_images(None) == []
    assert normalize_analyst_images([]) == []


def test_claude_blocks_then_text():
    raw = _b64()
    blocks = analyst_image_content("what is this", [{"mime": "image/png", "data": raw}], "claude")
    assert blocks[0]["type"] == "image"
    assert blocks[0]["source"]["media_type"] == "image/png"
    assert blocks[0]["source"]["data"] == raw
    assert blocks[-1] == {"type": "text", "text": "what is this"}


def test_openai_text_then_image_url():
    raw = _b64()
    parts = analyst_image_content("read it", [{"mime": "image/jpeg", "data": raw}], "grok")
    assert parts[0] == {"type": "text", "text": "read it"}
    assert parts[1]["type"] == "image_url"
    assert parts[1]["image_url"]["url"] == f"data:image/jpeg;base64,{raw}"


def test_no_images_returns_the_question_string():
    assert analyst_image_content("hello", [], "grok") == "hello"
    assert analyst_image_content("hello", None, "claude") == "hello"


def test_system_note_names_the_count():
    note = image_system_note(2)
    assert "2 images" in note
    assert "Do not invent" in note


def test_server_wires_images_without_storing_them_on_the_job():
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    assert "images: list | None = None" in src
    start = src.split("def research_agentic_start", 1)[1].split(
        "def research_agentic_status", 1)[0]
    assert "normalize_analyst_images" in start
    assert "DeepSeek cannot read pictures" in start
    assert "images or None" in start
    worker = src.split("def _run_agentic_analysis", 1)[1].split(
        "def research_agentic_start", 1)[0]
    assert "analyst_image_content" in worker
    assert "image_system_note" in worker
    assert '"content": user_turn' in worker
    # The polled job dict must not grow an images field.
    assert '"images":' not in start
