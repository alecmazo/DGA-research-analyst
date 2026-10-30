"""Desk operations that do not import FastAPI."""

from __future__ import annotations

from datetime import date, datetime, timezone

from ideas_cards.catalog import PASS_CHIPS
from ideas_cards.compose import attach_watch_alerts, present
from ideas_cards.research import write_report
from ideas_cards.schedule import plan_tick, stage_open


def _quote_price(quotes: dict | None, ticker: str):
    if not quotes or not ticker:
        return None
    row = quotes.get(ticker) or quotes.get(ticker.upper())
    if isinstance(row, dict):
        return row.get("price")
    return row


def list_view(store, *, card_type: str = "", status: str = "", sort: str = "score", quotes: dict | None = None) -> list[dict]:
    settings = store.get_settings()
    cards = store.list_cards(card_type=card_type or None, status=status or None)
    move = float(settings.get("watch_move_pct") or 0.08)
    out = []
    for card in cards:
        view = present(card, settings)
        price = _quote_price(quotes, view.get("ticker") or "")
        out.append(attach_watch_alerts(view, price, move))
    if sort == "date":
        out.sort(key=lambda card: (card.get("as_of") or "", float(card.get("score") or 0)), reverse=True)
    else:
        out.sort(key=lambda card: float(card.get("score") or 0), reverse=True)
    return out


def watchlist_view(store, quotes: dict | None = None) -> list[dict]:
    return list_view(store, status="watching", sort="score", quotes=quotes)


def status_payload(store, now: datetime) -> dict:
    settings = store.get_settings()
    day = now.date() if isinstance(now, datetime) else now
    runs = store.runs_on(day)
    plan = plan_tick(
        now if isinstance(now, datetime) else datetime.combine(day, datetime.min.time()),
        runs,
        auto=bool(settings.get("auto", True)),
        start=settings.get("start_local") or "06:00",
    )
    return {
        "auto": bool(settings.get("auto", True)),
        "start_local": settings.get("start_local") or "06:00",
        "month_spend_usd": store.month_spend(day),
        "grok_cap_usd": settings.get("grok_cap_usd"),
        "runs": [{"stage": stage, **row} for stage, row in runs.items()],
        "plan": {k: plan[k] for k in ("action", "reason", "stage", "sleep_sec")},
        "pass_chips": list(PASS_CHIPS),
    }


def run_stages(store, stages, as_of, loader, *, force: bool = False, polish=None) -> list[dict]:
    settings = store.get_settings()
    results = []
    for stage in stages:
        if not force and not stage_open(store.runs_on(as_of), stage):
            results.append({"stage": stage, "skipped": True, "cards": 0})
            continue
        try:
            cards = loader(stage, settings, as_of, store)
            cost = 0.0
            if polish and cards:
                remaining = float(settings.get("grok_cap_usd") or 0) - store.month_spend(as_of)
                cards, cost = polish(cards, settings, max(0.0, remaining))
                if cost:
                    store.add_cost(cost, as_of)
            store.upsert_cards(cards)
            store.finish_run(as_of, stage, "succeeded", cost=cost)
            results.append({"stage": stage, "skipped": False, "cards": len(cards), "cost_usd": cost})
        except Exception as exc:
            row = store.note_failure(as_of, stage, str(exc))
            results.append({
                "stage": stage,
                "skipped": False,
                "error": row.get("error") or "",
                "attempts": row.get("attempts") or 0,
            })
    return results


def pass_card(store, card_id: str, reason: str, note: str = "") -> dict:
    chip = (reason or "").strip()
    if not chip:
        raise ValueError("A pass needs a reason")
    return store.act(card_id, "pass", reason=chip, note=(note or "")[:500])


def watch_card(store, card_id: str, price=None) -> dict:
    card = store.get_card(card_id)
    if not card:
        raise KeyError(card_id)
    watch = {
        "price": price,
        "at": datetime.now(timezone.utc).isoformat(),
        "seen_headlines": list(card.get("headlines") or []),
    }
    return store.act(card_id, "watch", watch=watch)


def dig_card(store, card_id: str, *, financials_fn=None, model_fn=None, now: date | None = None) -> dict:
    card = store.get_card(card_id)
    if not card:
        raise KeyError(card_id)
    financials = None
    if financials_fn and card.get("ticker"):
        try:
            financials = financials_fn(card["ticker"])
        except Exception:
            financials = None
    model_text = None
    cost = 0.0
    if model_fn:
        try:
            result = model_fn(card, store)
        except Exception:
            result = None
        if result:
            model_text, cost = result
            try:
                cost = float(cost or 0)
            except (TypeError, ValueError):
                cost = 0.0
    if cost > 0:
        store.add_cost(cost, now or date.today())
    report = write_report(card, financials, model_text)
    return store.act(card_id, "dig", report=report)
