"""
Multi-book CRM for Sliw Agent (corporate + wedding) + partnerships.

Primary storage (production):
  Postgres table sliw_crm_books when DATABASE_URL is set — shared across the
  portfolio `web` service and the dedicated `sliw` service so form posts on
  weddings.edytasliwinska.com appear in the desk at sliw.edytasliwinska.com.

Local fallback / cache:
  DATA_DIR/crm.json, wedding_crm.json, partnerships.json
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _resolve_data_dir() -> Path:
    dedicated = (os.environ.get("SLIW_DATA_DIR") or "").strip()
    if dedicated:
        return Path(dedicated)
    stocks = (os.environ.get("STOCKS_FOLDER") or "").strip()
    if stocks:
        return Path(stocks) / "sliw-agent"
    return Path(__file__).resolve().parent.parent / "data"


DATA_DIR = _resolve_data_dir()
CRM_PATH = DATA_DIR / "crm.json"
WEDDING_CRM_PATH = DATA_DIR / "wedding_crm.json"
PARTNERSHIPS_PATH = DATA_DIR / "partnerships.json"
OUTREACH_DIR = DATA_DIR / "outreach"
DECKS_DIR = DATA_DIR / "decks"
BRIEFS_DIR = DATA_DIR / "briefs"
WEDDING_OUTREACH_DIR = DATA_DIR / "wedding_outreach"
WEDDING_DECKS_DIR = DATA_DIR / "wedding_decks"
WEDDING_BRIEFS_DIR = DATA_DIR / "wedding_briefs"

STAGES = [
    "research",
    "scored",
    "packaged",
    "drafted",
    "approved",
    "contacted",
    "replied",
    "interested",
    "discovery_booked",
    "won",
    "lost",
    "nurture",
    "disqualified",
]

BOOKS = ("corporate", "wedding")

DEFAULT_CRM: dict[str, Any] = {
    "version": 2,
    "book": "corporate",
    "updated_at": None,
    "prospects": {},
}

_pg_lock = threading.Lock()
_pg_ready = False
_pg_ok: bool | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs() -> None:
    for d in (
        DATA_DIR,
        OUTREACH_DIR,
        DECKS_DIR,
        BRIEFS_DIR,
        WEDDING_OUTREACH_DIR,
        WEDDING_DECKS_DIR,
        WEDDING_BRIEFS_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)


def _crm_path(book: str = "corporate") -> Path:
    if book == "wedding":
        return WEDDING_CRM_PATH
    return CRM_PATH


def _dirs_for_book(book: str = "corporate") -> dict[str, Path]:
    if book == "wedding":
        return {
            "outreach": WEDDING_OUTREACH_DIR,
            "decks": WEDDING_DECKS_DIR,
            "briefs": WEDDING_BRIEFS_DIR,
        }
    return {
        "outreach": OUTREACH_DIR,
        "decks": DECKS_DIR,
        "briefs": BRIEFS_DIR,
    }


def _database_url() -> str:
    return (os.environ.get("DATABASE_URL") or "").strip()


def _use_postgres() -> bool:
    global _pg_ok
    if _pg_ok is not None:
        return _pg_ok
    if not _database_url():
        _pg_ok = False
        return False
    try:
        import psycopg2  # noqa: F401
        _pg_ok = True
    except Exception:
        _pg_ok = False
    return _pg_ok


def _pg_connect():
    import psycopg2

    url = _database_url()
    # Railway sometimes needs sslmode
    return psycopg2.connect(url, connect_timeout=10)


def _ensure_pg_schema() -> None:
    global _pg_ready
    if _pg_ready or not _use_postgres():
        return
    with _pg_lock:
        if _pg_ready:
            return
        try:
            conn = _pg_connect()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS sliw_crm_books (
                            book TEXT PRIMARY KEY,
                            payload JSONB NOT NULL,
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                        """
                    )
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS sliw_kv (
                            key TEXT PRIMARY KEY,
                            payload JSONB NOT NULL,
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                        """
                    )
                conn.commit()
                _pg_ready = True
                print("[sliw-crm] Postgres shared store ready (sliw_crm_books)", flush=True)
            finally:
                conn.close()
        except Exception as exc:
            print(f"[sliw-crm] Postgres schema init failed, using files: {exc!r}", flush=True)
            global _pg_ok
            _pg_ok = False


def _load_file_crm(book: str) -> dict[str, Any] | None:
    ensure_dirs()
    path = _crm_path(book)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if "book" not in data:
            data["book"] = book
        if not isinstance(data.get("prospects"), dict):
            data["prospects"] = {}
        return data
    except Exception as exc:
        print(f"[sliw-crm] file read failed {path}: {exc!r}", flush=True)
        return None


def _write_file_crm(crm: dict[str, Any], book: str) -> None:
    ensure_dirs()
    crm["updated_at"] = crm.get("updated_at") or _now()
    crm["book"] = book
    _crm_path(book).write_text(
        json.dumps(crm, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _prospect_ts(p: dict[str, Any]) -> str:
    return str(p.get("updated_at") or p.get("created_at") or "")


def _merge_crm_books(a: dict[str, Any], b: dict[str, Any], book: str) -> dict[str, Any]:
    """Union prospects by id; keep the record with the newer updated_at."""
    out = deepcopy(DEFAULT_CRM)
    out["book"] = book
    out["version"] = max(int(a.get("version") or 2), int(b.get("version") or 2), 2)
    merged: dict[str, Any] = {}
    for src in (a, b):
        for pid, rec in (src.get("prospects") or {}).items():
            if not pid or not isinstance(rec, dict):
                continue
            prev = merged.get(pid)
            if not prev or _prospect_ts(rec) >= _prospect_ts(prev):
                row = dict(rec)
                row["id"] = pid
                row["book"] = book
                merged[pid] = row
    out["prospects"] = merged
    # Prefer newest book-level timestamp
    ta = str(a.get("updated_at") or "")
    tb = str(b.get("updated_at") or "")
    out["updated_at"] = max(ta, tb) if (ta or tb) else _now()
    return out


def _load_pg_crm(book: str) -> dict[str, Any] | None:
    _ensure_pg_schema()
    if not _use_postgres():
        return None
    try:
        conn = _pg_connect()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT payload FROM sliw_crm_books WHERE book = %s",
                    (book,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                data = row[0]
                if isinstance(data, str):
                    data = json.loads(data)
                if not isinstance(data, dict):
                    return None
                if "book" not in data:
                    data["book"] = book
                if not isinstance(data.get("prospects"), dict):
                    data["prospects"] = {}
                return data
        finally:
            conn.close()
    except Exception as exc:
        print(f"[sliw-crm] Postgres load failed: {exc!r}", flush=True)
        return None


def _save_pg_crm(crm: dict[str, Any], book: str) -> bool:
    _ensure_pg_schema()
    if not _use_postgres():
        return False
    payload = dict(crm)
    payload["book"] = book
    payload["updated_at"] = _now()
    try:
        conn = _pg_connect()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO sliw_crm_books (book, payload, updated_at)
                    VALUES (%s, %s::jsonb, NOW())
                    ON CONFLICT (book) DO UPDATE
                    SET payload = EXCLUDED.payload,
                        updated_at = NOW()
                    """,
                    (book, json.dumps(payload, ensure_ascii=False)),
                )
            conn.commit()
            return True
        finally:
            conn.close()
    except Exception as exc:
        print(f"[sliw-crm] Postgres save failed: {exc!r}", flush=True)
        return False


def load_crm(book: str = "corporate") -> dict[str, Any]:
    """Load CRM book. Prefer shared Postgres; merge local file so nothing is lost."""
    ensure_dirs()
    file_data = _load_file_crm(book)
    pg_data = _load_pg_crm(book) if _use_postgres() else None

    if pg_data is not None and file_data is not None:
        merged = _merge_crm_books(pg_data, file_data, book)
        # If file had prospects missing from PG, push merge up
        if len(merged.get("prospects") or {}) > len(pg_data.get("prospects") or {}):
            _save_pg_crm(merged, book)
            _write_file_crm(merged, book)
            return merged
        # Keep local cache warm
        try:
            _write_file_crm(pg_data if len(pg_data.get("prospects") or {}) >= len(
                merged.get("prospects") or {}
            ) else merged, book)
        except Exception:
            pass
        return merged if len(merged.get("prospects") or {}) >= len(
            pg_data.get("prospects") or {}
        ) else pg_data

    if pg_data is not None:
        try:
            _write_file_crm(pg_data, book)
        except Exception:
            pass
        return pg_data

    if file_data is not None:
        # Seed shared store from this service's local file (recovery / first migrate)
        if _use_postgres():
            _save_pg_crm(file_data, book)
        return file_data

    crm = deepcopy(DEFAULT_CRM)
    crm["book"] = book
    crm["updated_at"] = _now()
    save_crm(crm, book=book)
    return crm


def save_crm(crm: dict[str, Any], book: str = "corporate") -> None:
    ensure_dirs()
    crm["updated_at"] = _now()
    crm["book"] = book
    # Shared store first (source of truth across Railway services)
    _save_pg_crm(crm, book)
    # Local cache / offline fallback
    try:
        _write_file_crm(crm, book)
    except Exception as exc:
        print(f"[sliw-crm] local file save failed: {exc!r}", flush=True)


# ── Shared key-value (media config, small settings) ───────────────────────────

def load_kv(key: str) -> dict[str, Any] | None:
    """Load a shared JSON blob (Postgres when available)."""
    key = (key or "").strip()
    if not key:
        return None
    _ensure_pg_schema()
    if _use_postgres():
        try:
            conn = _pg_connect()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT payload FROM sliw_kv WHERE key = %s",
                        (key,),
                    )
                    row = cur.fetchone()
                    if not row:
                        return None
                    data = row[0]
                    if isinstance(data, str):
                        data = json.loads(data)
                    return data if isinstance(data, dict) else None
            finally:
                conn.close()
        except Exception as exc:
            print(f"[sliw-crm] kv load failed {key}: {exc!r}", flush=True)
    # file fallback
    path = DATA_DIR / "kv" / f"{key}.json"
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except Exception:
            return None
    return None


def save_kv(key: str, payload: dict[str, Any]) -> dict[str, Any]:
    key = (key or "").strip()
    if not key:
        raise ValueError("kv key required")
    body = dict(payload or {})
    body["_updated_at"] = _now()
    _ensure_pg_schema()
    if _use_postgres():
        try:
            conn = _pg_connect()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO sliw_kv (key, payload, updated_at)
                        VALUES (%s, %s::jsonb, NOW())
                        ON CONFLICT (key) DO UPDATE
                        SET payload = EXCLUDED.payload, updated_at = NOW()
                        """,
                        (key, json.dumps(body, ensure_ascii=False)),
                    )
                conn.commit()
            finally:
                conn.close()
        except Exception as exc:
            print(f"[sliw-crm] kv save failed {key}: {exc!r}", flush=True)
    # local cache
    try:
        ensure_dirs()
        kv_dir = DATA_DIR / "kv"
        kv_dir.mkdir(parents=True, exist_ok=True)
        (kv_dir / f"{key}.json").write_text(
            json.dumps(body, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    except Exception as exc:
        print(f"[sliw-crm] kv file save failed: {exc!r}", flush=True)
    return body


def new_prospect_id(company: str) -> str:
    slug = "".join(c.lower() if c.isalnum() else "-" for c in company).strip("-")
    slug = "-".join(part for part in slug.split("-") if part)[:48]
    return f"{slug}-{uuid.uuid4().hex[:6]}"


def upsert_prospect(
    *,
    company: str,
    industry: str = "",
    geo: str = "",
    employee_range: str = "",
    website: str = "",
    notes: str = "",
    signals: list[str] | None = None,
    contacts: list[dict[str, str]] | None = None,
    prospect_id: str | None = None,
    extra: dict[str, Any] | None = None,
    book: str = "corporate",
) -> dict[str, Any]:
    crm = load_crm(book)
    if prospect_id and prospect_id in crm["prospects"]:
        p = crm["prospects"][prospect_id]
    else:
        existing_id = None
        for pid, rec in crm["prospects"].items():
            if rec.get("company", "").lower() == company.lower():
                existing_id = pid
                break
        if existing_id:
            prospect_id = existing_id
            p = crm["prospects"][prospect_id]
        else:
            prospect_id = new_prospect_id(company)
            p = {
                "id": prospect_id,
                "book": book,
                "company": company,
                "created_at": _now(),
                "stage": "research",
                "score": None,
                "recommended_packages": [],
                "contacts": [],
                "signals": [],
                "gamma_url": None,
                "gamma_pptx": None,
                "outreach_path": None,
                "edyta_brief_path": None,
                "history": [],
            }
            crm["prospects"][prospect_id] = p

    p["company"] = company
    p["book"] = book
    if industry:
        p["industry"] = industry
    if geo:
        p["geo"] = geo
    if employee_range:
        p["employee_range"] = employee_range
    if website:
        p["website"] = website
    if notes:
        p["notes"] = notes
    if signals:
        p["signals"] = list(dict.fromkeys((p.get("signals") or []) + signals))
    if contacts:
        by_email = {
            c.get("email", "").lower(): c
            for c in p.get("contacts") or []
            if c.get("email")
        }
        for c in contacts:
            key = (c.get("email") or "").lower() or c.get("name", "")
            by_email[key] = {**(by_email.get(key) or {}), **c}
        p["contacts"] = list(by_email.values())
    if extra:
        p.update(extra)
    p["updated_at"] = _now()
    save_crm(crm, book=book)
    return p


def set_stage(
    prospect_id: str,
    stage: str,
    note: str = "",
    book: str | None = None,
) -> dict[str, Any]:
    if stage not in STAGES:
        raise ValueError(f"Unknown stage {stage!r}. Valid: {STAGES}")
    # resolve book if needed
    p, book = _find_prospect(prospect_id, book)
    crm = load_crm(book)
    p = crm["prospects"][prospect_id]
    old = p.get("stage")
    p["stage"] = stage
    p["updated_at"] = _now()
    p.setdefault("history", []).append(
        {"at": _now(), "from": old, "to": stage, "note": note}
    )
    save_crm(crm, book=book)
    return p


def update_prospect(
    prospect_id: str,
    book: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    p, book = _find_prospect(prospect_id, book)
    crm = load_crm(book)
    p = crm["prospects"][prospect_id]
    for k, v in fields.items():
        if v is not None:
            p[k] = v
    p["updated_at"] = _now()
    save_crm(crm, book=book)
    return p


def _find_prospect(
    prospect_id: str, book: str | None = None
) -> tuple[dict[str, Any], str]:
    if book:
        p = load_crm(book)["prospects"].get(prospect_id)
        if not p:
            raise KeyError(f"Prospect {prospect_id} not found in {book}")
        return p, book
    for b in BOOKS:
        p = load_crm(b)["prospects"].get(prospect_id)
        if p:
            return p, b
    raise KeyError(f"Prospect {prospect_id} not found")


def get_prospect(prospect_id: str, book: str | None = None) -> dict[str, Any] | None:
    try:
        p, b = _find_prospect(prospect_id, book)
        p = dict(p)
        p["book"] = b
        return p
    except KeyError:
        return None


def list_prospects(
    stage: str | None = None,
    min_score: float | None = None,
    book: str = "corporate",
) -> list[dict[str, Any]]:
    prospects = list(load_crm(book)["prospects"].values())
    for p in prospects:
        p.setdefault("book", book)
    if stage:
        prospects = [p for p in prospects if p.get("stage") == stage]
    if min_score is not None:
        prospects = [p for p in prospects if (p.get("score") or 0) >= min_score]
    return sorted(
        prospects, key=lambda p: (-(p.get("score") or 0), p.get("company", ""))
    )


def pipeline_summary(book: str = "corporate") -> dict[str, int]:
    counts = {s: 0 for s in STAGES}
    for p in load_crm(book)["prospects"].values():
        st = p.get("stage") or "research"
        counts[st] = counts.get(st, 0) + 1
    return counts


def interested_leads(book: str = "corporate") -> list[dict[str, Any]]:
    out = list_prospects(stage="interested", book=book) + list_prospects(
        stage="discovery_booked", book=book
    )
    if book == "wedding":
        # Paid couples (stage won) still need scheduling until lessons_scheduled=true
        for p in list_prospects(stage="won", book=book):
            if p.get("payment_status") == "paid" and not p.get("lessons_scheduled"):
                out.append(p)
    return out


# ── Partnerships ──────────────────────────────────────────────────────────────

def load_partnerships() -> list[dict[str, Any]]:
    ensure_dirs()
    if not PARTNERSHIPS_PATH.exists():
        return []
    data = json.loads(PARTNERSHIPS_PATH.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else data.get("partners", [])


def save_partnerships(partners: list[dict[str, Any]]) -> None:
    ensure_dirs()
    PARTNERSHIPS_PATH.write_text(
        json.dumps({"updated_at": _now(), "partners": partners}, indent=2) + "\n",
        encoding="utf-8",
    )


def upsert_partner(partner: dict[str, Any]) -> dict[str, Any]:
    partners = load_partnerships()
    pid = partner.get("id") or f"partner-{uuid.uuid4().hex[:8]}"
    partner["id"] = pid
    partner["updated_at"] = _now()
    found = False
    for i, p in enumerate(partners):
        if p.get("id") == pid or (
            p.get("name", "").lower() == partner.get("name", "").lower()
            and partner.get("name")
        ):
            partners[i] = {**p, **partner}
            partner = partners[i]
            found = True
            break
    if not found:
        partner.setdefault("created_at", _now())
        partners.append(partner)
    save_partnerships(partners)
    return partner
