"""Ideas desk. GP only. The morning thread starts from the server mount, not from import."""

from __future__ import annotations

import os
import sys
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request

from ideas_cards.catalog import ALL_STAGES
from ideas_cards.schedule import LA, capped_sleep, plan_tick
from ideas_cards.service import (
    dig_card,
    list_view,
    pass_card,
    run_stages,
    status_payload,
    watch_card,
    watchlist_view,
)
from ideas_cards.store import get_store

_BUSY = threading.Lock()
_STARTED = False
_LA = ZoneInfo("America/Los_Angeles")


def _gp(claims_fn, request: Request) -> dict:
    claims = claims_fn(request)
    if claims.get("role") not in ("gp", "admin"):
        raise HTTPException(403, "GP only")
    return claims


def _quotes(tickers: list[str]) -> dict:
    if not tickers:
        return {}
    try:
        import api.server as server
        return server._db_quotes(list(tickers)) or {}
    except Exception:
        return {}


def _annual(ticker: str):
    try:
        import api.server as server
        with server._fund_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT period_end, revenue, net_income, diluted_eps, total_debt, stockholders_equity
                FROM company_financials
                WHERE ticker = %s AND period_type = 'annual'
                ORDER BY period_end DESC LIMIT 1
                """,
                (ticker.upper(),),
            )
            row = cur.fetchone()
        if not row:
            return None
        keys = ("period_end", "revenue", "net_income", "diluted_eps", "total_debt", "stockholders_equity")
        out = {}
        for key, value in zip(keys, row):
            if hasattr(value, "isoformat"):
                out[key] = value.isoformat()
            elif value is None or key == "period_end":
                out[key] = value
            else:
                out[key] = float(value)
        return out
    except Exception:
        return None


def _model_note(card: dict, store):
    settings = store.get_settings()
    remaining = float(settings.get("grok_cap_usd") or 0) - store.month_spend()
    if remaining < 0.05:
        return None
    from ideas_cards.live import grok_complete
    try:
        result = grok_complete(
            card,
            remaining,
            settings.get("grok_model") or "grok-4",
            search=True,
        )
    except Exception:
        result = None
    if result and result[0]:
        return result
    try:
        from ideas_cards.live import apply_local
        updated = apply_local([card])
        note = (updated[0].get("model_note") if updated else "") or ""
        if updated and updated[0].get("thesis") and updated[0]["thesis"] != card.get("thesis"):
            return updated[0]["thesis"], 0.0
    except Exception:
        return None
    return None


def _loader(stage, settings, as_of, store):
    from ideas_cards.live import loader
    return loader(stage, settings, as_of, store)


def _polish(cards, settings, remaining):
    from ideas_cards.live import polish
    return polish(cards, settings, remaining)


def create_router(claims_fn) -> APIRouter:
    router = APIRouter(prefix="/api/ideas", tags=["ideas"])

    def gp(request: Request) -> dict:
        return _gp(claims_fn, request)

    @router.get("/cards")
    def cards(request: Request, type: str = "", status: str = "", sort: str = "score"):
        gp(request)
        store = get_store()
        rows = list_view(store, card_type=type, status=status, sort=sort if sort in {"score", "date"} else "score")
        tickers = [row.get("ticker") for row in rows if row.get("status") == "watching" and row.get("ticker")]
        if tickers:
            rows = list_view(store, card_type=type, status=status, sort=sort if sort in {"score", "date"} else "score", quotes=_quotes(tickers))
        return {"cards": rows}

    @router.get("/cards/{card_id:path}")
    def one(card_id: str, request: Request):
        gp(request)
        store = get_store()
        card = store.get_card(card_id)
        if not card:
            raise HTTPException(404, "No card")
        rows = list_view(store, quotes=_quotes([card.get("ticker")] if card.get("ticker") else []))
        for row in rows:
            if row.get("id") == card_id:
                return row
        raise HTTPException(404, "No card")

    @router.post("/cards/{card_id:path}/dig")
    def dig(card_id: str, request: Request):
        gp(request)
        try:
            card = dig_card(get_store(), card_id, financials_fn=_annual, model_fn=_model_note)
        except KeyError:
            raise HTTPException(404, "No card") from None
        return card

    @router.post("/cards/{card_id:path}/watch")
    def watch(card_id: str, request: Request):
        gp(request)
        store = get_store()
        existing = store.get_card(card_id)
        if not existing:
            raise HTTPException(404, "No card")
        price = None
        if existing.get("ticker"):
            quoted = _quotes([existing["ticker"]]).get(existing["ticker"]) or {}
            price = quoted.get("price") if isinstance(quoted, dict) else quoted
        if price is None:
            price = existing.get("price")
        try:
            return watch_card(store, card_id, price=price)
        except KeyError:
            raise HTTPException(404, "No card") from None

    @router.post("/cards/{card_id:path}/pass")
    async def passed(card_id: str, request: Request):
        gp(request)
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        try:
            return pass_card(get_store(), card_id, str(body.get("reason") or ""), str(body.get("note") or ""))
        except KeyError:
            raise HTTPException(404, "No card") from None
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None

    @router.get("/watchlist")
    def watchlist(request: Request):
        gp(request)
        store = get_store()
        preview = store.list_cards(status="watching")
        tickers = [row.get("ticker") for row in preview if row.get("ticker")]
        return {"cards": watchlist_view(store, quotes=_quotes(tickers))}

    @router.get("/settings")
    def settings_get(request: Request):
        gp(request)
        store = get_store()
        return {"settings": store.get_settings(), "pass_chips": store.pass_chips() if hasattr(store, "pass_chips") else []}

    @router.post("/settings")
    async def settings_post(request: Request):
        gp(request)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "Expected JSON") from None
        if not isinstance(body, dict):
            raise HTTPException(400, "Expected JSON")
        return {"settings": get_store().save_settings(body)}

    @router.get("/runs")
    def runs(request: Request):
        gp(request)
        now = datetime.now(_LA)
        payload = status_payload(get_store(), now)
        return {"runs": payload["runs"], "plan": payload["plan"]}

    @router.get("/status")
    def status(request: Request):
        gp(request)
        payload = status_payload(get_store(), datetime.now(_LA))
        payload["running"] = _BUSY.locked()
        return payload

    @router.post("/run")
    def run(request: Request):
        gp(request)
        if not _BUSY.acquire(blocking=False):
            return {"started": False, "reason": "running"}

        def job():
            try:
                store = get_store()
                now = datetime.now(_LA)
                run_stages(store, ALL_STAGES, now.date(), _loader, force=True, polish=_polish)
            finally:
                _BUSY.release()

        try:
            threading.Thread(target=job, name="ideas-run", daemon=True).start()
        except Exception:
            _BUSY.release()
            raise
        return {"started": True}

    return router


def start_scheduler() -> None:
    """One daemon. IDEAS_SCHEDULER=0 leaves it off. Tests do not start it."""
    global _STARTED
    if os.environ.get("IDEAS_SCHEDULER", "1") == "0":
        return
    if "pytest" in sys.modules:
        return
    if _STARTED:
        return
    _STARTED = True

    def loop():
        # Stay quiet through process boot so a health check never waits on EDGAR.
        time.sleep(20)
        while True:
            sleep_for = 60.0
            if not _BUSY.acquire(blocking=False):
                time.sleep(30)
                continue
            try:
                store = get_store()
                now = datetime.now(LA)
                settings = store.get_settings()
                plan = plan_tick(
                    now,
                    store.runs_on(now.date()),
                    auto=bool(settings.get("auto", True)),
                    start=settings.get("start_local") or "06:00",
                )
                if plan.get("action") == "run" and plan.get("stage"):
                    run_stages(store, [plan["stage"]], now.date(), _loader, force=False, polish=_polish)
                    sleep_for = 5
                else:
                    sleep_for = capped_sleep(plan.get("sleep_sec") or 60)
            except Exception as exc:
                print(f"[ideas] scheduler: {exc!s:.200}", flush=True)
                sleep_for = 60
            finally:
                _BUSY.release()
            time.sleep(sleep_for)

    threading.Thread(target=loop, name="ideas-cards", daemon=True).start()
