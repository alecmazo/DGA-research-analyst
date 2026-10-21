"""Trial family offices.

A trial login is a demo-mode GP. It sees the sample workspace, not DGA books.
Several trials share that sample desk. A private database is a later step.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_READY = False


class OfficeCreate(BaseModel):
    name: str
    contact_name: str = ""
    email: str
    password: str


class OfficeStatus(BaseModel):
    status: str


def validate_office(name: str, email: str, password: str) -> tuple[str, str, str]:
    """Return cleaned name, email, and password, or raise ValueError."""
    name = " ".join((name or "").split())
    email = (email or "").strip().lower()
    password = password or ""
    if len(name) < 2 or len(name) > 80:
        raise ValueError("Office name must be 2 to 80 characters.")
    if not _EMAIL.match(email):
        raise ValueError("Enter a real email address.")
    if email == "demo@dgacapital.com":
        raise ValueError("That email is the shared preview login.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    return name, email, password


def _ensure(conn) -> None:
    global _READY
    if _READY:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS family_offices (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                contact_name TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'trial',
                login_lp_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS family_offices_email_uq
                ON family_offices (lower(email))
            """
        )
    conn.commit()
    _READY = True


def _row(rec) -> dict:
    created = rec[6]
    if isinstance(created, datetime):
        created = created.astimezone(timezone.utc).isoformat()
    return {
        "id": rec[0],
        "name": rec[1],
        "contact_name": rec[2],
        "email": rec[3],
        "status": rec[4],
        "login_lp_id": rec[5],
        "created_at": created,
    }


def login_block(conn_fn: Callable, email: str) -> Optional[str]:
    """Paused trials cannot sign in. A database miss does not block anyone else."""
    email = (email or "").strip().lower()
    if not email:
        return None
    try:
        with conn_fn() as conn:
            _ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT status FROM family_offices WHERE lower(email) = %s",
                    (email,),
                )
                row = cur.fetchone()
    except Exception:
        return None
    if row and row[0] == "paused":
        return "This trial is paused. Ask DGA to open it again."
    return None


def create_router(claims_fn, conn_fn, *, create_user, delete_user) -> APIRouter:
    router = APIRouter(prefix="/api/offices", tags=["family-offices"])

    def _live(request: Request) -> dict:
        claims = claims_fn(request)
        if claims.get("role") not in ("gp", "admin"):
            raise HTTPException(403, "GP access required")
        if claims.get("demo_mode"):
            raise HTTPException(403, "The live office manages trials.")
        return claims

    @router.get("")
    def list_offices(request: Request):
        _live(request)
        with conn_fn() as conn:
            _ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, contact_name, email, status, login_lp_id, created_at
                      FROM family_offices
                     ORDER BY created_at DESC
                    """
                )
                rows = cur.fetchall()
        return {
            "live": {
                "name": "DGA Capital",
                "status": "live",
                "books": "This database",
            },
            "trials": [_row(r) for r in rows],
        }

    @router.post("")
    def open_trial(request: Request, body: OfficeCreate):
        _live(request)
        try:
            name, email, password = validate_office(body.name, body.email, body.password)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        contact = " ".join((body.contact_name or "").split())[:80]
        try:
            lp_id = create_user(
                email=email,
                name=contact or name,
                password=password,
                role="gp",
                fund_memberships={},
                managed_account_ids=[],
                must_change_password=False,
                demo_mode=True,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        office_id = "office_" + secrets.token_hex(6)
        try:
            with conn_fn() as conn:
                _ensure(conn)
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO family_offices
                            (id, name, contact_name, email, status, login_lp_id)
                        VALUES (%s, %s, %s, %s, 'trial', %s)
                        """,
                        (office_id, name, contact, email, lp_id),
                    )
                conn.commit()
        except Exception:
            try:
                delete_user(lp_id)
            except Exception:
                pass
            raise HTTPException(400, "Could not open that trial. The email may already be in use.")
        return {
            "ok": True,
            "office": {
                "id": office_id,
                "name": name,
                "contact_name": contact,
                "email": email,
                "status": "trial",
                "login_lp_id": lp_id,
            },
        }

    @router.post("/{office_id}/status")
    def set_status(office_id: str, request: Request, body: OfficeStatus):
        _live(request)
        status = (body.status or "").strip().lower()
        if status not in ("trial", "paused"):
            raise HTTPException(400, "Status must be trial or paused.")
        with conn_fn() as conn:
            _ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE family_offices SET status = %s WHERE id = %s",
                    (status, office_id),
                )
                changed = cur.rowcount
            conn.commit()
        if not changed:
            raise HTTPException(404, "Office not found")
        return {"ok": True, "id": office_id, "status": status}

    return router
