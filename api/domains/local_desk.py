"""Local page: Ollama-only research, questions, and portfolio notes.

No paid model is called from here. Company figures come from the financial
store. Recent developments come from Yahoo Finance.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from api.domains.local_finance_llm import (
    check_local_health,
    complete_local,
    local_settings,
)
from api.domains.yahoo_finance_news import fetch_yahoo_finance_news, format_yahoo_news_block

_REPO = Path(__file__).resolve().parents[2]

_KEEP = (
    "period_type", "period_end", "fy", "fp", "revenue", "gross_profit",
    "operating_income", "net_income", "diluted_eps", "eps",
    "operating_cash_flow", "free_cash_flow", "cash", "total_debt",
    "stockholders_equity", "equity",
)


def worktree_info() -> dict:
    branch = ""
    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=_REPO, text=True, timeout=3,
        ).strip()
    except Exception:
        branch = ""
    return {"path": str(_REPO), "branch": branch}


def page_status() -> dict:
    health = check_local_health()
    cfg = local_settings()
    tree = worktree_info()
    return {
        "ok": bool(health.get("ok")),
        "message": health.get("message") or "",
        "model": health.get("model") or cfg["model"],
        "host": cfg["base_url"],
        "enabled": cfg["enabled"],
        "worktree": tree["path"],
        "branch": tree["branch"],
    }


def _slim_row(row: dict) -> dict:
    out = {}
    for key in _KEEP:
        if key in row and row.get(key) not in (None, ""):
            value = row.get(key)
            if hasattr(value, "isoformat"):
                value = value.isoformat()[:10]
            out[key] = value
    return out


def format_store_financials(ticker: str, rows: list | None, error: str = "") -> str:
    tk = (ticker or "").strip().upper()
    if error:
        return f"Financial store error for {tk}: {error}"
    if not rows:
        return f"No rows in the financial store for {tk}."
    annual = [_slim_row(r) for r in rows if str(r.get("period_type") or "") == "annual"][:6]
    quarter = [_slim_row(r) for r in rows if str(r.get("period_type") or "") == "quarter"][:4]
    return json.dumps({
        "ticker": tk,
        "source": "company_financials store",
        "annual": annual,
        "quarter": quarter,
    }, default=str)


def parse_tool_call(text: str) -> dict | None:
    """A tool request is a JSON object and nothing else. Prose is an answer."""
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()
    if not raw.startswith("{") or '"tool"' not in raw[:80]:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not data.get("tool"):
        return None
    return data


def run_local_tools(call: dict, *, rows_fn, platform_fn) -> str:
    name = str(call.get("tool") or "").strip()
    ticker = str(call.get("ticker") or call.get("tickers") or "").strip().upper()
    if name == "company_financials":
        if not ticker:
            return "ticker is required."
        if rows_fn is None:
            return "Financial store is not loaded."
        try:
            rows = rows_fn(ticker, "all") or []
        except Exception as exc:
            return format_store_financials(ticker, None, error=str(exc)[:180])
        return format_store_financials(ticker, rows)
    if name == "yahoo_news":
        if not ticker:
            return "ticker is required."
        items = fetch_yahoo_finance_news(ticker)
        return format_yahoo_news_block(ticker, items)
    if name == "list_portfolios":
        return platform_fn("list_portfolios", {})
    if name == "portfolio_holdings":
        account = str(call.get("portfolio") or call.get("account") or "").strip()
        return platform_fn("get_portfolio_holdings", {"portfolio": account})
    if name == "quote":
        return platform_fn("get_quote", {"tickers": ticker})
    return f"Unknown tool {name}. Use company_financials, yahoo_news, list_portfolios, portfolio_holdings, or quote."


_AGENT_SYSTEM = """You are the local finance analyst on this Mac. You only know what your tools return.
Do not invent financial figures, news, or holdings.

To fetch data, reply with ONLY a JSON object, no markdown:
{"tool":"company_financials","ticker":"AAPL"}
{"tool":"yahoo_news","ticker":"AAPL"}
{"tool":"list_portfolios"}
{"tool":"portfolio_holdings","portfolio":"account name"}
{"tool":"quote","ticker":"AAPL"}

company_financials reads the financial store. yahoo_news is Yahoo Finance.
When you have what you need, answer in markdown. Do not wrap that answer in JSON.
If a tool says data is missing, say so. Cost of this model is $0."""


def run_local_agent(question: str, *, rows_fn=None, platform_fn=None,
                    chat_fn=None) -> dict:
    """Up to four tool steps, then a final answer. Never calls a paid model."""
    q = (question or "").strip()
    if not q:
        return {"ok": False, "error": "Ask a question first."}
    health = check_local_health()
    if not health.get("ok"):
        return {"ok": False, "error": health.get("message") or "Local model offline – start Ollama"}
    chat = chat_fn or (lambda system, user: complete_local(
        system, user, max_tokens=3500, ticker="LOCAL",
    ))
    platform = platform_fn or (lambda name, args: "That tool is not available.")
    transcript = q
    steps: list[dict] = []
    answer = ""
    for _ in range(4):
        try:
            answer = chat(_AGENT_SYSTEM, transcript)
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:300], "steps": steps}
        call = parse_tool_call(answer)
        if not call:
            break
        result = run_local_tools(call, rows_fn=rows_fn, platform_fn=platform)
        steps.append({"tool": call.get("tool"), "ticker": call.get("ticker") or call.get("portfolio")})
        transcript += (
            f"\n\nTOOL {call.get('tool')} RESULT:\n{result[:8000]}\n\n"
            "Use this. Ask for another tool as JSON, or write the markdown answer."
        )
    else:
        try:
            answer = chat(
                _AGENT_SYSTEM,
                transcript + "\n\nWrite the markdown answer now. Do not call a tool.",
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:300], "steps": steps}
    return {"ok": True, "answer": answer, "steps": steps}


def recommend_portfolio(name: str, *, rows_fn=None, platform_fn=None, chat_fn=None) -> dict:
    """One local pass over a real account: holdings, store figures, Yahoo news."""
    account = (name or "").strip()
    if not account:
        return {"ok": False, "error": "Pick a portfolio first."}
    health = check_local_health()
    if not health.get("ok"):
        return {"ok": False, "error": health.get("message") or "Local model offline – start Ollama"}
    platform = platform_fn or (lambda _n, _a: "That tool is not available.")
    holdings = platform("get_portfolio_holdings", {"portfolio": account})
    tickers = re.findall(r"\b[A-Z]{1,5}(?:\.[A-Z])?\b", holdings or "")[:8]
    packets = []
    for tk in tickers:
        if rows_fn is not None:
            try:
                rows = rows_fn(tk, "annual") or []
            except Exception as exc:
                fin = format_store_financials(tk, None, error=str(exc)[:120])
            else:
                fin = format_store_financials(tk, rows)
        else:
            fin = "Financial store is not loaded."
        news = format_yahoo_news_block(tk, fetch_yahoo_finance_news(tk, limit=5))
        packets.append(f"### {tk}\n{fin}\n\n{news}")
    user = (
        f"Review the portfolio '{account}' and recommend what to add, hold, or trim.\n"
        "Use only the holdings, financial-store figures, and Yahoo headlines below. "
        "If a figure is missing, say so. Do not invent news.\n\n"
        f"HOLDINGS:\n{holdings[:12000]}\n\n"
        + "\n\n".join(packets)
    )
    chat = chat_fn or (lambda system, content: complete_local(
        system, content, max_tokens=4000, ticker=account[:12] or "BOOK",
    ))
    try:
        answer = chat(
            "You are the local portfolio analyst. Be concrete. Cost is $0. "
            "No paid-model search.",
            user,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:300]}
    return {"ok": True, "answer": answer, "tickers": tickers}
