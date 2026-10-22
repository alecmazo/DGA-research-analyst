"""Position weights for a committee review.

The investment-committee dossier sets the target. These caps then keep a
binary name with risk of ruin, and a name with no saved thesis, at a
satellite weight. Price-target upside does not choose the weight.
"""

from __future__ import annotations

import json
import re

# A core holding is about 8% of a book. A binary name that can ruin the
# position stays at a satellite weight.
BINARY_RUIN_MAX_PCT = 4.0
# No thesis on file: stay small, and do not add.
MISSING_THESIS_MAX_PCT = 2.0
# Large-cap biotech is a franchise, not the small/mid ruin bucket.
LARGE_CAP_USD = 15_000_000_000
_ACTION_BAND = 0.75

_BIOTECH_RE = re.compile(
    r"biotech|biopharma|biopharmaceutical|drug manufacturer",
    re.I,
)
_BINARY_RE = re.compile(
    r"risk of ruin|binary\s+(?:readout|outcome|trial|event|catalyst)",
    re.I,
)
_SIZING_FENCE_RE = re.compile(r"```sizing\s*([\s\S]*?)```", re.I)


def thesis_on_file(text: str | None) -> bool:
    return bool((text or "").strip())


def _num(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.replace("%", "").replace(",", "").strip()
        if not value:
            return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _market_cap(row: dict) -> float | None:
    for key in ("market_cap", "marketCap", "mcap"):
        n = _num(row.get(key))
        if n is not None and n > 0:
            return n
    return None


def is_binary_ruin(row: dict) -> bool:
    """True when the committee (or the saved thesis) marks risk of ruin.

    A small or mid-cap biotech is in that bucket. A large-cap franchise is
    not, unless the row itself is flagged binary or describes a binary readout.
    """
    if row.get("binary") is True or row.get("risk_of_ruin") is True or row.get("ruin") is True:
        return True
    blob = " ".join(
        str(row.get(k) or "")
        for k in ("sector", "industry", "downside", "why", "thesis")
    )
    biotech = bool(_BIOTECH_RE.search(blob))
    binary_lang = bool(_BINARY_RE.search(blob))
    mcap = _market_cap(row)
    small_or_mid = mcap is not None and mcap < LARGE_CAP_USD
    if biotech and small_or_mid:
        return True
    if biotech and binary_lang:
        return True
    if binary_lang and (mcap is None or small_or_mid):
        return True
    return False


def parse_sizing_block(answer: str | None) -> list[dict]:
    """Pull the committee's ```sizing JSON array out of a dossier."""
    if not answer:
        return []
    match = _SIZING_FENCE_RE.search(answer)
    blob = match.group(1).strip() if match else ""
    if not blob:
        return []
    try:
        data = json.loads(blob)
    except Exception:
        return []
    if isinstance(data, dict):
        data = data.get("rows") or data.get("sizing") or []
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict) and row.get("ticker")]


def sizing_fence(proposals: list[dict]) -> str:
    clean = []
    for raw in proposals or []:
        if not isinstance(raw, dict):
            continue
        ticker = str(raw.get("ticker") or "").upper().strip()
        if not ticker:
            continue
        clean.append({
            "ticker": ticker,
            "current_pct": raw.get("current_pct"),
            "target_pct": raw.get("target_pct"),
            "action": raw.get("action") or "hold",
            "why": raw.get("why") or "",
            "downside": raw.get("downside") or "",
            "binary": bool(raw.get("binary")),
            "thesis_on_file": bool(raw.get("thesis_on_file")),
            "industry": raw.get("industry") or "",
            "sector": raw.get("sector") or "",
            "market_cap": raw.get("market_cap"),
        })
    return "```sizing\n" + json.dumps(clean, indent=2) + "\n```"


def committee_dossier(fund_name: str | None, proposals: list[dict]) -> str:
    """A full committee record whose sizing fence is the suggestion source."""
    name = fund_name or "Portfolio"
    return "\n".join([
        f"# Investment Committee Review — {name}",
        "",
        "## Suggested adjustments",
        "Each weight follows the saved thesis for that name. A binary outcome "
        "with risk of ruin, including a small or mid-cap biotech, stays at a "
        "satellite weight. A name with no thesis on file stays inside the "
        "conservative cap.",
        "",
        "## Wipeout scenarios",
        "A single readout that fails can wipe a binary name. That name is "
        "sized so the loss stays inside a satellite weight.",
        "",
        sizing_fence(proposals),
        "",
    ])


def _has_thesis(ticker: str, prop: dict, theses: dict) -> bool:
    if ticker in theses:
        return thesis_on_file(theses.get(ticker))
    if prop.get("thesis_on_file") is not None:
        return bool(prop.get("thesis_on_file"))
    return thesis_on_file(prop.get("thesis"))


def rows_from_committee(
    positions: list[dict] | None,
    *,
    answer: str | None = None,
    proposals: list[dict] | None = None,
    theses: dict | None = None,
) -> list[dict]:
    """Suggestion rows for one book.

    Targets come from the committee sizing block. When that block omits a
    name, the weight stays at the current book. Upside and rating are ignored.
    Ruin and missing-thesis caps apply after the committee target.
    """
    theses = theses or {}
    parsed = proposals if proposals is not None else parse_sizing_block(answer)
    by_tk: dict[str, dict] = {}
    for raw in parsed or []:
        ticker = str(raw.get("ticker") or "").upper().strip()
        if ticker:
            by_tk[ticker] = raw

    out = []
    seen: set[str] = set()
    for pos in positions or []:
        ticker = str((pos or {}).get("ticker") or "").upper().strip()
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        prop = by_tk.get(ticker) or {}
        current = _num(pos.get("weight_pct"))
        if current is None:
            current = _num(prop.get("current_pct")) or 0.0
        thesis_text = theses.get(ticker)
        if thesis_text is None:
            thesis_text = str(prop.get("thesis") or "")
        has_thesis = _has_thesis(ticker, prop, theses)
        omitted = ticker not in by_tk
        proposed = None if omitted else _num(prop.get("target_pct"))
        if proposed is None and not omitted:
            proposed = _num(prop.get("suggested_pct"))
        if proposed is None:
            proposed = current

        merged = {
            **prop,
            "ticker": ticker,
            "thesis": thesis_text or "",
            "industry": prop.get("industry") or pos.get("industry") or "",
            "sector": prop.get("sector") or pos.get("sector") or "",
        }
        ruin = is_binary_ruin(merged)
        target = float(proposed)
        why = str(prop.get("why") or "").strip()
        downside = str(prop.get("downside") or "").strip()
        capped = False

        if omitted and not why:
            why = (
                "Committee sizing omitted a target for this name. "
                "Weight stays at the current book, inside the thesis and ruin caps."
            )
        if not has_thesis:
            capped_missing = target > min(current, MISSING_THESIS_MAX_PCT) + 1e-9
            target = min(target, current, MISSING_THESIS_MAX_PCT)
            if capped_missing:
                capped = True
            if not why:
                why = "No saved thesis on file. Weight stays inside the conservative cap."
            elif "thesis" not in why.lower():
                why = (
                    why.rstrip(".")
                    + ". No saved thesis on file, so the weight stays inside the conservative cap."
                )
            if not downside:
                downside = "Thesis is not on file. Sized inside the 2% conservative cap."
        if ruin and target > BINARY_RUIN_MAX_PCT:
            target = BINARY_RUIN_MAX_PCT
            capped = True
            if not downside:
                downside = (
                    "Binary outcome with risk of ruin. "
                    "Weight is capped at 4% of the book."
                )
            elif "4%" not in downside:
                downside = (
                    downside.rstrip(".")
                    + ". Capped at 4% of the book because a failed outcome can ruin the position."
                )

        target = max(0.0, round(float(target), 2))
        current_r = round(float(current), 2)
        diff = target - current_r
        if diff > _ACTION_BAND:
            action = "add"
        elif diff < -_ACTION_BAND:
            action = "trim"
        else:
            action = "hold"
        out.append({
            "ticker": ticker,
            "current_pct": current_r,
            "suggested_pct": target,
            "action": action,
            "why": why,
            "downside": downside,
            "binary": ruin,
            "thesis_on_file": has_thesis,
            "capped": capped,
        })
    out.sort(key=lambda row: (-(row["suggested_pct"] or 0), row["ticker"]))
    return out


def reviews_for_book(reviews: list[dict] | None, fund_id: str) -> list[dict]:
    """Committee reports stored for this fund or managed account."""
    fid = str(fund_id or "").strip()
    out = []
    for raw in reviews or []:
        if not isinstance(raw, dict) or not raw.get("id"):
            continue
        if fid and str(raw.get("fund_id") or "").strip() != fid:
            continue
        out.append({
            "id": raw.get("id"),
            "fund_id": raw.get("fund_id"),
            "fund_name": raw.get("fund_name"),
            "tickers": raw.get("tickers"),
            "generated_at": raw.get("generated_at"),
            "model": raw.get("model"),
        })
    return out
