"""OpenAI-compatible tool fields for the Analyst and Strategist.

xAI returns HTTP 400 when ``tool_choice`` is set and ``tools`` is missing
or empty: "A tool_choice was set on the request but no tools were specified."
"""
from __future__ import annotations


def bind_oai_tools(tools: list | None, choice: str | None) -> dict:
    """Return tools plus tool_choice, or nothing when there is no tool list.

    ``choice`` of ``"none"`` still needs the tool list. Omitting the list
    and sending only tool_choice is what Grok rejects.
    """
    usable = [t for t in (tools or []) if isinstance(t, dict) and t]
    picked = (choice or "").strip()
    if not usable or not picked:
        return {}
    return {"tools": usable, "tool_choice": picked}
