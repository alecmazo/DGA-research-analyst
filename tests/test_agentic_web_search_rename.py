"""Grok rejects a client tool named web_search (native collision → HTTP 400)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _agentic_tools() -> list:
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    block = src.split("_AGENTIC_TOOLS = [", 1)[1].split(
        "\ndef _llm_api_error_text", 1)[0]
    ns: dict = {}
    exec("_AGENTIC_TOOLS = [" + block, ns)  # noqa: S102
    return ns["_AGENTIC_TOOLS"]


def test_agentic_tools_do_not_collide_with_native_web_search():
    names = [t.get("name") for t in _agentic_tools()]
    assert "web_search" not in names
    assert "search_web" in names


def test_llm_api_error_text_reads_xai_string_body():
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    body = src.split("def _llm_api_error_text", 1)[1].split(
        "\ndef _safe_arith", 1)[0]
    ns: dict = {"BaseException": BaseException}
    exec("def _llm_api_error_text" + body, ns)  # noqa: S102
    fn = ns["_llm_api_error_text"]

    class Fake(Exception):
        def __init__(self):
            super().__init__("Error code: 400")
            self.message = "Error code: 400"
            self.body = "Duplicate tool names: web_search"

    assert "Duplicate tool names" in fn(Fake())
    assert 'WEB_BUILD_VERSION = "ui830-20261117-brief-read"' in src
