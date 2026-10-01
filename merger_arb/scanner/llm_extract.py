"""Optional local extraction. Off by default. A quote must appear in the source text."""

from __future__ import annotations

import json
import re
from decimal import Decimal
from urllib.parse import urlparse

from merger_arb.scanner.models import FieldValue

BLOCKED_HOSTS = {"api.openai.com", "api.anthropic.com", "api.x.ai"}
LOCAL_HOSTS = {"localhost", "127.0.0.1"}
_FIELDS = (
    "target",
    "acquirer",
    "consideration_type",
    "cash_per_share",
    "exchange_ratio",
    "cvr",
    "expected_close_text",
    "announce_date",
    "outside_date",
    "vote_date",
)


class LlmUrlError(ValueError):
    pass


class LlmSkipped(RuntimeError):
    pass


def _host(url: str) -> str:
    return (urlparse(url or "").hostname or "").lower()


def resolve_llm_url(config) -> str | None:
    """None when the flag is off. Reject paid hosts even if remote is allowed."""
    if not getattr(config, "llm_enabled", False):
        return None
    explicit = (getattr(config, "ollama_base_url", "") or "").strip()
    fallback = (getattr(config, "local_llm_base_url", "") or "").strip()
    if explicit:
        url = explicit
    elif fallback and _host(fallback) in LOCAL_HOSTS:
        url = fallback
    elif fallback:
        raise LlmUrlError("LOCAL_LLM_BASE_URL is not local, and OLLAMA_BASE_URL is unset")
    else:
        url = "http://127.0.0.1:11434/v1"
    host = _host(url)
    if host in BLOCKED_HOSTS:
        raise LlmUrlError(f"{host} is not a scanner model")
    if host not in LOCAL_HOSTS and not getattr(config, "allow_remote_llm", False):
        raise LlmUrlError("Scanner model stays on localhost unless SCANNER_LLM_ALLOW_REMOTE is set")
    return url.rstrip("/")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _digits(text: str) -> str:
    return re.sub(r"[\$,\s]", "", text or "")


def quote_ok(quote: str, source_text: str) -> bool:
    if not quote or not source_text:
        return False
    return _norm(quote) in _norm(source_text)


def value_in_quote(value, quote: str) -> bool:
    if value is None or quote is None:
        return False
    if isinstance(value, (int, float, Decimal)):
        raw = format(Decimal(str(value)), "f").rstrip("0").rstrip(".")
        compact = _digits(quote)
        return raw in compact or str(value) in compact
    text = _norm(str(value))
    return bool(text) and text in _norm(quote)


def _prompt(source_text: str) -> str:
    keys = ", ".join(_FIELDS)
    return (
        "Extract merger terms as strict JSON. For each field return "
        '{"value": "...", "evidence_quote": "exact words from the text"}. '
        f"Fields: {keys}. Use null when the text does not say it. "
        "Do not calculate a spread.\n\nSOURCE:\n"
        + source_text[:12000]
    )


def extract_llm_fields(
    source_text: str,
    complete,
    *,
    source_name: str,
    source_url: str,
    pulled_at: str,
) -> list[FieldValue]:
    raw = complete(_prompt(source_text))
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            return []
        payload = json.loads(raw[start:end + 1])
    if not isinstance(payload, dict):
        return []
    found = []
    mapping = {
        "cash_per_share": "cash_per_share",
        "exchange_ratio": "exchange_ratio",
        "cvr": "cvr",
        "expected_close_text": "expected_close",
        "announce_date": "announce_date",
        "outside_date": "outside_date",
        "vote_date": "vote_date",
        "target": "target_name",
        "acquirer": "acquirer_name",
        "consideration_type": "consideration_type",
    }
    for key, field_name in mapping.items():
        node = payload.get(key)
        if not isinstance(node, dict):
            continue
        value = node.get("value")
        quote = str(node.get("evidence_quote") or "")
        if value in (None, "", "null"):
            continue
        verified = quote_ok(quote, source_text) and value_in_quote(value, quote)
        if field_name in {"cash_per_share", "exchange_ratio", "cvr"}:
            try:
                value = Decimal(str(value).replace(",", "").replace("$", ""))
            except Exception:
                verified = False
        found.append(FieldValue(
            field_name=field_name,
            value=value,
            raw=quote or str(value),
            source_name=source_name,
            source_url=source_url,
            pulled_at=pulled_at,
            method="llm_verified" if verified else "llm_unverified",
            evidence=quote[:300],
        ))
    return found


def ollama_complete(prompt: str, config) -> str:
    url = resolve_llm_url(config)
    if not url:
        raise LlmSkipped("local extraction is off")
    import requests
    response = requests.post(
        url + "/chat/completions",
        json={
            "model": config.ollama_model,
            "temperature": 0,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=60,
    )
    response.raise_for_status()
    body = response.json()
    return ((body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
