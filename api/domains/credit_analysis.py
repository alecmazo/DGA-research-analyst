"""Credit page routes. A paid model runs only when the request names it."""

from __future__ import annotations

import os
import re

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request

from credit.filing import filing_view, load_filing
from credit.fixture import CIK, build_fixture
from credit.present import build_view
from credit.prices import priced_packet_body
from credit.screen import book_rows
from credit.store import MemoryStore, PostgresStore
from credit.universe import by_cik

_STORE = None
_FIXTURE_MEMORY = None


def _fixture_store() -> MemoryStore:
    global _FIXTURE_MEMORY
    if _FIXTURE_MEMORY is None:
        store = MemoryStore()
        packet = build_fixture()
        store.save_issuer(packet["issuer"], packet)
        _FIXTURE_MEMORY = store
    return _FIXTURE_MEMORY


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
        _STORE = _fixture_store()
    return _STORE


def _plain(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain(item) for item in value]
    return value


def _cik(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if not digits:
        raise HTTPException(400, "A CIK is required")
    return digits.zfill(10)[-10:]


def _saved_packet(cik: str) -> dict | None:
    store = get_store()
    if isinstance(store, MemoryStore) and cik not in store.versions:
        return None
    saved = store.latest(cik)
    if saved and (saved.get("packet_meta") or {}).get("stage") == "fixture":
        return None
    return saved


def _view_for(cik: str, body: dict | None = None, entered_by: str = "") -> dict:
    saved = _saved_packet(cik)
    if saved:
        return build_view(saved, priced_packet_body(get_store(), saved, body, entered_by))
    if cik == CIK:
        packet = build_fixture()
        return build_view(packet, priced_packet_body(get_store(), packet, body, entered_by))
    row = by_cik(cik)
    if row:
        loaded = load_filing(cik)
        note = "" if loaded.get("ok") else (loaded.get("note") or "SEC companyfacts did not load.")
        return filing_view(row, loaded.get("parsed"), body, note)
    raise HTTPException(404, "Issuer not found")


def create_router(claims_fn) -> APIRouter:
    router = APIRouter(prefix="/api/credit", tags=["credit"])

    def gp(request: Request) -> dict:
        claims = claims_fn(request)
        if claims.get("role") not in ("gp", "admin"):
            raise HTTPException(403, "GP only")
        if request.method != "GET" and claims.get("demo_mode"):
            raise HTTPException(403, "Demo cannot change credit")
        return claims

    @router.get("/issuers")
    def issuers(request: Request):
        gp(request)
        extra = [] if isinstance(get_store(), MemoryStore) else get_store().list_issuers()
        return {
            "ok": True,
            "book": "high_yield",
            "floor_pct": "6",
            "issuers": _plain(book_rows(extra)),
        }

    @router.get("/issuers/{cik}")
    def issuer(cik: str, request: Request):
        gp(request)
        return {"ok": True, **_plain(_view_for(_cik(cik)))}

    @router.post("/issuers/{cik}/compute")
    def compute(cik: str, request: Request):
        claims = gp(request)
        from api.server import _request_json_sync
        body = _request_json_sync(request) or {}
        if not isinstance(body, dict):
            body = {}
        who = str(claims.get("email") or claims.get("sub") or "")
        return {"ok": True, **_plain(_view_for(_cik(cik), body, who))}

    @router.post("/issuers/{cik}/deep-dive")
    def deep_dive(cik: str, request: Request):
        """Run only the provider in the body. There is no fallback to the other provider."""
        gp(request)
        from api.server import _request_json_sync
        body = _request_json_sync(request) or {}
        provider = str(body.get("provider") or "").strip().lower()
        if provider not in {"grok", "claude"}:
            raise HTTPException(400, "Choose Grok or Claude. Credit will not pick one for you.")
        raise HTTPException(501, "Deep dive is not turned on yet. The page math does not call a model.")

    return router
