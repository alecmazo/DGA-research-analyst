"""Family-office registry.

This table lives in DGA's database and holds names only. An office's books
go in a separate Postgres database. This module does not create that database
and does not create a login on this site.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SLUG = re.compile(r"^[a-z][a-z0-9_]{1,30}$")
_RESERVED = {"dga", "postgres", "template0", "template1", "demo", "railway"}
_READY = False
_STATUSES = ("planned", "held", "ready")


class OfficeCreate(BaseModel):
    name: str
    contact_name: str = ""
    email: str
    slug: str = ""


class OfficeStatus(BaseModel):
    status: str


def slug_from_name(name: str) -> str:
    raw = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    raw = re.sub(r"_+", "_", raw)
    if not raw or not raw[0].isalpha():
        raw = "office_" + raw
    return raw[:31].strip("_")


def database_name(slug: str) -> str:
    return "dga_" + slug


def validate_office(name: str, email: str, slug: str = "") -> tuple[str, str, str, str]:
    """Return name, email, slug, and database name, or raise ValueError."""
    name = " ".join((name or "").split())
    email = (email or "").strip().lower()
    slug = (slug or slug_from_name(name)).strip().lower().replace("-", "_")
    if len(name) < 2 or len(name) > 80:
        raise ValueError("Office name must be 2 to 80 characters.")
    if not _EMAIL.match(email):
        raise ValueError("Enter a real email address.")
    if email == "demo@dgacapital.com":
        raise ValueError("That email is the shared preview login.")
    if not _SLUG.match(slug) or slug in _RESERVED:
        raise ValueError("Database name must start with a letter and use only letters, numbers, and underscores.")
    return name, email, slug, database_name(slug)


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
                status TEXT NOT NULL DEFAULT 'planned',
                login_lp_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                slug TEXT,
                db_name TEXT
            )
            """
        )
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS slug TEXT")
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS db_name TEXT")
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS family_offices_email_uq
                ON family_offices (lower(email))
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS family_offices_slug_uq
                ON family_offices (slug)
                WHERE slug IS NOT NULL
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
        "status": rec[4] or "planned",
        "created_at": created,
        "slug": rec[7],
        "db_name": rec[8],
    }


_LIST_SQL = """
SELECT id, name, contact_name, email, status, login_lp_id, created_at, slug, db_name
  FROM family_offices
"""


def login_block(conn_fn: Callable, email: str) -> Optional[str]:
    """Block only a login this site actually created, and only when that office is held.

    A new office has no login here, so a held row does not affect anyone else
    who happens to share the contact email.
    """
    email = (email or "").strip().lower()
    if not email:
        return None
    try:
        with conn_fn() as conn:
            _ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT status, login_lp_id FROM family_offices WHERE lower(email) = %s",
                    (email,),
                )
                row = cur.fetchone()
    except Exception:
        return None
    if row and row[1] and row[0] in ("paused", "held"):
        return "This trial is paused. Ask DGA to open it again."
    return None


def create_router(claims_fn, conn_fn) -> APIRouter:
    router = APIRouter(prefix="/api/offices", tags=["family-offices"])

    def _live(request: Request) -> dict:
        claims = claims_fn(request)
        if claims.get("role") not in ("gp", "admin"):
            raise HTTPException(403, "GP access required")
        if claims.get("demo_mode"):
            raise HTTPException(403, "The live office manages other offices.")
        return claims

    @router.get("")
    def list_offices(request: Request):
        _live(request)
        with conn_fn() as conn:
            _ensure(conn)
            with conn.cursor() as cur:
                cur.execute(_LIST_SQL + " ORDER BY created_at DESC")
                rows = cur.fetchall()
        return {
            "live": {
                "name": "DGA Capital",
                "status": "live",
                "db_name": "this database",
                "service": "web",
            },
            "offices": [_row(r) for r in rows],
        }

    @router.post("")
    def add_office(request: Request, body: OfficeCreate):
        _live(request)
        try:
            name, email, slug, db_name = validate_office(body.name, body.email, body.slug)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        contact = " ".join((body.contact_name or "").split())[:80]
        office_id = "office_" + secrets.token_hex(6)
        try:
            with conn_fn() as conn:
                _ensure(conn)
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO family_offices
                            (id, name, contact_name, email, status, slug, db_name)
                        VALUES (%s, %s, %s, %s, 'planned', %s, %s)
                        """,
                        (office_id, name, contact, email, slug, db_name),
                    )
                conn.commit()
        except Exception:
            raise HTTPException(400, "Could not add that office. The email or database name is already used.")
        return {
            "ok": True,
            "office": {
                "id": office_id,
                "name": name,
                "contact_name": contact,
                "email": email,
                "status": "planned",
                "slug": slug,
                "db_name": db_name,
            },
        }

    @router.post("/{office_id}/status")
    def set_status(office_id: str, request: Request, body: OfficeStatus):
        _live(request)
        status = (body.status or "").strip().lower()
        if status not in _STATUSES:
            raise HTTPException(400, "Status must be planned, held, or ready.")
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
