"""Family-office registry.

This table lives in DGA's database and holds names only. An office's books
go in a separate Postgres database. This module does not create that database
and does not create a login on this site.
"""
from __future__ import annotations

import json
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
    password: str = ""


class OfficeStatus(BaseModel):
    status: str


class OfficeErase(BaseModel):
    confirm: str = ""


def slug_from_name(name: str) -> str:
    raw = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    raw = re.sub(r"_+", "_", raw)
    if not raw or not raw[0].isalpha():
        raw = "office_" + raw
    return raw[:31].strip("_")


def database_name(slug: str) -> str:
    return "dga_" + slug


def office_setup(
    name: str,
    db_name: str,
    email: str,
    status: str,
    hostname: str = "",
    error: str = "",
) -> dict:
    """What to do next on this DGA site after an office row exists.

    ``ready`` means the empty database was marked created. The test login
    still lives on the other web service. This site stays on DGA's books.
    """
    name = (name or "").strip() or "This office"
    db_name = (db_name or "").strip() or "dga_<name>"
    email = (email or "").strip() or "the contact email"
    status = status if status in _STATUSES else "planned"
    ready = status == "ready"
    hostname = (hostname or "").strip()
    error = (error or "").strip()
    if status == "error" and error:
        note = error
    elif hostname and ready:
        note = (
            f"Sign in at https://{hostname} as {email}. "
            f"That address opens {db_name}. "
            "portfolio.dgacapital.com stays DGA Capital."
        )
    elif status == "held":
        note = f"{name} is on hold. Its database name stays {db_name}."
    elif ready:
        note = (
            f"{db_name} is marked ready for {name}. "
            f"Log in and test it on the web service that uses {db_name}: "
            f"sign in there as {email}. "
            "portfolio.dgacapital.com stays DGA Capital."
        )
    else:
        note = (
            f"{name} is on the list. Its database name is {db_name}. "
            "Nothing was created in Postgres yet."
        )
    steps = [
        {
            "done": True,
            "text": (
                "This page stores the office name in DGA's database only. "
                "It does not copy books, notes, or users."
            ),
        },
        {
            "done": ready,
            "text": (
                f"{db_name} is the empty database for this office."
                if ready
                else (
                    f"Create an empty Postgres database named {db_name}. "
                    "Do not add a schema or a tenant column to the DGA database. "
                    "Mark this row ready when that database exists."
                )
            ),
        },
        {
            "done": False,
            "text": (
                "Create a second web service from this same repo, branch main. "
                f"Set its DATABASE_URL to {db_name}. "
                "Leave DGA's DATABASE_URL on the current service."
            ),
        },
        {
            "done": False,
            "text": (
                "Start that service once. The app creates its own tables on the empty database. "
                "Books and notes start empty."
            ),
        },
        {
            "done": False,
            "text": (
                f"On that service, create the GP login for {email} and sign in to test the empty books."
            ),
        },
        {
            "done": False,
            "text": (
                "Give the service its own hostname. Logo and office name are settings in that database."
            ),
        },
    ]
    if hostname and ready:
        for step in steps:
            step["done"] = True
            step["text"] = step["text"]
        steps[2]["text"] = f"The web service for {hostname} uses {db_name}."
        steps[3]["text"] = "That service has started. Books and notes start empty."
        steps[4]["text"] = f"The GP login for {email} is on {hostname}."
        steps[5]["text"] = f"The hostname is {hostname}."
    marked = False
    for step in steps:
        step["current"] = False
        if not marked and not step["done"]:
            step["current"] = True
            marked = True
    return {"note": note, "steps": steps, "hostname": hostname}


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
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS hostname TEXT")
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS provision_error TEXT")
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS web_service_id TEXT")
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS db_service_id TEXT")
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS domain_id TEXT")
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS dns_record_ids TEXT")
        cur.execute("ALTER TABLE family_offices ADD COLUMN IF NOT EXISTS dns_records TEXT")
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
    hostname = rec[9] or ""
    error = rec[10] or ""
    status = rec[4] or "planned"
    return {
        "id": rec[0],
        "name": rec[1],
        "contact_name": rec[2],
        "email": rec[3],
        "status": status,
        "created_at": created,
        "slug": rec[7],
        "db_name": rec[8],
        "hostname": hostname,
        "provision_error": error,
        "dns_records": _dns(rec[15] if len(rec) > 15 else ""),
        "setup": office_setup(rec[1], rec[8] or "", rec[3], status, hostname, error),
    }


def _dns(raw) -> list:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


_LIST_SQL = """
SELECT id, name, contact_name, email, status, login_lp_id, created_at, slug, db_name,
       hostname, provision_error, web_service_id, db_service_id, domain_id, dns_record_ids,
       dns_records
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


def _load_one(conn_fn, office_id: str) -> dict:
    with conn_fn() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute(_LIST_SQL + " WHERE id = %s", (office_id,))
            rec = cur.fetchone()
    if not rec:
        raise HTTPException(404, "Office not found")
    return _row(rec)


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
        from api.domains.office_provision import BASE_DOMAIN

        return {
            "live": {
                "name": "DGA Capital",
                "status": "live",
                "db_name": "this database",
                "service": "web",
            },
            "base_domain": BASE_DOMAIN,
            "offices": [_row(r) for r in rows],
        }

    @router.post("")
    def add_office(request: Request, body: OfficeCreate):
        _live(request)
        from api.domains.office_provision import (
            OfficeProvisionError,
            configured,
            create_office_instance,
            hostname_for,
        )

        if not configured():
            raise HTTPException(503, "This service has no Railway token, so it cannot create an office.")
        try:
            name, email, slug, db_name = validate_office(body.name, body.email, body.slug)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        password = body.password or ""
        if len(password) < 6:
            raise HTTPException(400, "Password must be at least 6 characters.")
        contact = " ".join((body.contact_name or "").split())[:80]
        office_id = "office_" + secrets.token_hex(6)
        hostname = hostname_for(slug)
        try:
            with conn_fn() as conn:
                _ensure(conn)
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO family_offices
                            (id, name, contact_name, email, status, slug, db_name, hostname)
                        VALUES (%s, %s, %s, %s, 'provisioning', %s, %s, %s)
                        """,
                        (office_id, name, contact, email, slug, db_name, hostname),
                    )
                conn.commit()
        except Exception:
            raise HTTPException(400, "Could not add that office. The email or database name is already used.")
        status = "ready"
        error = ""
        dns_records: list = []
        try:
            created = create_office_instance(slug, email, contact or name, password)
            dns_records = created.get("dns_records") or []
            if created.get("login_error"):
                status = "error"
                error = "The office service is up. The first login was not created yet. " + created["login_error"]
            if not created.get("dns_published") and dns_records:
                error = (error + " " if error else "") + "Publish the DNS records shown on this page."
                if status == "ready":
                    status = "error"
            with conn_fn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE family_offices
                           SET status = %s,
                               hostname = %s,
                               provision_error = %s,
                               web_service_id = %s,
                               db_service_id = %s,
                               domain_id = %s,
                               dns_record_ids = %s,
                               dns_records = %s
                         WHERE id = %s
                        """,
                        (
                            status,
                            created.get("hostname") or hostname,
                            error,
                            created.get("web_service_id"),
                            created.get("db_service_id"),
                            created.get("domain_id"),
                            json.dumps(created.get("dns_record_ids") or []),
                            json.dumps(dns_records),
                            office_id,
                        ),
                    )
                conn.commit()
        except (OfficeProvisionError, Exception) as exc:
            status = "error"
            error = str(exc)[:300]
            with conn_fn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE family_offices SET status = 'error', provision_error = %s WHERE id = %s",
                        (error, office_id),
                    )
                conn.commit()
        office = _load_one(conn_fn, office_id)
        office["dns_records"] = dns_records
        return {"ok": status == "ready", "office": office}

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
                cur.execute(_LIST_SQL + " WHERE id = %s", (office_id,))
                rec = cur.fetchone()
            conn.commit()
        if not changed or not rec:
            raise HTTPException(404, "Office not found")
        office = _row(rec)
        return {"ok": True, "id": office_id, "status": status, "office": office}

    @router.post("/{office_id}/erase")
    def erase_office(office_id: str, request: Request, body: OfficeErase):
        _live(request)
        from api.domains.office_provision import OfficeProvisionError, erase_office_instance

        with conn_fn() as conn:
            _ensure(conn)
            with conn.cursor() as cur:
                cur.execute(_LIST_SQL + " WHERE id = %s", (office_id,))
                rec = cur.fetchone()
        if not rec:
            raise HTTPException(404, "Office not found")
        if (body.confirm or "").strip() != (rec[1] or "").strip():
            raise HTTPException(400, "Type the office name to erase it.")
        dns_ids = []
        if rec[14]:
            try:
                dns_ids = json.loads(rec[14])
            except json.JSONDecodeError:
                dns_ids = []
        try:
            erase_office_instance(rec[11] or "", rec[12] or "", rec[13] or "", dns_ids)
        except OfficeProvisionError as exc:
            raise HTTPException(400, str(exc)) from exc
        with conn_fn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM family_offices WHERE id = %s", (office_id,))
            conn.commit()
        return {"ok": True, "id": office_id}

    return router
