"""HTTP routes for the merger arb analysis page. The main desk is not involved."""

from __future__ import annotations

import os
import re

from fastapi import APIRouter, HTTPException, Request

from merger_arb.calc import recompute
from merger_arb.fixture import build_fixture, fixture_deal
from merger_arb.freshness import score_packet
from merger_arb.present import present_packet, version_history
from merger_arb.schema import field_map
from merger_arb.store import MemoryStore, PostgresStore

_STORE = None


def _deal_id(value: str) -> str:
    text = (value or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,40}", text):
        raise HTTPException(400, "That deal id is not valid")
    return text


def _ticker(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9.\-]", "", (value or "").strip().upper())[:12]
    if len(text) < 1:
        raise HTTPException(400, "Ticker is required")
    return text


def get_store():
    global _STORE
    if _STORE is not None:
        return _STORE
    url = os.environ.get("DATABASE_URL") or ""
    if url:
        def connect():
            import psycopg2
            return psycopg2.connect(url)
        _STORE = PostgresStore(connect)
    else:
        _STORE = MemoryStore()
    # The sample deal stays in memory. Do not write it into Postgres.
    if isinstance(_STORE, MemoryStore) and _STORE.get_deal("fixture-acme") is None:
        _STORE.upsert_deal(fixture_deal())
        _STORE.save_version(build_fixture())
    return _STORE


def _empty_view(store, deal: dict) -> dict:
    return {
        "empty": True,
        "deal_id": deal.get("id") or "",
        "version": None,
        "stage": "",
        "model": "",
        "as_of_pt": "",
        "badge": "",
        "sections": [],
        "flags": [],
        "stage1_notes": [],
        "refresh": [],
        "done": {},
        "versions": [],
        "cut_warning": "",
        "deal": deal,
        "deals": store.list_deals(),
    }


def _view(deal_id: str) -> dict:
    store = get_store()
    deal = store.get_deal(deal_id)
    if deal is None:
        raise HTTPException(404, "Deal not found")
    packet = store.latest(deal_id)
    if packet is None:
        return _empty_view(store, deal)
    history = version_history(store.history(deal_id))
    view = present_packet(packet, history)
    view["empty"] = False
    view["deal"] = deal
    view["deals"] = store.list_deals()
    return view


def create_router(claims_fn) -> APIRouter:
    router = APIRouter(prefix="/api/merger-arb", tags=["merger-arb"])

    def gp(request: Request) -> dict:
        claims = claims_fn(request)
        if claims.get("role") not in ("gp", "admin"):
            raise HTTPException(403, "GP only")
        return claims

    @router.get("/deals")
    def list_deals(request: Request):
        gp(request)
        return {"ok": True, "deals": get_store().list_deals()}

    @router.post("/deals")
    def create_deal(request: Request):
        gp(request)
        from api.server import _request_json_sync
        body = _request_json_sync(request) or {}
        target = _ticker(str(body.get("target_ticker") or ""))
        acquirer = _ticker(str(body.get("acquirer_ticker") or ""))
        deal_id = _deal_id(str(body.get("id") or f"{target.lower()}-{acquirer.lower()}"))
        deal = {
            "id": deal_id,
            "target_ticker": target,
            "target_name": str(body.get("target_name") or target)[:120],
            "acquirer_ticker": acquirer,
            "acquirer_name": str(body.get("acquirer_name") or acquirer)[:120],
            "announced_on": str(body.get("announced_on") or "")[:10],
            "status": "pending",
        }
        get_store().upsert_deal(deal)
        return {"ok": True, "deal": deal}

    @router.get("/analysis/{deal_id}")
    def analysis(deal_id: str, request: Request):
        gp(request)
        return {"ok": True, **_view(_deal_id(deal_id))}

    @router.post("/analysis/{deal_id}/confirm")
    def confirm(deal_id: str, request: Request):
        gp(request)
        from api.server import _request_json_sync
        body = _request_json_sync(request) or {}
        field_id = str(body.get("field_id") or "").strip()
        store = get_store()
        deal_id = _deal_id(deal_id)
        packet = store.latest(deal_id)
        if packet is None or field_id not in field_map(packet):
            raise HTTPException(404, "Field not found")
        confirmed = set(packet.get("confirmed_ids") or [])
        confirmed.add(field_id)
        packet["confirmed_ids"] = sorted(confirmed)
        field = field_map(packet)[field_id]
        field["unverified"] = False
        recompute(packet, confirmed=confirmed)
        score_packet(packet)
        meta = packet.setdefault("packet_meta", {})
        meta["parent_version"] = meta.get("version")
        meta["version"] = None
        meta["stage"] = "confirm"
        store.save_version(packet)
        return {"ok": True, **_view(deal_id)}

    @router.post("/analysis/{deal_id}/deep-dive")
    def deep_dive(deal_id: str, request: Request):
        """Run only the provider in the body. Never falls back to the other one."""
        gp(request)
        from api.server import _request_json_sync
        body = _request_json_sync(request) or {}
        provider = str(body.get("provider") or "").strip().lower()
        if provider not in ("grok", "claude"):
            raise HTTPException(400, "Pick Grok or Claude. Deep dive runs only when you click it.")
        deal_id = _deal_id(deal_id)
        store = get_store()
        deal = store.get_deal(deal_id)
        if deal is None:
            raise HTTPException(404, "Deal not found")
        from merger_arb.bundle import assemble_bundle
        from merger_arb.deep_dive import DeepDiveError, run_deep_dive

        bundle = assemble_bundle(deal)
        parent = store.latest(deal_id)
        parent_version = ((parent or {}).get("packet_meta") or {}).get("version")

        def call(system: str, user: str) -> str:
            if provider == "grok":
                from DGA_analyst import call_grok
                return call_grok(system, user, live_search=False)
            from DGA_analyst import call_claude
            return call_claude(system, user, live_search=False)

        try:
            packet = run_deep_dive(
                deal,
                bundle,
                call,
                model_name=provider,
                parent_version=parent_version,
            )
        except DeepDiveError as exc:
            raise HTTPException(502, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, f"{provider} deep dive failed") from exc
        store.save_version(packet)
        view = _view(deal_id)
        view["provider"] = provider
        return {"ok": True, **view}

    @router.post("/analysis/{deal_id}/refresh")
    def refresh(deal_id: str, request: Request):
        """Local model only. A failure here does not call Grok or Claude."""
        gp(request)
        deal_id = _deal_id(deal_id)
        store = get_store()
        deal = store.get_deal(deal_id)
        packet = store.latest(deal_id) if deal else None
        if deal is None or packet is None:
            raise HTTPException(404, "Run a deep dive before refreshing")
        from api.domains.local_finance_llm import LocalLlmError, local_settings
        from merger_arb.bundle import assemble_bundle
        from merger_arb.local_model import complete_refresh
        from merger_arb.refresh import run_refresh

        bundle = assemble_bundle(deal, peer_ticker=str(deal.get("peer_ticker") or ""))
        try:
            updated = run_refresh(
                packet,
                bundle,
                complete_refresh,
                model_name=local_settings()["model"],
            )
        except LocalLlmError as exc:
            raise HTTPException(503, str(exc)) from exc
        store.save_version(updated)
        return {"ok": True, **_view(deal_id)}

    @router.post("/analysis/{deal_id}/ask")
    def ask(deal_id: str, request: Request):
        """Follow-up on the local model. Does not call Grok or Claude."""
        gp(request)
        from api.server import _request_json_sync
        body = _request_json_sync(request) or {}
        question = str(body.get("question") or "").strip()
        if len(question) < 4:
            raise HTTPException(400, "Ask a longer question")
        deal_id = _deal_id(deal_id)
        store = get_store()
        deal = store.get_deal(deal_id)
        packet = store.latest(deal_id) if deal else None
        if deal is None or packet is None:
            raise HTTPException(404, "Run a deep dive before asking")
        from api.domains.local_finance_llm import LocalLlmError
        from merger_arb.ask import run_ask
        from merger_arb.bundle import assemble_bundle
        from merger_arb.local_model import complete_refresh

        try:
            result = run_ask(packet, question, complete_refresh, bundle=assemble_bundle(deal))
        except LocalLlmError as exc:
            raise HTTPException(503, str(exc)) from exc
        view = _view(deal_id)
        view["answer"] = result["answer"]
        view["escalate"] = result["escalate"]
        view["citations"] = result["citations"]
        view["answer_note"] = result.get("cut_warning") or ""
        return {"ok": True, **view}

    @router.get("/analysis/{deal_id}/export")
    def export(deal_id: str, request: Request):
        gp(request)
        fmt = (request.query_params.get("format") or "md").strip().lower()
        if fmt not in ("md", "json"):
            raise HTTPException(400, "Export Markdown or JSON")
        deal_id = _deal_id(deal_id)
        store = get_store()
        deal = store.get_deal(deal_id)
        packet = store.latest(deal_id) if deal else None
        if deal is None or packet is None:
            raise HTTPException(404, "No analysis yet")
        from merger_arb.export import to_json, to_markdown
        version = (packet.get("packet_meta") or {}).get("version") or 1
        if fmt == "json":
            body = to_json(packet)
            filename = f"{deal_id}-v{version}.json"
        else:
            body = to_markdown(packet, deal)
            filename = f"{deal_id}-v{version}.md"
        return {"ok": True, "body": body, "filename": filename, "format": fmt}

    return router
