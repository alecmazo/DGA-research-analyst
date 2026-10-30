"""One stage: scan a fixture bundle, score it, and optionally polish the top cards."""

from __future__ import annotations

from ideas_cards.catalog import DEFAULT_WEIGHTS
from ideas_cards.compose import insider_cards, sector_cards, trend_cards, weekly_cards
from ideas_cards.scanners import (
    scan_13f_changes,
    scan_beaten_sectors,
    scan_insider_buys,
    scan_trends,
    scan_weekly_drops,
)
from ideas_cards.scoring import normalize_weights


def _weights(settings: dict, kind: str) -> dict:
    raw = ((settings or {}).get("weights") or {}).get(kind) or DEFAULT_WEIGHTS[kind]
    return normalize_weights(raw)


def thirteen_f_changes(store, current: list, funds: list, add_pct: float) -> list:
    """The first filing set is a baseline and produces no cards."""
    if not current:
        return []
    if not store.get_blob("13f_has_baseline"):
        store.set_blob("13f_baseline", current)
        store.set_blob("13f_has_baseline", True)
        return []
    prior = store.get_blob("13f_baseline") or []
    changes = scan_13f_changes(current, prior, funds, add_pct=add_pct)
    store.set_blob("13f_baseline", current)
    return changes


def cards_for_bundle(stage: str, bundle: dict, settings: dict, as_of, store=None) -> list[dict]:
    bundle = bundle or {}
    if stage == "sector":
        hits = scan_beaten_sectors(
            bundle.get("prices") or {},
            bundle.get("constituents") or {},
            drawdown_min=float(settings.get("drawdown_min") or 0.15),
        )
        return sector_cards(hits, _weights(settings, "sector"), as_of, macro=bundle.get("macro"))
    if stage == "weekly":
        hits = scan_weekly_drops(
            bundle.get("names") or [],
            drop_min=float(settings.get("drop_min") or 0.15),
            min_market_cap=float(settings.get("min_market_cap") or 1_000_000_000),
        )
        return weekly_cards(hits, _weights(settings, "weekly"), as_of)
    if stage == "insider":
        trades = scan_insider_buys(
            bundle.get("trades") or [],
            as_of=as_of,
            window_days=int(settings.get("insider_window_days") or 30),
            cluster_min=int(settings.get("insider_cluster") or 2),
            ceo_cfo_min_usd=float(settings.get("ceo_cfo_min_usd") or 250_000),
        )
        if store is not None and bundle.get("filings_current") is not None:
            changes = thirteen_f_changes(
                store,
                bundle.get("filings_current") or [],
                settings.get("funds") or [],
                float(settings.get("add_pct") or 0.50),
            )
        else:
            changes = scan_13f_changes(
                bundle.get("filings_current") or [],
                bundle.get("filings_prior") or [],
                settings.get("funds") or [],
                add_pct=float(settings.get("add_pct") or 0.50),
            )
        return insider_cards(list(trades) + list(changes), _weights(settings, "insider"), as_of)
    if stage == "trend":
        themes = list(settings.get("themes") or [])
        for extra in settings.get("discovered_themes") or []:
            if extra not in themes:
                themes.append(extra)
        hits = scan_trends(
            themes,
            bundle.get("mentions"),
            bundle.get("patents"),
            bundle.get("fda"),
            bundle.get("search"),
            bundle.get("exposed"),
            as_of=as_of,
        )
        return trend_cards(hits, _weights(settings, "trend"), as_of)
    raise ValueError(f"unknown stage {stage}")


def polish_cards(cards: list, *, remaining_usd: float, complete_fn, limit: int = 3) -> tuple[list, float]:
    """`complete_fn(card, remaining) -> (text, cost) or None`. None spends nothing."""
    if remaining_usd <= 0 or not complete_fn or not cards:
        return cards, 0.0
    order = sorted(range(len(cards)), key=lambda i: float(cards[i].get("score") or 0), reverse=True)
    spent = 0.0
    out = [dict(card) for card in cards]
    touched = 0
    for index in order:
        if touched >= limit or remaining_usd - spent <= 0.01:
            break
        touched += 1
        try:
            result = complete_fn(out[index], remaining_usd - spent)
        except Exception:
            continue
        if not result:
            continue
        text, cost = result
        try:
            cost_f = float(cost or 0)
        except (TypeError, ValueError):
            cost_f = 0.0
        if cost_f < 0:
            cost_f = 0.0
        if cost_f > remaining_usd - spent + 1e-9:
            continue
        spent += cost_f
        line = str(text or "").strip().splitlines()
        if line and line[0].strip():
            out[index]["thesis"] = line[0].strip()[:280]
            out[index]["model_note"] = str(text).strip()[:2000]
    return out, round(spent, 6)
