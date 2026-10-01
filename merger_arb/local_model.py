"""Local refresh calls. Ollama only. This file does not call a paid model."""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from api.domains.local_finance_llm import LocalLlmError, local_settings


def _host_root(base_url: str) -> str:
    root = base_url.rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3]
    return root


def complete_refresh(system: str, user: str, *, num_ctx: int = 8192) -> str:
    """One JSON completion at temperature 0. Raises LocalLlmError. No paid fallback."""
    cfg = local_settings()
    if not cfg["enabled"]:
        raise LocalLlmError("Local finance model is disabled (LOCAL_LLM_ENABLED=false)")
    limit = max(1024, min(32768, int(num_ctx)))
    num_predict = max(256, int(limit * 0.25))
    estimate = max(1, (len(system or "") + len(user or "")) // 4)
    print(
        f"[merger-arb] local call tokens_est={estimate} num_ctx={limit} "
        f"temperature=0 model={cfg['model']}",
        flush=True,
    )
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": system or ""},
            {"role": "user", "content": user or ""},
        ],
        "stream": False,
        "think": False,
        "keep_alive": "10m",
        "options": {
            "num_ctx": limit,
            "temperature": 0,
            "num_predict": num_predict,
        },
    }
    url = _host_root(cfg["base_url"]) + "/api/chat"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout_s"]) as resp:
            body = json.loads(resp.read().decode("utf-8", "replace") or "{}")
    except urllib.error.URLError as exc:
        raise LocalLlmError("Local model offline – start Ollama") from exc
    except Exception as exc:
        raise LocalLlmError("Local model offline – start Ollama") from exc
    message = body.get("message") if isinstance(body, dict) else {}
    text = ""
    if isinstance(message, dict):
        text = message.get("content") or ""
    prompt_tokens = int((body or {}).get("prompt_eval_count") or estimate)
    completion_tokens = int((body or {}).get("eval_count") or max(1, len(text) // 4))
    print(
        f"[merger-arb] local done prompt_tokens={prompt_tokens} "
        f"completion_tokens={completion_tokens} chars={len(text)}",
        flush=True,
    )
    if not str(text).strip():
        raise LocalLlmError("Local model returned an empty reply")
    return str(text)
