"""Per-type scores and the bounded weight update from Dig, Watch, and Pass."""

from __future__ import annotations

from ideas_cards.catalog import (
    DEFAULT_WEIGHTS,
    PASS_NUDGES,
    WEIGHT_CAP,
    WEIGHT_FLOOR,
)


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, float(value)))


def normalize_weights(weights: dict) -> dict:
    """Keep every weight inside 5–60 and the set near 100."""
    keys = list(weights)
    w = {k: min(WEIGHT_CAP, max(WEIGHT_FLOOR, float(weights[k]))) for k in keys}
    for _ in range(12):
        total = sum(w.values())
        gap = 100.0 - total
        if abs(gap) < 0.05:
            break
        if gap > 0:
            room = [k for k in keys if w[k] < WEIGHT_CAP - 0.01]
        else:
            room = [k for k in keys if w[k] > WEIGHT_FLOOR + 0.01]
        if not room:
            break
        share = gap / len(room)
        for k in room:
            w[k] = min(WEIGHT_CAP, max(WEIGHT_FLOOR, w[k] + share))
    return {k: round(w[k], 2) for k in keys}


def weighted(parts: dict, weights: dict) -> dict:
    used = {k: float(weights.get(k) or 0) for k in parts}
    total_w = sum(used.values()) or 1.0
    score = sum(float(parts[k]) * used[k] for k in parts) / total_w
    breakdown = [
        {
            "key": k,
            "label": k.replace("_", " "),
            "score": round(float(parts[k]), 1),
            "weight": round(used[k], 2),
        }
        for k in parts
    ]
    return {"total": round(_clamp(score), 1), "breakdown": breakdown}


def weights_tuned(card_type: str, weights: dict) -> bool:
    base = DEFAULT_WEIGHTS.get(card_type) or {}
    for key, value in base.items():
        if abs(float(weights.get(key) or 0) - float(value)) >= 0.5:
            return True
    return False


def tune_weights(weights: dict, card_type: str, action: str, reason: str = "") -> dict:
    """Nudge one type. Dig and Watch reinforce the heaviest signal. Pass uses the chip."""
    current = dict(weights or DEFAULT_WEIGHTS.get(card_type) or {})
    if not current:
        return current
    deltas: dict[str, float] = {}
    if action == "pass":
        chip = (reason or "").strip().lower()
        deltas = dict((PASS_NUDGES.get(card_type) or {}).get(chip) or {})
    elif action in ("dig", "watch") and current:
        top = max(current, key=lambda k: float(current[k]))
        deltas = {top: 1.0}
    if not deltas:
        return normalize_weights(current)
    moved = dict(current)
    for key, delta in deltas.items():
        if key in moved:
            moved[key] = float(moved[key]) + float(delta)
    return normalize_weights(moved)


def score_sector(payload: dict, weights: dict) -> dict:
    drawdown = abs(float(payload.get("drawdown") or 0))
    dd = _clamp((drawdown - 0.15) / 0.35 * 100.0)
    rel = abs(min(float(payload.get("rel_3m") or 0), float(payload.get("rel_6m") or 0)))
    rel_score = _clamp(rel / 0.20 * 100.0)
    val = payload.get("valuation_vs_5y")
    if val is None:
        val_score = 50.0
    else:
        val_score = _clamp((1.2 - float(val)) / 0.70 * 100.0)
    bs = _clamp(payload.get("balance_sheet_score") if payload.get("balance_sheet_score") is not None else 50)
    return weighted(
        {"drawdown": dd, "relative": rel_score, "valuation": val_score, "balance_sheet": bs},
        weights,
    )


def score_weekly(payload: dict, weights: dict) -> dict:
    drop = abs(float(payload.get("drop") or 0))
    drop_score = _clamp((drop - 0.15) / 0.35 * 100.0)
    over = _clamp(payload.get("overreaction") if payload.get("overreaction") is not None else 0)
    cause = (payload.get("cause") or "").lower()
    idio = 25.0 if cause == "market-wide" else 80.0
    cap = float(payload.get("market_cap") or 0)
    size = _clamp((cap / 1e9 - 1) / 49 * 100.0) if cap else 40.0
    return weighted(
        {"drop": drop_score, "overreaction": over, "idiosyncratic": idio, "size": size},
        weights,
    )


def score_insider(payload: dict, weights: dict) -> dict:
    kind = payload.get("subtype") or "form4"
    if kind == "13f":
        cluster = 85.0 if payload.get("change") == "new" else 60.0
        dollars = _clamp(float(payload.get("value") or 0) / 50_000_000 * 100.0)
        role = 80.0
    else:
        buyers = int(payload.get("buyers") or 0)
        cluster = _clamp(buyers / 4 * 100.0)
        dollars = _clamp(float(payload.get("value") or 0) / 1_000_000 * 100.0)
        role = 90.0 if payload.get("senior") else 45.0
    return weighted({"cluster": cluster, "dollars": dollars, "role": role}, weights)


def score_trend(payload: dict, weights: dict) -> dict:
    filings = _clamp(float(payload.get("mention_growth") or 0) / 1.0 * 100.0)
    patents = _clamp(float(payload.get("patent_growth") or 0) / 1.0 * 100.0)
    fda = _clamp(int(payload.get("fda_count") or 0) / 3 * 100.0)
    search = _clamp(payload.get("search_momentum") if payload.get("search_momentum") is not None else 0)
    return weighted(
        {"filings": filings, "patents": patents, "fda": fda, "search": search},
        weights,
    )


SCORERS = {
    "sector": score_sector,
    "weekly": score_weekly,
    "insider": score_insider,
    "trend": score_trend,
}
