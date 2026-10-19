"""Shared helpers for the local LLM A/B harness.

Never writes to the production DB. Filings come from local fixtures, optional
local/dev Postgres (localhost only), or stocks/ caches on this machine.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
RESULTS = Path(__file__).resolve().parent / "results"
INDEXES = Path(__file__).resolve().parent / "indexes"

CHAT_MODELS = [
    m.strip()
    for m in os.environ.get(
        "LLM_AB_CHAT_MODELS",
        "gpt-oss-20b-finance,gemma4:26b,gemma4:12b",
    ).split(",")
    if m.strip()
]
EMBED_MODELS = [
    m.strip()
    for m in os.environ.get(
        "LLM_AB_EMBED_MODELS",
        "nomic-embed-text,qwen3-embedding:4b",
    ).split(",")
    if m.strip()
]

DEAL_FIELDS = (
    "acquirer",
    "target",
    "consideration",
    "cash_per_share",
    "exchange_ratio",
    "cvr",
    "termination_fee",
    "outside_date",
    "approvals",
)


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def ollama_base() -> str:
    base = _env("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base


def load_json(name: str) -> list | dict:
    path = FIXTURES / name
    return json.loads(path.read_text(encoding="utf-8"))


def is_local_database_url(url: str) -> bool:
    """True only for localhost/127.0.0.1 Postgres. Never treat Railway as local."""
    u = (url or "").lower()
    if not u:
        return False
    if "railway" in u or "rlwy.net" in u or "amazonaws.com" in u:
        return False
    return "localhost" in u or "127.0.0.1" in u


def load_items_from_local_db(kind: str, limit: int = 10) -> list[dict]:
    """Best-effort read of local/dev filings. Returns [] if no local DB."""
    url = _env("DATABASE_URL")
    if not is_local_database_url(url):
        return []
    if _env("LLM_AB_ALLOW_DB", "1") in ("0", "false", "no"):
        return []
    try:
        import psycopg2
        import psycopg2.extras
    except Exception:
        return []
    out: list[dict] = []
    try:
        with psycopg2.connect(url) as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor
        ) as cur:
            if kind == "deal_terms":
                cur.execute(
                    """
                    SELECT deal_id, packet
                      FROM merger_arb_deals
                     WHERE packet IS NOT NULL
                     ORDER BY updated_at DESC NULLS LAST
                     LIMIT %s
                    """,
                    (limit,),
                )
                for row in cur.fetchall() or []:
                    out.append({"id": row.get("deal_id"), "packet": row.get("packet")})
            elif kind == "mda":
                cur.execute(
                    """
                    SELECT ticker, chunk_text, quarter
                      FROM call_chunks
                     WHERE chunk_text ILIKE %s
                     ORDER BY created_at DESC NULLS LAST
                     LIMIT %s
                    """,
                    ("%margin%", limit * 3),
                )
                for row in cur.fetchall() or []:
                    out.append(dict(row))
            elif kind == "rag":
                cur.execute(
                    """
                    SELECT ticker, quarter, chunk_idx, chunk_text
                      FROM call_chunks
                     WHERE chunk_text IS NOT NULL
                     ORDER BY created_at DESC NULLS LAST
                     LIMIT %s
                    """,
                    (limit * 20,),
                )
                for row in cur.fetchall() or []:
                    out.append(dict(row))
    except Exception as exc:
        print(f"[llm_ab] local DB read skipped: {exc!s:.160}", flush=True)
        return []
    return out[:limit] if kind != "rag" else out


def unload_model(model: str) -> None:
    """keep_alive=0 so the next ~18 GB model can fit (OLLAMA_MAX_LOADED_MODELS=1)."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "."}],
        "stream": False,
        "keep_alive": 0,
        "options": {"num_predict": 1, "temperature": 0},
    }
    req = urllib.request.Request(
        ollama_base() + "/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
    except Exception:
        pass


def ollama_ps_memory() -> dict:
    """Sample `ollama ps` for peak-memory logging."""
    try:
        proc = subprocess.run(
            ["ollama", "ps"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        text = (proc.stdout or "") + (proc.stderr or "")
    except Exception as exc:
        return {"raw": "", "error": str(exc)[:120]}
    return {"raw": text.strip()[:2000]}


def chat_completion(
    model: str,
    system: str,
    user: str,
    *,
    temperature: float = 0.0,
    num_predict: int = 2048,
    num_ctx: int = 8192,
    format_json: bool = False,
) -> dict:
    """One Ollama /api/chat call at temperature 0. Returns text + metrics."""
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system or ""},
            {"role": "user", "content": user or ""},
        ],
        "stream": False,
        "think": False,
        "keep_alive": "2m",
        "options": {
            "temperature": temperature,
            "num_predict": num_predict,
            "num_ctx": num_ctx,
        },
    }
    if format_json:
        payload["format"] = "json"
    url = ollama_base() + "/api/chat"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    ttft = None
    mem_before = ollama_ps_memory()
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            # Non-stream: first byte ≈ full body; still log wall time as TTFT proxy.
            raw = resp.read()
            ttft = time.perf_counter() - t0
    except urllib.error.URLError as exc:
        return {
            "ok": False,
            "error": f"ollama offline: {exc}",
            "text": "",
            "model": model,
            "elapsed_s": time.perf_counter() - t0,
            "ttft_s": None,
            "tok_s": None,
            "eval_count": 0,
            "memory": mem_before,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc)[:300],
            "text": "",
            "model": model,
            "elapsed_s": time.perf_counter() - t0,
            "ttft_s": None,
            "tok_s": None,
            "eval_count": 0,
            "memory": mem_before,
        }
    elapsed = max(0.001, time.perf_counter() - t0)
    mem_after = ollama_ps_memory()
    try:
        body = json.loads(raw.decode("utf-8", "replace") or "{}")
    except json.JSONDecodeError:
        body = {}
    message = body.get("message") or {}
    text = ""
    if isinstance(message, dict):
        text = message.get("content") or ""
    eval_count = int(body.get("eval_count") or 0)
    eval_ns = int(body.get("eval_duration") or 0)
    tok_s = (eval_count / (eval_ns / 1e9)) if eval_ns and eval_count else None
    return {
        "ok": True,
        "error": None,
        "text": str(text),
        "model": model,
        "elapsed_s": round(elapsed, 3),
        "ttft_s": round(ttft, 3) if ttft is not None else None,
        "tok_s": round(tok_s, 2) if tok_s else None,
        "eval_count": eval_count,
        "prompt_eval_count": int(body.get("prompt_eval_count") or 0),
        "memory": {"before": mem_before, "after": mem_after},
    }


def embed_texts_ollama(model: str, texts: list[str]) -> list[list[float]]:
    from api.domains.local_finance_llm import embed_texts

    return embed_texts(texts, model=model, provider="ollama")


def parse_json_object(text: str) -> dict | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def norm_field(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value).strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = s.replace(",", "").replace("$", "")
    return s


def field_match(pred, gold) -> bool:
    a, b = norm_field(pred), norm_field(gold)
    if not b and not a:
        return True
    if not b:
        return a in ("", "null", "none", "n/a", "na", "false", "0")
    return a == b or a in b or b in a


def cosine(a: list[float], b: list[float]) -> float:
    import math

    if not a or not b or len(a) != len(b):
        return -1.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return -1.0
    return dot / (na * nb)


def write_results_md(path: Path, sections: list[tuple[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Local LLM A/B results — {date.today().isoformat()}",
        "",
        "Decision rule: add a chat model only if it wins 2+ tasks with no memory failures.",
        "Switch default embedder only if recall@5 improves by 10 points or more.",
        "",
    ]
    for title, body in sections:
        lines.append(f"## {title}")
        lines.append("")
        lines.append(body.rstrip())
        lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[llm_ab] wrote {path}", flush=True)
