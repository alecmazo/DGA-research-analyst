"""Grok rejects tool_choice when the request has no tools."""
from pathlib import Path

from api.domains.agentic_oai import bind_oai_tools

ROOT = Path(__file__).resolve().parents[1]


def test_tool_choice_is_omitted_when_there_are_no_tools():
    assert bind_oai_tools([], "none") == {}
    assert bind_oai_tools(None, "auto") == {}
    assert bind_oai_tools([{}], "auto") == {}
    assert bind_oai_tools([{"type": "function"}], "") == {}


def test_tool_choice_none_keeps_the_tool_list():
    tools = [{"type": "function", "function": {"name": "get_quote"}}]
    bound = bind_oai_tools(tools, "none")
    assert bound["tools"] == tools
    assert bound["tool_choice"] == "none"


def test_agentic_retry_reads_the_xai_error_body():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    start = src.index("def _run_agentic_analysis")
    chunk = src[start:start + 25000]
    assert "bind_oai_tools(oai_tools, _tool_choice)" in chunk
    assert 'create_kw["tool_choice"] = "none"' not in chunk
    assert "_llm_api_error_text(_oe" in chunk
