"""Local Ollama provider for the investment-case analysis.

Talks to the OpenAI-compatible endpoint on this machine. It never calls a
paid model. Reasoning text is logged and kept out of the answer.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

OFFLINE_MESSAGE = "Local model offline – start Ollama"
NUM_CTX = 32768
OUTPUT_RESERVE_TOKENS = 12000


class LocalLlmError(RuntimeError):
    """The local model did not answer. Do not fall back to a paid provider."""


def is_model_refusal(text: str | None) -> bool:
    """True when the local model returned a one-line refusal instead of a note."""
    raw = (text or "").strip()
    if not raw or len(raw) > 800:
        return False
    low = raw.lower().replace("’", "'")
    needles = (
        "i'm sorry",
        "i am sorry",
        "can't comply",
        "cannot comply",
        "can't continue",
        "cannot continue",
        "can't assist",
        "cannot assist",
        "can't help with that",
        "cannot help with that",
    )
    return any(n in low for n in needles)


LOCAL_NOTE_SYSTEM = """You are DGA Capital's research analyst. Write the equity note now, in markdown.
The first line is the cover table. A long note is the assignment.
Do not plan first, do not apologize, and do not stop because the note is long.

You have no web search and no X search. Do not try to call them.
Every figure comes from the user message. If a figure is absent, write N/A.
Do not fill from memory. Any assumption you must make (growth, WACC, the
price target) is marked (E) and the assumption is one sentence.
Copy fiscal-year labels and period-end dates exactly as printed.
Table cells are numbers or N/A, never adjectives.
Headings are ATX headings (# Section 1 — …). Tables are GitHub-flavored
markdown. News bullets use only headlines in the user message that are
about this ticker. Skip headlines about other companies.

Write these sections, in order, then stop:

# Cover
Table: company, ticker, date, price, previous close, market cap, rating
(Strong Buy, Buy, Hold, or Sell), 12-month price target, upside versus
the price in the user message, and one-sentence thesis.

# Section 1 — Investment summary
One paragraph with the rating, the target, and the single main reason.
Then three short reasons. Then a 30-second pitch.

# Section 2 — Recent developments
Bullets, newest first, drawn only from the headline block. Each bullet
starts with the date already printed and cites the source and URL already
printed. If the block is empty, write "No headlines in the packet."
Do not add events from memory.

# Section 3 — Where we differ from the Street
Use ANALYST_RATINGS_BLOCK and CONSENSUS_SUMMARY if they are present.
If they are absent, write "No ratings block in the packet." Do not invent
a firm, a rating, or a target.

# Section 4 — Business overview
What the company does, how it makes money, and the moat. Stay inside
what the filing packet supports.

# Section 5 — Financials
Copy the annual table, the quarterly table when the packet says 10-Q,
and the balance-sheet table. Use the TTM row as printed. Do not
recompute it.

# Section 6 — Growth
Only the trajectory that is visible in the printed rows.

# Section 7 — Valuation
One DCF: state the (E) assumptions, show the bridge to a per-share
value, and say how that relates to the 12-month target.
Then copy the comparable-company table from the user message. Do not
add peers. Do not relabel those figures as forward estimates.

# Section 8 — Bull, base, bear
Three cases with a probability and a price. State the weighted value.
The 12-month target has to agree with it.

# Section 9 — Risks
The material risks supported by the filings and the headlines in the
packet. No generic macro sentence without a number from the packet.

# Section 10 — Catalysts
Only dates and events present in the packet.

# Sources
Name the SEC filing cited in the packet, the market-data fields, and
the headline source. Nothing else.

Do not write a Munger section. Do not write an institutional-holders
table. Those are not part of this call.
"""

# Kept so an older caller that retries with this name still gets the note prompt.
LOCAL_RETRY_SYSTEM = LOCAL_NOTE_SYSTEM


def munger_section_instructions(*, standalone: bool) -> str:
    """Compact Section 8.5. The fifty rule titles stay; the philosophy essay does not.

    ``standalone`` is the local model's second call: the note already exists.
    Grok and Claude get ``standalone=False`` appended to the desk prompt.
    """
    try:
        import munger_fifty
        rules = munger_fifty.prompt_list()
    except Exception:
        rules = ""
    if standalone:
        lead = (
            "The equity note is already written in the user message. "
            "Write only the Munger section. Do not rewrite the note, "
            "do not apologize, and do not add a holders table. "
            "Begin with the heading.\n\n"
        )
    else:
        lead = (
            "After the verdict and before the sources, write this section. "
            "Do not skip it and do not fold it into the verdict. "
            "Do not add a holders table inside it.\n\n"
        )
    return (
        lead
        + "SECTION 8.5 — CHARLIE MUNGER LATTICEWORK\n\n"
        "Apply this to the company in the note: invert, stay inside the circle "
        "of competence, demand a margin of safety, and map incentives. Prefer "
        "avoiding a stupidity over adding a story. No biography of Munger.\n\n"
        "### 8.5.1 Circle of Competence\n"
        "Is this business inside a disciplined investor's circle? What is hard "
        "to understand? Name any part that belongs in the too-hard pile.\n\n"
        "### 8.5.2 Invert — How This Loses Money\n"
        "The concrete ways this investment permanently impairs capital. What "
        "would make you walk away?\n\n"
        "### 8.5.3 Moat, Incentives & Two-Track Analysis\n"
        "Is the advantage durable? One paragraph on management, employee, and "
        "customer incentives. One paragraph on the economics, one on the psychology.\n\n"
        "### 8.5.4 Latticework & Lollapalooza\n"
        "Which forces stack. Say whether the stack is good or bad for the owner.\n\n"
        "### 8.5.5 Psychology Checklist\n"
        "Name 3 of the standard misjudgment tendencies that matter here, and who "
        "they are acting on (management, the market, or the analyst).\n\n"
        "### 8.5.6 Investment Labels\n"
        "One primary label, and any secondary, from: "
        "TOO HARD · HOMERUN · SIT-ON-YOUR-ASS · WONDERFUL BUSINESS AT FAIR PRICE · "
        "FAIR BUSINESS AT WONDERFUL PRICE · AVOID · MARGIN OF SAFETY ADEQUATE · "
        "MARGIN OF SAFETY INADEQUATE\n\n"
        "### 8.5.7 What Munger Would Likely Do\n"
        "buy, pass, or too-hard. One reason. One stupidity to avoid.\n\n"
        "Cite exactly 3 rules from the list below. Each citation is its own line, "
        "exactly `Rule N — Title`, then two to four sentences on this company. "
        "Use the number and title as written. Do not cite a rule you do not apply. "
        "Use only figures that are already in the note or the user message. "
        "Do not invent any.\n\n"
        + rules
        + "\n"
    )


def local_munger_user(note: str) -> str:
    """User message for the local model's second call."""
    return (
        "The equity note is below. Write only Section 8.5 from it. "
        "Do not repeat the note.\n\n"
        + (note or "").strip()
    )


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def local_enabled() -> bool:
    return _env("LOCAL_LLM_ENABLED", "true").lower() not in ("0", "false", "no", "off")


def local_settings() -> dict:
    timeout_ms = int(_env("LOCAL_LLM_TIMEOUT_MS", "300000"))
    timeout_ms = max(300_000, timeout_ms)
    base = _env("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    return {
        "enabled": local_enabled(),
        "base_url": base,
        "model": _env("LOCAL_LLM_MODEL", "gpt-oss-20b-finance"),
        "timeout_s": timeout_ms / 1000.0,
        "num_ctx": NUM_CTX,
        "max_tokens": int(_env("LOCAL_LLM_MAX_TOKENS", "12000")),
        # Medium reasoning on this model spends the whole output budget
        # before it writes the report. Low leaves room for the answer.
        "think": _env("LOCAL_LLM_THINK", "low"),
    }


def _host_root(base_url: str) -> str:
    root = base_url.rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3]
    return root


def check_local_health(timeout: float = 5.0) -> dict:
    """Confirm Ollama is up and the finance model is installed."""
    cfg = local_settings()
    if not cfg["enabled"]:
        return {
            "ok": False,
            "message": "Local finance model is disabled (LOCAL_LLM_ENABLED=false)",
            "model": cfg["model"],
        }
    url = _host_root(cfg["base_url"]) + "/api/tags"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace") or "{}")
    except Exception as exc:
        return {
            "ok": False,
            "message": OFFLINE_MESSAGE,
            "detail": str(exc)[:200],
            "model": cfg["model"],
        }
    names = []
    for row in payload.get("models") or []:
        if isinstance(row, dict) and row.get("name"):
            names.append(str(row["name"]))
    wanted = cfg["model"]
    present = any(n == wanted or n.split(":")[0] == wanted or n.startswith(wanted + ":") for n in names)
    if not present:
        return {
            "ok": False,
            "message": f"Local model {wanted} is not installed in Ollama",
            "models": names,
            "model": wanted,
        }
    return {"ok": True, "message": "ok", "model": wanted, "models": names}


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def fit_local_context(user_content: str, *, num_ctx: int = NUM_CTX,
                       reserve_tokens: int = OUTPUT_RESERVE_TOKENS) -> tuple[str, str]:
    """Trim only when the prompt would exceed the local context window.

    Oldest news lines go first, then the least recent FY rows. Returns
    (text, note). The note is empty when nothing was removed.
    """
    budget_tokens = max(1, int(num_ctx) - int(reserve_tokens))
    text = user_content or ""
    if _estimate_tokens(text) <= budget_tokens:
        return text, ""
    dropped_news = 0
    dropped_fy: list[str] = []
    lines = text.split("\n")
    news_at = next((i for i, line in enumerate(lines) if line.startswith("=== FREE CATALYST HEADLINES")), None)

    def _over() -> bool:
        return _estimate_tokens("\n".join(lines)) > budget_tokens

    if news_at is not None:
        while _over():
            idx = None
            for i in range(len(lines) - 1, news_at, -1):
                if lines[i].startswith("- ["):
                    idx = i
                    break
            if idx is None:
                break
            del lines[idx]
            if idx < len(lines) and lines[idx].startswith("  ") and not lines[idx].startswith("- ["):
                del lines[idx]
            dropped_news += 1
    while _over():
        fy_indexes = []
        for i, line in enumerate(lines):
            if line.startswith("FY") and "|" in line:
                year = ""
                head = line.split("|", 1)[0].strip()
                digits = "".join(ch for ch in head if ch.isdigit())
                year = digits[:4]
                fy_indexes.append((year or "9999", i))
        if len(fy_indexes) <= 1:
            break
        fy_indexes.sort()
        _year, idx = fy_indexes[0]
        dropped_fy.append(lines[idx].split("|", 1)[0].strip())
        del lines[idx]
    trimmed = "\n".join(lines)
    bits = []
    if dropped_news:
        bits.append(f"dropped {dropped_news} oldest news item(s)")
    if dropped_fy:
        bits.append("dropped least recent filing rows " + ", ".join(dropped_fy))
    note = ""
    if bits:
        note = (
            f"[local] context trimmed to fit {num_ctx} tokens "
            f"(input budget {budget_tokens}): " + "; ".join(bits)
        )
        print("   " + note, flush=True)
    elif _estimate_tokens(trimmed) > budget_tokens:
        note = (
            f"[local] context still over budget after trim "
            f"(~{_estimate_tokens(trimmed)} tokens > {budget_tokens})"
        )
        print("   " + note, flush=True)
    return trimmed, note


def dump_prompt_if_debug(provider: str, system_prompt: str, user_content: str,
                         *, ticker: str = "") -> str | None:
    """Write the exact prompt when LLM_DEBUG_CONTEXT=true. Returns the path."""
    flag = os.environ.get("LLM_DEBUG_CONTEXT", "").strip().lower()
    if flag not in ("1", "true", "yes", "on"):
        return None
    root = Path(__file__).resolve().parents[2] / "logs" / "llm-context"
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = f"{stamp}_{(ticker or 'prompt').upper()}_{(provider or 'llm').lower()}.txt"
    path = root / name
    body = (
        f"provider: {provider}\n"
        f"ticker: {ticker}\n"
        f"system_chars: {len(system_prompt or '')}\n"
        f"user_chars: {len(user_content or '')}\n"
        f"est_tokens: {_estimate_tokens((system_prompt or '') + (user_content or ''))}\n"
        "\n===== SYSTEM =====\n"
        f"{system_prompt or ''}\n"
        "\n===== USER =====\n"
        f"{user_content or ''}\n"
    )
    path.write_text(body, encoding="utf-8")
    print(f"   [llm-debug] wrote {path}", flush=True)
    return str(path)


def _delta_text(delta: dict) -> tuple[str, str]:
    """Split a stream delta into (answer, reasoning). Reasoning is not shown."""
    if not isinstance(delta, dict):
        return "", ""
    reasoning = (
        delta.get("reasoning")
        or delta.get("reasoning_content")
        or ""
    )
    answer = delta.get("content") or ""
    if not isinstance(reasoning, str):
        reasoning = ""
    if not isinstance(answer, str):
        answer = ""
    return answer, reasoning


def complete_local(system_prompt: str, user_content: str, *, on_delta=None,
                   usage_capture=None, should_cancel=None, ticker: str = "",
                   max_tokens: int | None = None) -> str:
    """Stream one completion from gpt-oss-20b-finance. Raises LocalLlmError."""
    cfg = local_settings()
    if max_tokens:
        cfg["max_tokens"] = max(256, min(int(max_tokens), 20000))
    if not cfg["enabled"]:
        raise LocalLlmError("Local finance model is disabled (LOCAL_LLM_ENABLED=false)")
    if should_cancel is not None and should_cancel():
        raise LocalLlmError("cancelled before local LLM call")
    health = check_local_health()
    if not health.get("ok"):
        raise LocalLlmError(health.get("message") or OFFLINE_MESSAGE)

    user_content, _trim = fit_local_context(user_content, num_ctx=cfg["num_ctx"])
    dump_prompt_if_debug("local", system_prompt, user_content, ticker=ticker)
    filings_chars = len(user_content)
    news_at = user_content.find("=== FREE CATALYST HEADLINES")
    news_chars = len(user_content) - news_at if news_at >= 0 else 0
    if news_at >= 0:
        filings_chars = news_at
    news_items = user_content.count("\n- [")
    print(
        f"   [local] context filings_chars={filings_chars:,} "
        f"news_chars={news_chars:,} news_items={news_items} "
        f"est_tokens={_estimate_tokens(system_prompt + user_content):,} "
        f"num_ctx={cfg['num_ctx']} max_tokens={cfg['max_tokens']} "
        f"think={cfg['think']} model={cfg['model']}",
        flush=True,
    )

    # The OpenAI-compatible endpoint ignores num_ctx, so a 18k-token filing
    # prompt was cut to ~2k tokens. Native /api/chat is the same model and
    # the only call that keeps the context window.
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": system_prompt or ""},
            {"role": "user", "content": user_content or ""},
        ],
        "stream": True,
        "think": cfg["think"],
        "keep_alive": "30m",
        "options": {
            "num_ctx": cfg["num_ctx"],
            "num_predict": cfg["max_tokens"],
            "temperature": 0.2,
        },
    }
    url = _host_root(cfg["base_url"]) + "/api/chat"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    parts: list[str] = []
    reasoning_parts: list[str] = []
    usage = None
    finish_reason = None
    try:
        resp = urllib.request.urlopen(req, timeout=cfg["timeout_s"])
    except urllib.error.URLError as exc:
        raise LocalLlmError(OFFLINE_MESSAGE) from exc
    except Exception as exc:
        raise LocalLlmError(OFFLINE_MESSAGE) from exc

    try:
        with resp:
            for raw in resp:
                if should_cancel is not None and should_cancel():
                    raise LocalLlmError("cancelled during local LLM call")
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                message = event.get("message") or {}
                answer = message.get("content") or ""
                reasoning = message.get("thinking") or message.get("reasoning") or ""
                if reasoning:
                    reasoning_parts.append(reasoning)
                if answer:
                    parts.append(answer)
                    if on_delta is not None:
                        try:
                            on_delta(answer)
                        except Exception:
                            pass
                if event.get("done"):
                    finish_reason = event.get("done_reason") or "stop"
                    eval_count = int(event.get("eval_count") or 0)
                    eval_ns = int(event.get("eval_duration") or 0)
                    usage = {
                        "prompt_tokens": int(event.get("prompt_eval_count") or 0),
                        "completion_tokens": eval_count,
                        "tokens_per_sec": (eval_count / (eval_ns / 1e9)) if eval_ns else None,
                    }
                    break
    except LocalLlmError:
        raise
    except Exception as exc:
        text = "".join(parts).strip()
        if len(text) > 800:
            print(f"   [local] stream ended early, keeping {len(text):,} chars ({exc!s:.120})", flush=True)
        else:
            raise LocalLlmError(f"Local model failed: {exc!s:.200}") from exc

    text = "".join(parts).strip()
    reasoning = "".join(reasoning_parts).strip()
    elapsed = max(0.001, time.perf_counter() - started)
    if reasoning:
        print(f"   [local] reasoning logged ({len(reasoning):,} chars), not shown", flush=True)
    prompt_tokens = int((usage or {}).get("prompt_tokens") or _estimate_tokens(system_prompt + user_content))
    completion_tokens = int((usage or {}).get("completion_tokens") or max(1, len(text) // 4))
    measured = (usage or {}).get("tokens_per_sec")
    tok_s = float(measured) if measured else completion_tokens / elapsed
    latency_ms = int(elapsed * 1000)
    print(
        f"   [local] done chars={len(text):,} in {elapsed:.1f}s "
        f"~{tok_s:.1f} tok/s cost=$0",
        flush=True,
    )
    if usage_capture is not None:
        try:
            usage_capture({
                "model": cfg["model"],
                "input_tokens": prompt_tokens,
                "output_tokens": completion_tokens,
                "cached_input_tokens": 0,
                "cost_usd": 0.0,
                "cost_estimated": False,
                "tokens_per_sec": round(tok_s, 2),
                "latency_ms": latency_ms,
            })
        except Exception:
            pass
    if not text:
        if finish_reason == "length":
            raise LocalLlmError(
                "Local model used the output budget on reasoning and did not "
                "write the report. Set LOCAL_LLM_THINK=low or raise "
                "LOCAL_LLM_MAX_TOKENS."
            )
        raise LocalLlmError("Local model returned an empty answer")
    return text
