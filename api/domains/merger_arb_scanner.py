"""Scan routes on the merger arb desk. GP only. Demo POST stays blocked by the desk middleware."""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request

from merger_arb.freshness import format_pt
from merger_arb.scanner.actions import ActionError, add_to_desk, apply_alert, ignore_candidate
from merger_arb.scanner.config import ScannerConfig
from merger_arb.scanner.runner import ScanRunner, daily_due, default_client, load_quotes
from merger_arb.scanner.sources import build_sources
from merger_arb.scanner.store import get_scanner_store

_DAILY_STARTED = False
_DAILY_LOCK = threading.Lock()


async def _body(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Expected JSON") from exc
    if not isinstance(data, dict):
        raise HTTPException(400, "Expected JSON")
    return data


def _public_candidate(row: dict) -> dict:
    fields = []
    for field in row.get("fields") or []:
        fields.append({
            "field_name": field.get("field_name") or "",
            "value": field.get("value"),
            "raw": field.get("raw") or "",
            "source_name": field.get("source_name") or "",
            "source_url": field.get("source_url") or "",
            "pulled_at": field.get("pulled_at") or "",
            "pulled_at_pt": format_pt(field.get("pulled_at") or ""),
            "method": field.get("method") or "",
            "evidence": field.get("evidence") or "",
            "conflict": bool(field.get("conflict")),
            "is_current": bool(field.get("is_current", True)),
        })
    return {
        "id": row.get("id") or "",
        "deal_key": row.get("deal_key") or "",
        "target_ticker": row.get("target_ticker") or "",
        "target_name": row.get("target_name") or "",
        "target_cik": row.get("target_cik") or "",
        "acquirer_ticker": row.get("acquirer_ticker") or "",
        "acquirer_name": row.get("acquirer_name") or "",
        "acquirer_cik": row.get("acquirer_cik") or "",
        "consideration_type": row.get("consideration_type") or "",
        "offer_terms": row.get("offer_terms") or "",
        "announce_date": row.get("announce_date") or "",
        "expected_close": row.get("expected_close") or "",
        "status": row.get("status") or "",
        "hsr": row.get("hsr") or "",
        "vote_date": row.get("vote_date") or "",
        "current_price": row.get("current_price") or "",
        "offer_value": row.get("offer_value") or "",
        "gross_spread": row.get("gross_spread") or "",
        "gross_spread_pct": row.get("gross_spread_pct") or "",
        "annualized_pct": row.get("annualized_pct") or "",
        "annualized_assumption": row.get("annualized_assumption") or "",
        "spread_with_cvr_max": row.get("spread_with_cvr_max") or "",
        "confidence": row.get("confidence") or 0,
        "confidence_breakdown": row.get("confidence_breakdown") or [],
        "needs_manual_terms": bool(row.get("needs_manual_terms")),
        "news_only": bool(row.get("news_only")),
        "sources": row.get("sources") or [],
        "fields": fields,
        "desk_deal_id": row.get("desk_deal_id") or "",
    }


def _public_alert(row: dict) -> dict:
    return {
        "id": row.get("id") or "",
        "desk_deal_id": row.get("desk_deal_id") or "",
        "alert_type": row.get("alert_type") or "",
        "certainty": row.get("certainty") or "",
        "source_url": row.get("source_url") or "",
        "source_name": row.get("source_name") or "",
        "pulled_at": row.get("pulled_at") or "",
        "pulled_at_pt": format_pt(row.get("pulled_at") or ""),
        "evidence": row.get("evidence") or "",
        "details": row.get("details") or {},
        "acknowledged_at": row.get("acknowledged_at") or "",
        "applied_at": row.get("applied_at") or "",
    }


def _desk_deals(desk) -> list[dict]:
    rows = []
    for deal in desk.list_deals():
        if deal.get("id") == "fixture-acme" or deal.get("sample"):
            continue
        row = dict(deal)
        packet = desk.latest(deal["id"]) if hasattr(desk, "latest") else None
        if packet:
            from merger_arb.schema import field_map
            fields = field_map(packet)
            cash = fields.get("structure.cash_per_share") or {}
            vote = fields.get("votes.meeting_date") or {}
            if cash and not cash.get("unverified") and cash.get("value") is not None:
                row["stored_cash"] = str(cash.get("value"))
            if vote and not vote.get("unverified") and vote.get("value"):
                row["stored_vote"] = str(vote.get("value"))[:10]
        rows.append(row)
    return rows


def _runner(store, desk, config: ScannerConfig) -> ScanRunner:
    return ScanRunner(
        store,
        build_sources(config),
        config=config,
        client=default_client(config),
        quotes_fn=load_quotes,
        desk_deals_fn=lambda: _desk_deals(desk),
    )


def _start_daily(store_fn, desk_fn, config: ScannerConfig) -> None:
    global _DAILY_STARTED
    if not config.daily_time:
        return
    with _DAILY_LOCK:
        if _DAILY_STARTED:
            return
        _DAILY_STARTED = True

    def loop():
        last = None
        zone = ZoneInfo("America/Los_Angeles")
        while True:
            now = datetime.now(zone)
            if daily_due(now, config.daily_time, last):
                last = now.date()
                try:
                    runner = _runner(store_fn(), desk_fn(), config)
                    active = store_fn().active_run()
                    if active is None:
                        runner.scan_sync(mode="incremental")
                except Exception:
                    pass
            time.sleep(30)

    threading.Thread(target=loop, name="scanner-daily", daemon=True).start()


def create_router(claims_fn, *, store=None, desk_store=None, runner_factory=None, config: ScannerConfig | None = None) -> APIRouter:
    router = APIRouter(prefix="/api/merger-arb", tags=["merger-arb-scanner"])
    cfg = config or ScannerConfig.from_env()

    def gp(request: Request) -> dict:
        claims = claims_fn(request)
        if claims.get("role") not in ("gp", "admin"):
            raise HTTPException(403, "GP only")
        return claims

    def scanner():
        if store is not None:
            return store
        return get_scanner_store()

    def desk():
        if desk_store is not None:
            return desk_store
        from api.domains.merger_arb_analysis import get_store
        return get_store()

    def make_runner():
        if runner_factory is not None:
            return runner_factory(scanner(), desk())
        return _runner(scanner(), desk(), cfg)

    def raise_action(exc: ActionError):
        raise HTTPException(exc.status, exc.message) from exc

    @router.post("/scan")
    async def start_scan(request: Request):
        gp(request)
        body = await _body(request)
        mode = "full" if str(body.get("mode") or "") == "full" else "incremental"
        since_days = body.get("since_days")
        active = scanner().active_run()
        if active is not None:
            raise HTTPException(409, "A scan is already running")
        run_id = make_runner().start_async(mode=mode, since_days=since_days)
        return {"ok": True, "run_id": run_id}

    @router.get("/scan/latest")
    def latest(request: Request):
        gp(request)
        include_ignored = request.query_params.get("ignored") in {"1", "true", "yes"}
        include_hidden = request.query_params.get("unresolved") in {"1", "true", "yes"}
        store_obj = scanner()
        run = store_obj.latest_finished() or store_obj.active_run()
        when = (run or {}).get("finished_at") or (run or {}).get("started_at") or ""
        return {
            "ok": True,
            "last_scan_at": when,
            "last_scan_pt": format_pt(when),
            "run": run,
            "candidates": [_public_candidate(row) for row in store_obj.list_candidates(
                include_ignored=include_ignored,
                include_hidden=include_hidden,
            )],
            "alerts": [_public_alert(row) for row in store_obj.list_alerts()],
        }

    @router.get("/scan/{run_id}")
    def scan_status(run_id: str, request: Request):
        gp(request)
        run = scanner().get_run(run_id)
        if run is None:
            raise HTTPException(404, "Scan not found")
        return {"ok": True, "run": run}

    @router.post("/scan/{run_id}/cancel")
    def cancel_scan(run_id: str, request: Request):
        gp(request)
        if not scanner().request_cancel(run_id):
            raise HTTPException(404, "That scan is not running")
        return {"ok": True, "run_id": run_id}

    @router.post("/candidates/{candidate_id}/add")
    async def add_candidate(candidate_id: str, request: Request):
        gp(request)
        body = await _body(request)
        try:
            return add_to_desk(scanner(), desk(), candidate_id, body)
        except ActionError as exc:
            raise_action(exc)

    @router.post("/candidates/{candidate_id}/ignore")
    async def ignore(candidate_id: str, request: Request):
        gp(request)
        body = await _body(request)
        try:
            return ignore_candidate(scanner(), candidate_id, body)
        except ActionError as exc:
            raise_action(exc)

    @router.post("/candidates/{candidate_id}/open-analysis")
    async def open_analysis(candidate_id: str, request: Request):
        gp(request)
        body = await _body(request)
        try:
            return add_to_desk(scanner(), desk(), candidate_id, body)
        except ActionError as exc:
            raise_action(exc)

    @router.post("/alerts/{alert_id}/acknowledge")
    def acknowledge(alert_id: str, request: Request):
        gp(request)
        alert = scanner().acknowledge(alert_id)
        if alert is None:
            raise HTTPException(404, "Alert not found")
        return {"ok": True, "alert": _public_alert(alert)}

    @router.post("/alerts/{alert_id}/apply")
    async def apply(alert_id: str, request: Request):
        gp(request)
        body = await _body(request)
        try:
            return apply_alert(scanner(), desk(), alert_id, body)
        except ActionError as exc:
            raise_action(exc)

    if store is None and desk_store is None and runner_factory is None:
        _start_daily(scanner, desk, cfg)
    return router
