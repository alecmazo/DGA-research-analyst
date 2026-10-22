"""Quarterly-letter jobs must finish inside the memos page poll.

SUP_20261021_40e7622c: EM-DEF showed 'timed out — try again' because the
client gave up at 6 minutes while a 10-minute tool loop was still running.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _fn(name: str, until: str) -> str:
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    body = src.split(f"def {name}", 1)[1].split(until, 1)[0]
    return f"def {name}" + body


def test_letter_budget_beats_the_page_poll():
    ns = {"_AGENTIC_MAX_STEPS": 12, "_STRATEGIST_MAX_STEPS": 24}
    exec(_fn("_agentic_limits", "\n_agentic_jobs"), ns)
    limits = ns["_agentic_limits"]
    assert limits("quarterly_letter", "grok") == (4, 240.0)
    assert limits("quarterly_letter", "claude") == (4, 240.0)
    assert limits("strategist", "grok") == (24, 720.0)
    assert limits("agentic", "claude") == (12, 600.0)
    # Forced write is at 90% of the wall. The page polls for 8 minutes.
    assert 240.0 * 0.90 < 8 * 60


def test_activity_block_tickers_stay_in_order():
    ns: dict = {}
    exec(_fn("_qletter_activity_tickers", "\ndef _qletter_thesis_block"), ns)
    text = (
        "  POSITIONS FULLY EXITED this year:\n"
        "    T       sold 10.00 sh for ~$1,000; realized YTD P&L $+10\n"
        "    VZ      sold 2.00 sh for ~$200; realized YTD P&L $-5\n"
        "    BRK.B   sold 1.00 sh for ~$400; realized YTD P&L $+1\n"
    )
    assert ns["_qletter_activity_tickers"](text) == ["T", "VZ", "BRK.B"]


def test_fund_prompt_does_not_require_a_tool_per_name():
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    system = src.split("_QLETTER_FUND_SYSTEM = (", 1)[1].split("\n)\n", 1)[0]
    assert "Do NOT call read_saved_report once per name" in system
    assert "At most one tool call" in system


def test_grok_letter_addon_does_not_restart_the_tool_loop():
    ns: dict = {}
    exec(_fn("_agentic_non_claude_system_addon", "\ndef _agentic_final_write_prompt"), ns)
    addon = ns["_agentic_non_claude_system_addon"]("quarterly_letter", 4, "grok-4")
    assert "Do NOT call read_saved_report" in addon
    assert "Call MULTIPLE tools" not in addon
    assert "What we did here" in addon
    research = ns["_agentic_non_claude_system_addon"]("agentic", 12, "grok-4")
    assert "Call MULTIPLE tools" in research


def test_forced_letter_write_is_the_section_not_a_research_note():
    ns: dict = {}
    exec(_fn("_agentic_final_write_prompt", "\ndef _run_agentic_analysis"), ns)
    prompt = ns["_agentic_final_write_prompt"]("quarterly_letter", "grok", reason="wall")
    assert "What we did here" in prompt
    assert "```sleeve" not in prompt.lower()
    assert "no sleeve json" in prompt.lower()
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    worker = src.split("def _run_agentic_analysis", 1)[1].split(
        'if provider == "claude"', 1)[0]
    assert '"verdict": "skipped"' in worker


def test_letter_stops_after_one_tool_round_and_cannot_read_each_report():
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    kick = src.split("def _qletter_kick", 1)[1].split(
        "def research_quarterly_letter_intro", 1)[0]
    assert '"read_saved_report"' in kick
    # Grok's per-call budget is 180s. Step 1 must be the write.
    assert "step >= 1 or _elapsed >= (_wall_s * 0.90)" in src
    queue = src.split("def _queue_portfolio_strategist", 1)[1].split(
        "def research_portfolio_strategist", 1)[0]
    assert 'not in ("list_portfolios", "get_portfolio_holdings")' in queue
    assert "read_saved_report" not in queue
