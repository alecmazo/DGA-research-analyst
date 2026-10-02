"""GP Grok desk bot — chat + structured site actions (xAI / SpaceXAI)."""
from __future__ import annotations

import json
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["grok-bot"])


class _Bag:
    pass


B = _Bag()

_ALLOWED_PATHS = {
    "/",
    "/financials",
    "/options",
    "/builder",
    "/local",
    "/munger",
    "/gurus",
    "/podcasts",
    "/transcripts",
    "/merger-arb",
    "/positions",
    "/fund",
    "/memos",
    "/settings",
}
_ALLOWED_ACTIONS = {
    "navigate",
    "analyze",
    "open_financials",
    "add_watchlist",
    "open_support",
    "run_daily_pulse",
    "run_market_pulse",
    "open_report",
}
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,11}$")
_RATE: dict[str, list[float]] = {}


def mount(ns: dict) -> None:
    for key in ("app", "_claims_or_401", "_request_json_sync", "analyst"):
        if key in ns:
            setattr(B, key, ns[key])
    ns["app"].include_router(router)


def _gp_only(request: Request) -> dict:
    claims = B._claims_or_401(request)
    if claims.get("role") not in ("gp", "admin"):
        raise HTTPException(403, "GP only")
    return claims


def _rate_ok(key: str, limit: int = 20, window: float = 60.0) -> bool:
    now = time.time()
    bucket = [t for t in _RATE.get(key, []) if now - t < window]
    if len(bucket) >= limit:
        _RATE[key] = bucket
        return False
    bucket.append(now)
    _RATE[key] = bucket
    return True


def _clean_ticker(raw: Any) -> str | None:
    s = str(raw or "").strip().upper()
    if not s or not _TICKER_RE.match(s):
        return None
    return s


def _sanitize_actions(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:8]:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "").strip().lower()
        if kind not in _ALLOWED_ACTIONS:
            continue
        action: dict[str, Any] = {"type": kind}
        if kind == "navigate":
            path = str(item.get("path") or "").strip() or "/"
            if not path.startswith("/"):
                path = "/" + path
            path = path.split("?")[0].rstrip("/") or "/"
            if path not in _ALLOWED_PATHS:
                continue
            action["path"] = path
        elif kind in ("analyze", "open_financials", "add_watchlist", "open_report"):
            tk = _clean_ticker(item.get("ticker"))
            if not tk:
                continue
            action["ticker"] = tk
            if kind == "analyze":
                action["autoRun"] = bool(item.get("autoRun", True))
        elif kind == "open_support":
            note = str(item.get("note") or "").strip()[:400]
            if note:
                action["note"] = note
        out.append(action)
    return out


def _extract_payload(text: str) -> tuple[str, list[dict[str, Any]]]:
    raw = (text or "").strip()
    if not raw:
        return "", []
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw)
    blob = fence.group(1) if fence else None
    if not blob:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            blob = raw[start : end + 1]
    if blob:
        try:
            data = json.loads(blob)
            if isinstance(data, dict) and ("reply" in data or "actions" in data):
                reply = str(data.get("reply") or "").strip()
                return reply or raw, _sanitize_actions(data.get("actions"))
        except Exception:
            pass
    return raw, []


_SYSTEM = """You are Grok, the on-desk assistant inside DGA Capital's GP terminal (portfolio.dgacapital.com/gp).
Alec or Edyta is talking to you from the live site. Help them get work done on this page.

You can answer questions AND propose site actions. Do not invent prices, NAVs, or filings — if you need live numbers, say so or use an action (analyze / financials).

Allowed actions (only these types):
- navigate { "type":"navigate", "path":"/financials" }  paths: / /financials /local /munger /gurus /options /builder /podcasts /transcripts /merger-arb /positions /fund /memos /settings
- analyze { "type":"analyze", "ticker":"AAPL", "autoRun":true }  opens Desk Analyze and runs research
- open_financials { "type":"open_financials", "ticker":"HHH" }
- add_watchlist { "type":"add_watchlist", "ticker":"NVDA" }
- open_report { "type":"open_report", "ticker":"AAPL" }
- run_daily_pulse { "type":"run_daily_pulse" }
- run_market_pulse { "type":"run_market_pulse" }
- open_support { "type":"open_support", "note":"optional" }  files a bug via the Support button

Return ONLY a JSON object (no preamble):
{"reply":"markdown for the user","actions":[ ... ]}
If no action is needed, use "actions":[]. Keep reply concise (under 180 words) unless they ask for depth.
"""


@router.post("/api/grok-bot/chat")
def grok_bot_chat(request: Request) -> dict[str, Any]:
    claims = _gp_only(request)
    if claims.get("demo_mode"):
        raise HTTPException(403, "Demo cannot use the desk bot.")
    email = (claims.get("email") or claims.get("sub") or "gp").lower()
    if not _rate_ok(f"grok-bot:{email}"):
        return JSONResponse(
            {"ok": False, "error": "Slow down — too many Grok bot turns."},
            status_code=429,
        )
    body = B._request_json_sync(request) or {}
    if not isinstance(body, dict):
        body = {}

    message = str(body.get("message") or "").strip()
    if len(message) < 2:
        raise HTTPException(400, "Say what you want Grok to do.")
    if len(message) > 4000:
        raise HTTPException(400, "Keep the task under 4,000 characters.")

    page_path = str(body.get("page_path") or "")[:200]
    page_title = str(body.get("page_title") or "")[:160]
    history = body.get("history") if isinstance(body.get("history"), list) else []
    hist_lines = []
    for turn in history[-12:]:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "").lower()
        if role not in ("user", "assistant"):
            continue
        text = str(turn.get("content") or "").strip()[:1500]
        if text:
            hist_lines.append(f"{role}: {text}")

    user_block = (
        f"Current page: {page_title or 'GP'} · {page_path or '/gp'}\n"
        f"User: {claims.get('name') or ''} <{claims.get('email') or ''}>\n"
    )
    if hist_lines:
        user_block += "Recent chat:\n" + "\n".join(hist_lines) + "\n\n"
    user_block += f"New task:\n{message}"

    try:
        raw = B.analyst.call_llm("grok", _SYSTEM, user_block, live_search=False)
    except Exception as exc:
        raise HTTPException(502, f"Grok unavailable: {exc!s:.180}") from exc

    reply, actions = _extract_payload(str(raw or ""))
    if not reply:
        reply = "I heard you — try again in a moment."
    return {
        "ok": True,
        "reply": reply[:8000],
        "actions": actions,
        "model": getattr(B.analyst, "GROK_MODEL", None) or "grok",
    }
