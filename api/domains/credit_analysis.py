"""Credit page routes. A paid model runs only when the request names it."""

from __future__ import annotations

import os
import re

from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request

from credit.fixture import CIK, build_fixture
from credit.present import build_view
from credit.store import MemoryStore, PostgresStore

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


def _packet_for(cik: str) -> dict:
    store = get_store()
    saved = store.latest(cik) if not isinstance(store, MemoryStore) or cik in store.versions else None
    if saved and (saved.get("packet_meta") or {}).get("stage") != "fixture":
        return saved
    if cik == CIK:
        return build_fixture()
    if saved:
        return saved
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
        rows = [{"cik": CIK, "legal_name": "Paramount Skydance Corporation", "ticker": "PSKY", "status": "watch", "fixture": True}]
        for row in get_store().list_issuers():
            if row.get("cik") == CIK and isinstance(get_store(), MemoryStore):
                continue
            if row.get("cik") and row["cik"] not in {item["cik"] for item in rows}:
                rows.append(row)
        return {"ok": True, "issuers": rows}

    @router.get("/issuers/{cik}")
    def issuer(cik: str, request: Request):
        gp(request)
        cik = _cik(cik)
        return {"ok": True, **_plain(build_view(_packet_for(cik)))}

    @router.post("/issuers/{cik}/compute")
    def compute(cik: str, request: Request):
        gp(request)
        from api.server import _request_json_sync
        body = _request_json_sync(request) or {}
        if not isinstance(body, dict):
            body = {}
        view = build_view(_packet_for(_cik(cik)), body)
        return {"ok": True, **_plain(view)}

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
