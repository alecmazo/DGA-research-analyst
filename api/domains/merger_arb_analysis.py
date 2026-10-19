"""HTTP routes for the merger arb analysis page. The main desk is not involved."""

from __future__ import annotations

import json
import os
import re

from fastapi import APIRouter, HTTPException, Request

from merger_arb.calc import recompute
from merger_arb.fixture import build_fixture, fixture_deal
from merger_arb.freshness import format_pt, score_packet
from merger_arb.present import present_packet, version_history
from merger_arb.query import parse_query, query_deals
from merger_arb.schema import field_map
from merger_arb.score import inputs_from_deal
from merger_arb.store import MemoryStore, PostgresStore

_STORE = None
_STAGES = {"screen", "watch", "active", "closed", "broken", "ignored"}


def _deal_id(value: str) -> str:
    text = (value or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,40}", text):
        raise HTTPException(400, "That deal id is not valid")
    return text


def _json_body(request: Request) -> dict:
    cached = getattr(request, "_json", None)
    if isinstance(cached, dict):
        return cached
    raw = getattr(request, "_body", None)
    if not isinstance(raw, (bytes, bytearray)) or not raw:
        try:
            import anyio

            async def _read():
                return await request.body()

            raw = anyio.from_thread.run(_read)
        except Exception:
            raw = b""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


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


def _view(deal_id: str, store=None) -> dict:
    store = store if store is not None else get_store()
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


def _stamp_overrides(overrides, claims: dict) -> dict:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    user = str(claims.get("email") or claims.get("name") or "").strip()
    out = {}
    for key, value in (overrides or {}).items():
        item = dict(value) if isinstance(value, dict) else {"value": value}
        item.setdefault("user", user)
        item.setdefault("at", now)
        item.setdefault("at_pt", format_pt(now))
        out[str(key)] = item
    house = out.get("house_p")
    if house and house.get("value") is not None and not str(house.get("note") or "").strip():
        raise HTTPException(400, "house probability override requires a note")
    return out


def _filings(store, deal_id: str) -> list[dict]:
    seen = set()
    rows = []
    for field in store.list_deal_fields(deal_id):
        url = str(field.get("source_url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        rows.append({
            "title": field.get("field_name") or "",
            "source_name": field.get("source_name") or "",
            "url": url,
            "pulled_at": field.get("pulled_at") or "",
            "pulled_at_pt": format_pt(field.get("pulled_at") or ""),
        })
    packet = store.latest(deal_id) if hasattr(store, "latest") else None
    for source in (packet or {}).get("sources") or []:
        url = str((source or {}).get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        rows.append({
            "title": source.get("name") or source.get("form") or "",
            "source_name": source.get("name") or "",
            "url": url,
            "pulled_at": source.get("pulled_at") or "",
            "pulled_at_pt": format_pt(source.get("pulled_at") or ""),
        })
    return rows


def _price_of(quote) -> float | None:
    if quote is None or isinstance(quote, bool):
        return None
    raw = quote.get("price") if isinstance(quote, dict) else quote
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return None
    if number != number or number <= 0:
        return None
    return number


def fill_missing_prices(rows: list[dict], quotes_fn) -> dict[str, float]:
    """Last price for a screen row that has none. No offer still means terms are missing."""
    remembered: dict[str, float] = {}
    if not rows:
        return remembered
    need = []
    for row in rows:
        stage = row.get("stage") or "screen"
        if stage in ("screen", "watch", "active") and row.get("offer_value") is None:
            row["needs_manual_terms"] = True
        if row.get("target_price") is None and row.get("target_ticker"):
            need.append(row)
    if not need or quotes_fn is None:
        return remembered
    try:
        raw = quotes_fn([row.get("target_ticker") for row in need]) or {}
    except Exception:
        return remembered
    for row in need:
        ticker = str(row.get("target_ticker") or "").upper()
        price = _price_of(raw.get(ticker) if isinstance(raw, dict) else None)
        if price is None and isinstance(raw, dict):
            price = _price_of(raw.get(row.get("target_ticker")))
        if price is None:
            continue
        row["target_price"] = price
        deal_id = row.get("id") or ""
        if deal_id:
            remembered[deal_id] = price
    return remembered


def create_router(claims_fn, *, store=None, quotes_fn=None) -> APIRouter:
    router = APIRouter(prefix="/api/merger-arb", tags=["merger-arb"])

    def gp(request: Request) -> dict:
        claims = claims_fn(request)
        if claims.get("role") not in ("gp", "admin"):
            raise HTTPException(403, "GP only")
        return claims

    def desk():
        return store if store is not None else get_store()

    @router.get("/deals")
    def list_deals(request: Request):
        gp(request)
        result = query_deals(desk().list_deals(), parse_query(request.query_params))
        remembered = fill_missing_prices(result.get("deals") or [], quotes_fn)
        book = desk()
        if remembered and hasattr(book, "remember_prices"):
            book.remember_prices(remembered)
        return {"ok": True, **result}

    @router.get("/deals/{deal_id}")
    def get_deal(deal_id: str, request: Request):
        gp(request)
        deal_id = _deal_id(deal_id)
        found = desk().get_deal(deal_id)
        if found is None:
            raise HTTPException(404, "Deal not found")
        from merger_arb.query import public_deal
        shown = public_deal(found)
        remembered = fill_missing_prices([shown], quotes_fn)
        if remembered and hasattr(desk(), "remember_prices"):
            desk().remember_prices(remembered)
        history = []
        if hasattr(desk(), "history"):
            history = version_history(desk().history(deal_id))
        return {
            "ok": True,
            "deal": shown,
            "terms": found.get("terms_json") or {},
            "metrics": found.get("metrics_json") or {},
            "score": found.get("score_json") or {},
            "fields": desk().list_deal_fields(deal_id),
            "regulatory": desk().list_regulatory(deal_id),
            "events": desk().list_events(deal_id),
            "spread_history": desk().list_spread_history(deal_id),
            "filings": _filings(desk(), deal_id),
            "versions": history,
        }

    @router.patch("/deals/{deal_id}")
    def patch_deal(deal_id: str, request: Request):
        claims = gp(request)
        body = _json_body(request)
        deal_id = _deal_id(deal_id)
        found = desk().get_deal(deal_id)
        if found is None:
            raise HTTPException(404, "Deal not found")
        if "stage" in body:
            stage = str(body.get("stage") or "").strip().lower()
            if stage not in _STAGES:
                raise HTTPException(400, "Unknown stage")
            found["stage"] = stage
        overrides = body.get("overrides")
        if overrides:
            stamped = _stamp_overrides(overrides, claims)
            try:
                desk().score_deal_row(found, inputs_from_deal(found), overrides=stamped)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
        else:
            desk().upsert_deal(found)
        updated = desk().get_deal(deal_id)
        from merger_arb.query import public_deal
        return {"ok": True, "deal": public_deal(updated or found)}

    @router.get("/score-config")
    def get_score_config(request: Request):
        gp(request)
        return {"ok": True, "config": desk().latest_score_config()}

    @router.put("/score-config")
    def put_score_config(request: Request):
        claims = gp(request)
        body = _json_body(request)
        weights = body.get("weights")
        if not isinstance(weights, dict):
            raise HTTPException(400, "weights must be an object")
        try:
            config = desk().save_score_config(
                weights,
                thresholds=body.get("thresholds"),
                created_by=str(claims.get("email") or claims.get("name") or ""),
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        rescored = desk().rescore_all()
        return {"ok": True, "config": config, "rescored": rescored}

    @router.post("/deals")
    def create_deal(request: Request):
        gp(request)
        body = _json_body(request)
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
            "stage": "watch",
        }
        desk().upsert_deal(deal)
        return {"ok": True, "deal": deal}

    @router.get("/analysis/{deal_id}")
    def analysis(deal_id: str, request: Request):
        gp(request)
        return {"ok": True, **_view(_deal_id(deal_id), desk())}

    @router.post("/analysis/{deal_id}/confirm")
    def confirm(deal_id: str, request: Request):
        gp(request)
        body = _json_body(request)
        field_id = str(body.get("field_id") or "").strip()
        store = desk()
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
        return {"ok": True, **_view(deal_id, store)}

    @router.post("/analysis/{deal_id}/deep-dive")
    def deep_dive(deal_id: str, request: Request):
        """Run only the provider in the body. Never falls back to the other one."""
        gp(request)
        body = _json_body(request)
        provider = str(body.get("provider") or "").strip().lower()
        if provider not in ("grok", "claude"):
            raise HTTPException(400, "Pick Grok or Claude. Deep dive runs only when you click it.")
        deal_id = _deal_id(deal_id)
        store = desk()
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
        view = _view(deal_id, store)
        view["provider"] = provider
        return {"ok": True, **view}

    @router.post("/analysis/{deal_id}/refresh")
    def refresh(deal_id: str, request: Request):
        """Local model only. A failure here does not call Grok or Claude."""
        gp(request)
        deal_id = _deal_id(deal_id)
        store = desk()
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
        return {"ok": True, **_view(deal_id, store)}

    @router.post("/analysis/{deal_id}/ask")
    def ask(deal_id: str, request: Request):
        """Follow-up on the local model. Does not call Grok or Claude."""
        gp(request)
        body = _json_body(request)
        question = str(body.get("question") or "").strip()
        if len(question) < 4:
            raise HTTPException(400, "Ask a longer question")
        deal_id = _deal_id(deal_id)
        store = desk()
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
        view = _view(deal_id, store)
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
        store = desk()
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
