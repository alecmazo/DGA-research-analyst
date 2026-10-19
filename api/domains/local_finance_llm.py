"""Local Ollama provider for the investment-case analysis.

Talks to the OpenAI-compatible endpoint on this machine. It never calls a
paid model. Reasoning text is logged and kept out of the answer.
"""

from __future__ import annotations

import json
import os
import re
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


DEFAULT_LOCAL_MODEL = "gpt-oss-20b-finance"
DEFAULT_LOCAL_MODELS = "gpt-oss-20b-finance,gemma4:26b,gemma4:12b"
DEFAULT_FAST_MODEL = "gemma4:12b"
DEFAULT_EMBED_PROVIDER = "openai"
DEFAULT_EMBED_MODEL = "text-embedding-3-small"


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def local_enabled() -> bool:
    return _env("LOCAL_LLM_ENABLED", "true").lower() not in ("0", "false", "no", "off")


def local_model_list() -> list[str]:
    """Configured selectable local chat models (LOCAL_LLM_MODELS)."""
    raw = _env("LOCAL_LLM_MODELS", DEFAULT_LOCAL_MODELS)
    out: list[str] = []
    for part in raw.split(","):
        name = part.strip()
        if name and name not in out:
            out.append(name)
    if DEFAULT_LOCAL_MODEL not in out:
        out.insert(0, DEFAULT_LOCAL_MODEL)
    return out or [DEFAULT_LOCAL_MODEL]


def _model_installed(wanted: str, installed_names: list[str]) -> bool:
    """True when Ollama lists this model (with or without a :tag suffix)."""
    wanted = (wanted or "").strip()
    if not wanted:
        return False
    for n in installed_names:
        if n == wanted or n.split(":")[0] == wanted or n.startswith(wanted + ":"):
            return True
        # Allow matching "gemma4:26b" against "gemma4:26b-a4b-it-qat"
        if ":" in wanted and n.startswith(wanted.split(":")[0] + ":"):
            tag = wanted.split(":", 1)[1]
            rest = n.split(":", 1)[1]
            if rest == tag or rest.startswith(tag + "-") or rest.startswith(tag + ":"):
                return True
    return False


def local_model(name: str | None = None) -> str:
    """One source of truth for the active local chat model.

    ``name`` is an optional per-request override. It must be in
    ``LOCAL_LLM_MODELS``. With no name, returns ``LOCAL_LLM_MODEL``
    (default ``gpt-oss-20b-finance``).
    """
    allowed = local_model_list()
    wanted = (name or "").strip() or _env("LOCAL_LLM_MODEL", DEFAULT_LOCAL_MODEL)
    if wanted in allowed:
        return wanted
    for m in allowed:
        if wanted == m or wanted.startswith(m + ":") or m.startswith(wanted + ":"):
            return m
    if name is not None and str(name).strip():
        raise ValueError(
            f"local_model must be one of: {', '.join(allowed)}"
        )
    if DEFAULT_LOCAL_MODEL in allowed:
        return DEFAULT_LOCAL_MODEL
    return allowed[0]


def local_fast_model() -> str:
    """Model for structured JSON extraction (LOCAL_LLM_FAST_MODEL)."""
    wanted = _env("LOCAL_LLM_FAST_MODEL", DEFAULT_FAST_MODEL)
    try:
        return local_model(wanted)
    except ValueError:
        return local_model(None)


def local_settings(*, model: str | None = None) -> dict:
    timeout_ms = int(_env("LOCAL_LLM_TIMEOUT_MS", "300000"))
    timeout_ms = max(300_000, timeout_ms)
    base = _env("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    return {
        "enabled": local_enabled(),
        "base_url": base,
        "model": local_model(model),
        "fast_model": local_fast_model(),
        "models": local_model_list(),
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
    """Confirm Ollama is up and report each configured model as installed or missing."""
    cfg = local_settings()
    if not cfg["enabled"]:
        return {
            "ok": False,
            "message": "Local finance model is disabled (LOCAL_LLM_ENABLED=false)",
            "model": cfg["model"],
            "models": cfg["models"],
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
            "models": cfg["models"],
        }
    names = []
    for row in payload.get("models") or []:
        if isinstance(row, dict) and row.get("name"):
            names.append(str(row["name"]))
    configured = []
    for m in cfg["models"]:
        configured.append({
            "model": m,
            "installed": _model_installed(m, names),
        })
    wanted = cfg["model"]
    present = _model_installed(wanted, names)
    missing = [c["model"] for c in configured if not c["installed"]]
    if not present:
        return {
            "ok": False,
            "message": f"Local model {wanted} is not installed in Ollama",
            "models": names,
            "model": wanted,
            "configured": configured,
            "missing": missing,
        }
    return {
        "ok": True,
        "message": "ok",
        "model": wanted,
        "models": names,
        "configured": configured,
        "missing": missing,
    }


def embed_settings() -> dict:
    """Active embedding provider/model. Default matches the live OpenAI path."""
    provider = _env("EMBED_PROVIDER", DEFAULT_EMBED_PROVIDER).lower()
    if provider not in ("openai", "ollama"):
        provider = DEFAULT_EMBED_PROVIDER
    model = _env("EMBED_MODEL", DEFAULT_EMBED_MODEL)
    if provider == "ollama" and not os.environ.get("EMBED_MODEL", "").strip():
        model = "nomic-embed-text"
    return {
        "provider": provider,
        "model": model,
        "base_url": _env("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/"),
    }


def embed_model_slug(model: str | None = None) -> str:
    """Safe suffix for a per-model call_chunks table name."""
    raw = (model or embed_settings()["model"] or DEFAULT_EMBED_MODEL).strip()
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", raw).strip("_").lower()
    return slug or "default"


def call_chunks_table(model: str | None = None, *, provider: str | None = None) -> str:
    """Postgres table for one embedding model. Default keeps the live index.

    The live OpenAI ``text-embedding-3-small`` index stays in ``call_chunks``.
    Every other provider/model uses ``call_chunks__<slug>`` so A/B indexes
    never overwrite or delete the existing rows.
    """
    cfg = embed_settings()
    prov = (provider or cfg["provider"] or DEFAULT_EMBED_PROVIDER).lower()
    model_name = (model if model is not None else cfg["model"] or DEFAULT_EMBED_MODEL).strip()
    if prov == "openai" and model_name == DEFAULT_EMBED_MODEL:
        return "call_chunks"
    return f"call_chunks__{embed_model_slug(model_name)}"


def embed_texts(texts: list[str], *, model: str | None = None,
                provider: str | None = None) -> list[list[float]]:
    """Embed texts via OpenAI or Ollama. Same shapes as the live path."""
    if not texts:
        return []
    cfg = embed_settings()
    prov = (provider or cfg["provider"] or DEFAULT_EMBED_PROVIDER).lower()
    model_name = (model if model is not None else cfg["model"] or DEFAULT_EMBED_MODEL).strip()
    if prov == "ollama":
        return _embed_texts_ollama(texts, model=model_name, base_url=cfg["base_url"])
    return _embed_texts_openai(texts, model=model_name)


def _embed_texts_openai(texts: list[str], *, model: str) -> list[list[float]]:
    from openai import OpenAI
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=key)
    out: list[list[float]] = []
    for i in range(0, len(texts), 96):
        batch = [t[:8000] for t in texts[i:i + 96]]
        resp = client.embeddings.create(model=model, input=batch)
        out.extend([d.embedding for d in resp.data])
    return out


def _embed_texts_ollama(texts: list[str], *, model: str, base_url: str) -> list[list[float]]:
    """Ollama /api/embed (preferred) with /v1/embeddings fallback."""
    root = _host_root(base_url)
    out: list[list[float]] = []
    for text in texts:
        chunk = (text or "")[:8000]
        vec = _ollama_embed_one(root, model, chunk)
        out.append(vec)
    return out


def _ollama_embed_one(root: str, model: str, text: str) -> list[float]:
    # Native Ollama embed API first.
    payload = json.dumps({"model": model, "input": text}).encode("utf-8")
    req = urllib.request.Request(
        root + "/api/embed",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8", "replace") or "{}")
        embeddings = body.get("embeddings")
        if isinstance(embeddings, list) and embeddings:
            first = embeddings[0]
            if isinstance(first, list) and first:
                return [float(x) for x in first]
        single = body.get("embedding")
        if isinstance(single, list) and single:
            return [float(x) for x in single]
    except Exception:
        pass
    # OpenAI-compatible fallback on the same host.
    payload = json.dumps({"model": model, "input": text}).encode("utf-8")
    req = urllib.request.Request(
        root + "/v1/embeddings",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read().decode("utf-8", "replace") or "{}")
    data = body.get("data") or []
    if not data or not isinstance(data[0], dict):
        raise RuntimeError(f"Ollama embed returned no vector for {model}")
    emb = data[0].get("embedding") or []
    return [float(x) for x in emb]


def unload_local_model(model: str | None = None, timeout: float = 30.0) -> None:
    """Ask Ollama to unload a model (keep_alive=0) so the next one can load."""
    cfg = local_settings()
    wanted = local_model(model) if model else cfg["model"]
    payload = {
        "model": wanted,
        "messages": [{"role": "user", "content": "."}],
        "stream": False,
        "keep_alive": 0,
        "options": {"num_predict": 1},
    }
    url = _host_root(cfg["base_url"]) + "/api/chat"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
    except Exception:
        pass


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
                   max_tokens: int | None = None, model: str | None = None,
                   temperature: float | None = None,
                   keep_alive: str | int | None = "30m") -> str:
    """Stream one completion from the configured local model. Raises LocalLlmError."""
    cfg = local_settings(model=model)
    if max_tokens:
        cfg["max_tokens"] = max(256, min(int(max_tokens), 20000))
    if not cfg["enabled"]:
        raise LocalLlmError("Local finance model is disabled (LOCAL_LLM_ENABLED=false)")
    if should_cancel is not None and should_cancel():
        raise LocalLlmError("cancelled before local LLM call")
    health = check_local_health()
    if not health.get("ok"):
        # Still allow a per-request model that is installed even if default is missing.
        installed = {
            c["model"] for c in (health.get("configured") or []) if c.get("installed")
        }
        if cfg["model"] not in installed and not _model_installed(
            cfg["model"], health.get("models") or []
        ):
            raise LocalLlmError(health.get("message") or OFFLINE_MESSAGE)

    user_content, _trim = fit_local_context(user_content, num_ctx=cfg["num_ctx"])
    dump_prompt_if_debug("local", system_prompt, user_content, ticker=ticker)
    filings_chars = len(user_content)
    news_at = user_content.find("=== FREE CATALYST HEADLINES")
    news_chars = len(user_content) - news_at if news_at >= 0 else 0
    if news_at >= 0:
        filings_chars = news_at
    news_items = user_content.count("\n- [")
    temp = 0.2 if temperature is None else float(temperature)
    print(
        f"   [local] context filings_chars={filings_chars:,} "
        f"news_chars={news_chars:,} news_items={news_items} "
        f"est_tokens={_estimate_tokens(system_prompt + user_content):,} "
        f"num_ctx={cfg['num_ctx']} max_tokens={cfg['max_tokens']} "
        f"think={cfg['think']} model={cfg['model']} temperature={temp}",
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
        "keep_alive": keep_alive if keep_alive is not None else "30m",
        "options": {
            "num_ctx": cfg["num_ctx"],
            "num_predict": cfg["max_tokens"],
            "temperature": temp,
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
