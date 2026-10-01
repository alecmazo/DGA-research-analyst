"""Scanner tables. Memory in tests. Postgres when DATABASE_URL is set. No changes to existing tables."""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone

SCHEMA_SQL = (
    """
    CREATE TABLE IF NOT EXISTS scanner_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT,
        finished_at TEXT,
        mode TEXT,
        status TEXT,
        sources_json TEXT,
        counts_json TEXT,
        error_text TEXT,
        cancel_flag INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanner_source_cursor (
        source TEXT PRIMARY KEY,
        cursor_json TEXT,
        updated_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanner_source_records (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        url TEXT,
        form TEXT,
        cik TEXT,
        title TEXT,
        published_at TEXT,
        pulled_at TEXT,
        raw_excerpt TEXT,
        event_type TEXT,
        run_id TEXT,
        UNIQUE (source, external_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanner_candidates (
        id TEXT PRIMARY KEY,
        deal_key TEXT UNIQUE,
        payload_json TEXT NOT NULL,
        ignored INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        desk_deal_id TEXT,
        first_seen_at TEXT,
        last_seen_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanner_candidate_fields (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        field_name TEXT,
        value_json TEXT,
        raw TEXT,
        source_name TEXT,
        source_url TEXT,
        pulled_at TEXT,
        method TEXT,
        evidence TEXT,
        is_current INTEGER,
        conflict INTEGER
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanner_candidate_sources (
        candidate_id TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        PRIMARY KEY (candidate_id, source_record_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanner_alerts (
        id TEXT PRIMARY KEY,
        desk_deal_id TEXT,
        alert_type TEXT,
        details_json TEXT,
        source_url TEXT,
        pulled_at TEXT,
        created_at TEXT,
        acknowledged_at TEXT,
        applied_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanner_ignored (
        deal_key TEXT PRIMARY KEY,
        reason TEXT,
        created_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanner_analysis_seeds (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        payload_json TEXT,
        created_at TEXT
    )
    """,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "") -> str:
    token = uuid.uuid4().hex[:12]
    return f"{prefix}{token}" if prefix else token


def _dump(value) -> str:
    return json.dumps(value if value is not None else {}, default=str)


def _load(value, fallback):
    if value in (None, ""):
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _keep_candidate(candidate: dict, *, include_ignored: bool, include_hidden: bool, include_on_desk: bool) -> bool:
    """Ignored rows stay off the default list and come back with include_ignored.

    A row already on the desk is also off the default list. Showing ignored
    rows still includes one that was added and then ignored.
    """
    ignored = bool(candidate.get("ignored"))
    if candidate.get("hidden") and not include_hidden:
        return False
    if ignored and not include_ignored:
        return False
    if candidate.get("on_desk") and not include_on_desk and not (ignored and include_ignored):
        return False
    return True


class ScannerStore:
    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.cursors: dict[str, dict] = {}
        self.records: dict[tuple, dict] = {}
        self.candidates: dict[str, dict] = {}
        self.by_key: dict[str, str] = {}
        self.alerts: dict[str, dict] = {}
        self.ignored: dict[str, dict] = {}
        self.seeds: list[dict] = []
        self._lock = threading.Lock()

    def start_run(self, mode: str) -> dict:
        run = {
            "id": _id("run_"),
            "started_at": _now(),
            "finished_at": "",
            "mode": mode,
            "status": "running",
            "sources": [],
            "counts": {},
            "error": "",
            "cancel": False,
        }
        with self._lock:
            self.runs[run["id"]] = run
        return run

    def save_run(self, run: dict) -> dict:
        with self._lock:
            self.runs[run["id"]] = run
        return run

    def get_run(self, run_id: str) -> dict | None:
        return self.runs.get(run_id)

    def active_run(self) -> dict | None:
        for run in self.runs.values():
            if run.get("status") == "running":
                return run
        return None

    def latest_finished(self) -> dict | None:
        done = [run for run in self.runs.values() if run.get("status") in {"done", "error", "cancelled"}]
        if not done:
            return None
        return sorted(done, key=lambda row: row.get("finished_at") or row.get("started_at") or "")[-1]

    def request_cancel(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if not run or run.get("status") != "running":
            return False
        run["cancel"] = True
        return True

    def get_cursor(self, source: str) -> dict:
        return dict(self.cursors.get(source) or {})

    def save_cursor(self, source: str, cursor: dict) -> None:
        self.cursors[source] = dict(cursor or {})

    def add_records(self, records: list[dict], run_id: str = "") -> int:
        added = 0
        for row in records:
            key = (row.get("source") or "", row.get("external_id") or "")
            if not key[0] or not key[1] or key in self.records:
                continue
            stored = dict(row)
            stored["id"] = stored.get("id") or _id("rec_")
            stored["run_id"] = run_id
            self.records[key] = stored
            added += 1
        return added

    def upsert_candidate(self, candidate: dict) -> dict:
        key = candidate.get("deal_key") or ""
        with self._lock:
            existing_id = self.by_key.get(key)
            if existing_id and existing_id in self.candidates:
                current = self.candidates[existing_id]
                candidate["id"] = current["id"]
                candidate["first_seen_at"] = current.get("first_seen_at") or _now()
            else:
                candidate["id"] = candidate.get("id") or _id("c_")
                candidate["first_seen_at"] = candidate.get("first_seen_at") or _now()
            if key in self.ignored:
                candidate["ignored"] = True
            candidate["last_seen_at"] = _now()
            self.candidates[candidate["id"]] = candidate
            if key:
                self.by_key[key] = candidate["id"]
        return candidate

    def list_candidates(self, *, include_ignored: bool = False, include_hidden: bool = False, include_on_desk: bool = False) -> list[dict]:
        rows = []
        for candidate in self.candidates.values():
            if not _keep_candidate(
                candidate,
                include_ignored=include_ignored,
                include_hidden=include_hidden,
                include_on_desk=include_on_desk,
            ):
                continue
            rows.append(candidate)
        rows.sort(key=lambda row: (-(int(row.get("confidence") or 0)), row.get("target_ticker") or ""))
        return rows

    def get_candidate(self, candidate_id: str) -> dict | None:
        return self.candidates.get(candidate_id)

    def ignore_key(self, deal_key: str, reason: str = "") -> None:
        self.ignored[deal_key] = {"deal_key": deal_key, "reason": reason, "created_at": _now()}
        for candidate in self.candidates.values():
            if candidate.get("deal_key") == deal_key:
                candidate["ignored"] = True

    def set_desk_deal(self, candidate_id: str, deal_id: str) -> None:
        candidate = self.candidates.get(candidate_id)
        if candidate is not None:
            candidate["desk_deal_id"] = deal_id
            candidate["on_desk"] = True

    def add_alerts(self, alerts: list[dict]) -> list[dict]:
        saved = []
        for row in alerts:
            duplicate = False
            for existing in self.alerts.values():
                if (
                    existing.get("desk_deal_id") == row.get("desk_deal_id")
                    and existing.get("alert_type") == row.get("alert_type")
                    and existing.get("source_url") == row.get("source_url")
                    and not existing.get("acknowledged_at")
                ):
                    duplicate = True
                    break
            if duplicate:
                continue
            stored = dict(row)
            stored["id"] = stored.get("id") or _id("al_")
            stored["created_at"] = stored.get("created_at") or _now()
            stored.setdefault("acknowledged_at", "")
            stored.setdefault("applied_at", "")
            self.alerts[stored["id"]] = stored
            saved.append(stored)
        return saved

    def list_alerts(self, *, include_acknowledged: bool = False) -> list[dict]:
        rows = []
        for alert in self.alerts.values():
            if alert.get("acknowledged_at") and not include_acknowledged:
                continue
            rows.append(alert)
        return rows

    def get_alert(self, alert_id: str) -> dict | None:
        return self.alerts.get(alert_id)

    def acknowledge(self, alert_id: str) -> dict | None:
        alert = self.alerts.get(alert_id)
        if alert is None:
            return None
        alert["acknowledged_at"] = _now()
        return alert

    def mark_applied(self, alert_id: str) -> dict | None:
        alert = self.alerts.get(alert_id)
        if alert is None:
            return None
        alert["applied_at"] = _now()
        alert["acknowledged_at"] = alert.get("acknowledged_at") or _now()
        return alert

    def add_seed(self, candidate_id: str, payload: dict) -> dict:
        row = {"id": _id("seed_"), "candidate_id": candidate_id, "payload": payload, "created_at": _now()}
        self.seeds.append(row)
        return row


class _ClosingConnection:
    def __init__(self, connect) -> None:
        self._connect = connect
        self.conn = None

    def __enter__(self):
        self.conn = self._connect()
        ensure_tables(self.conn)
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type:
                self.conn.rollback()
            else:
                self.conn.commit()
        finally:
            self.conn.close()
        return False


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        for statement in SCHEMA_SQL:
            cur.execute(statement)
    conn.commit()


class PostgresScannerStore:
    """Same methods as ScannerStore, backed by the fund database."""

    def __init__(self, connect) -> None:
        self._connect = connect

    def _conn(self):
        return _ClosingConnection(self._connect)

    def start_run(self, mode: str) -> dict:
        run = {
            "id": _id("run_"),
            "started_at": _now(),
            "finished_at": "",
            "mode": mode,
            "status": "running",
            "sources": [],
            "counts": {},
            "error": "",
            "cancel": False,
        }
        self.save_run(run)
        return run

    def save_run(self, run: dict) -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO scanner_runs
                        (id, started_at, finished_at, mode, status, sources_json, counts_json, error_text, cancel_flag)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        finished_at = EXCLUDED.finished_at,
                        status = EXCLUDED.status,
                        sources_json = EXCLUDED.sources_json,
                        counts_json = EXCLUDED.counts_json,
                        error_text = EXCLUDED.error_text,
                        cancel_flag = EXCLUDED.cancel_flag
                    """,
                    (
                        run["id"], run.get("started_at"), run.get("finished_at"), run.get("mode"),
                        run.get("status"), _dump(run.get("sources") or []), _dump(run.get("counts") or {}),
                        run.get("error") or "", 1 if run.get("cancel") else 0,
                    ),
                )
            conn.commit()
        return run

    def _run_from(self, row) -> dict:
        return {
            "id": row[0],
            "started_at": row[1] or "",
            "finished_at": row[2] or "",
            "mode": row[3] or "",
            "status": row[4] or "",
            "sources": _load(row[5], []),
            "counts": _load(row[6], {}),
            "error": row[7] or "",
            "cancel": bool(row[8]),
        }

    def get_run(self, run_id: str) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, started_at, finished_at, mode, status, sources_json, counts_json, error_text, cancel_flag
                    FROM scanner_runs WHERE id = %s
                    """,
                    (run_id,),
                )
                row = cur.fetchone()
        return self._run_from(row) if row else None

    def active_run(self) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, started_at, finished_at, mode, status, sources_json, counts_json, error_text, cancel_flag
                    FROM scanner_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1
                    """
                )
                row = cur.fetchone()
        return self._run_from(row) if row else None

    def latest_finished(self) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, started_at, finished_at, mode, status, sources_json, counts_json, error_text, cancel_flag
                    FROM scanner_runs WHERE status IN ('done', 'error', 'cancelled')
                    ORDER BY finished_at DESC LIMIT 1
                    """
                )
                row = cur.fetchone()
        return self._run_from(row) if row else None

    def request_cancel(self, run_id: str) -> bool:
        run = self.get_run(run_id)
        if not run or run.get("status") != "running":
            return False
        run["cancel"] = True
        self.save_run(run)
        return True

    def get_cursor(self, source: str) -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT cursor_json FROM scanner_source_cursor WHERE source = %s", (source,))
                row = cur.fetchone()
        return _load(row[0], {}) if row else {}

    def save_cursor(self, source: str, cursor: dict) -> None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO scanner_source_cursor (source, cursor_json, updated_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (source) DO UPDATE SET cursor_json = EXCLUDED.cursor_json, updated_at = EXCLUDED.updated_at
                    """,
                    (source, _dump(cursor or {}), _now()),
                )
            conn.commit()

    def add_records(self, records: list[dict], run_id: str = "") -> int:
        added = 0
        with self._conn() as conn:
            with conn.cursor() as cur:
                for row in records:
                    source = row.get("source") or ""
                    external = row.get("external_id") or ""
                    if not source or not external:
                        continue
                    cur.execute(
                        """
                        INSERT INTO scanner_source_records
                            (id, source, external_id, url, form, cik, title, published_at, pulled_at, raw_excerpt, event_type, run_id)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (source, external_id) DO NOTHING
                        """,
                        (
                            row.get("id") or _id("rec_"), source, external, row.get("url") or "",
                            row.get("form") or "", row.get("cik") or "", row.get("title") or "",
                            row.get("published_at") or "", row.get("pulled_at") or "",
                            (row.get("raw_excerpt") or "")[:2000], row.get("event_type") or "", run_id,
                        ),
                    )
                    added += cur.rowcount or 0
            conn.commit()
        return added

    def upsert_candidate(self, candidate: dict) -> dict:
        key = candidate.get("deal_key") or ""
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, payload_json FROM scanner_candidates WHERE deal_key = %s", (key,))
                existing = cur.fetchone()
                cur.execute("SELECT 1 FROM scanner_ignored WHERE deal_key = %s", (key,))
                if cur.fetchone():
                    candidate["ignored"] = True
                if existing:
                    prior = _load(existing[1], {})
                    candidate["id"] = existing[0]
                    candidate["first_seen_at"] = prior.get("first_seen_at") or _now()
                else:
                    candidate["id"] = candidate.get("id") or _id("c_")
                    candidate["first_seen_at"] = candidate.get("first_seen_at") or _now()
                candidate["last_seen_at"] = _now()
                cur.execute(
                    """
                    INSERT INTO scanner_candidates
                        (id, deal_key, payload_json, ignored, hidden, desk_deal_id, first_seen_at, last_seen_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (deal_key) DO UPDATE SET
                        payload_json = EXCLUDED.payload_json,
                        ignored = EXCLUDED.ignored,
                        hidden = EXCLUDED.hidden,
                        desk_deal_id = COALESCE(scanner_candidates.desk_deal_id, EXCLUDED.desk_deal_id),
                        last_seen_at = EXCLUDED.last_seen_at
                    """,
                    (
                        candidate["id"], key, _dump(candidate),
                        1 if candidate.get("ignored") else 0,
                        1 if candidate.get("hidden") else 0,
                        candidate.get("desk_deal_id") or None,
                        candidate.get("first_seen_at"), candidate.get("last_seen_at"),
                    ),
                )
                cur.execute("DELETE FROM scanner_candidate_fields WHERE candidate_id = %s", (candidate["id"],))
                for field_row in candidate.get("fields") or []:
                    cur.execute(
                        """
                        INSERT INTO scanner_candidate_fields
                            (id, candidate_id, field_name, value_json, raw, source_name, source_url, pulled_at, method, evidence, is_current, conflict)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            _id("fld_"), candidate["id"], field_row.get("field_name"),
                            _dump(field_row.get("value")), field_row.get("raw") or "",
                            field_row.get("source_name") or "", field_row.get("source_url") or "",
                            field_row.get("pulled_at") or "", field_row.get("method") or "",
                            field_row.get("evidence") or "",
                            1 if field_row.get("is_current", True) else 0,
                            1 if field_row.get("conflict") else 0,
                        ),
                    )
            conn.commit()
        return candidate

    def list_candidates(self, *, include_ignored: bool = False, include_hidden: bool = False, include_on_desk: bool = False) -> list[dict]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT payload_json FROM scanner_candidates")
                rows = [ _load(row[0], {}) for row in cur.fetchall() ]
        kept = []
        for candidate in rows:
            if not _keep_candidate(
                candidate,
                include_ignored=include_ignored,
                include_hidden=include_hidden,
                include_on_desk=include_on_desk,
            ):
                continue
            kept.append(candidate)
        kept.sort(key=lambda row: (-(int(row.get("confidence") or 0)), row.get("target_ticker") or ""))
        return kept

    def get_candidate(self, candidate_id: str) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT payload_json FROM scanner_candidates WHERE id = %s", (candidate_id,))
                row = cur.fetchone()
        return _load(row[0], {}) if row else None

    def ignore_key(self, deal_key: str, reason: str = "") -> None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO scanner_ignored (deal_key, reason, created_at) VALUES (%s, %s, %s)
                    ON CONFLICT (deal_key) DO UPDATE SET reason = EXCLUDED.reason
                    """,
                    (deal_key, reason, _now()),
                )
                cur.execute("SELECT id, payload_json FROM scanner_candidates WHERE deal_key = %s", (deal_key,))
                for candidate_id, payload in cur.fetchall():
                    candidate = _load(payload, {})
                    candidate["ignored"] = True
                    cur.execute(
                        "UPDATE scanner_candidates SET ignored = 1, payload_json = %s WHERE id = %s",
                        (_dump(candidate), candidate_id),
                    )
            conn.commit()

    def set_desk_deal(self, candidate_id: str, deal_id: str) -> None:
        candidate = self.get_candidate(candidate_id)
        if not candidate:
            return
        candidate["desk_deal_id"] = deal_id
        candidate["on_desk"] = True
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE scanner_candidates SET desk_deal_id = %s, payload_json = %s WHERE id = %s",
                    (deal_id, _dump(candidate), candidate_id),
                )
            conn.commit()

    def add_alerts(self, alerts: list[dict]) -> list[dict]:
        saved = []
        with self._conn() as conn:
            with conn.cursor() as cur:
                for row in alerts:
                    cur.execute(
                        """
                        SELECT id FROM scanner_alerts
                        WHERE desk_deal_id = %s AND alert_type = %s AND source_url = %s AND acknowledged_at IS NULL
                        """,
                        (row.get("desk_deal_id"), row.get("alert_type"), row.get("source_url")),
                    )
                    if cur.fetchone():
                        continue
                    stored = dict(row)
                    stored["id"] = stored.get("id") or _id("al_")
                    stored["created_at"] = _now()
                    cur.execute(
                        """
                        INSERT INTO scanner_alerts
                            (id, desk_deal_id, alert_type, details_json, source_url, pulled_at, created_at, acknowledged_at, applied_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, NULL)
                        """,
                        (
                            stored["id"], stored.get("desk_deal_id"), stored.get("alert_type"),
                            _dump({"details": stored.get("details") or {}, "certainty": stored.get("certainty"), "evidence": stored.get("evidence"), "source_name": stored.get("source_name")}),
                            stored.get("source_url") or "", stored.get("pulled_at") or "", stored["created_at"],
                        ),
                    )
                    saved.append(stored)
            conn.commit()
        return saved

    def list_alerts(self, *, include_acknowledged: bool = False) -> list[dict]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                if include_acknowledged:
                    cur.execute(
                        """
                        SELECT id, desk_deal_id, alert_type, details_json, source_url, pulled_at, created_at, acknowledged_at, applied_at
                        FROM scanner_alerts ORDER BY created_at DESC
                        """
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, desk_deal_id, alert_type, details_json, source_url, pulled_at, created_at, acknowledged_at, applied_at
                        FROM scanner_alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC
                        """
                    )
                rows = cur.fetchall()
        return [self._alert_from(row) for row in rows]

    def _alert_from(self, row) -> dict:
        blob = _load(row[3], {})
        return {
            "id": row[0],
            "desk_deal_id": row[1] or "",
            "alert_type": row[2] or "",
            "details": blob.get("details") or {},
            "certainty": blob.get("certainty") or "",
            "evidence": blob.get("evidence") or "",
            "source_name": blob.get("source_name") or "",
            "source_url": row[4] or "",
            "pulled_at": row[5] or "",
            "created_at": row[6] or "",
            "acknowledged_at": row[7] or "",
            "applied_at": row[8] or "",
        }

    def get_alert(self, alert_id: str) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, desk_deal_id, alert_type, details_json, source_url, pulled_at, created_at, acknowledged_at, applied_at
                    FROM scanner_alerts WHERE id = %s
                    """,
                    (alert_id,),
                )
                row = cur.fetchone()
        return self._alert_from(row) if row else None

    def acknowledge(self, alert_id: str) -> dict | None:
        stamp = _now()
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE scanner_alerts SET acknowledged_at = %s WHERE id = %s AND acknowledged_at IS NULL",
                    (stamp, alert_id),
                )
            conn.commit()
        return self.get_alert(alert_id)

    def mark_applied(self, alert_id: str) -> dict | None:
        stamp = _now()
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE scanner_alerts
                    SET applied_at = %s, acknowledged_at = COALESCE(acknowledged_at, %s)
                    WHERE id = %s
                    """,
                    (stamp, stamp, alert_id),
                )
            conn.commit()
        return self.get_alert(alert_id)

    def add_seed(self, candidate_id: str, payload: dict) -> dict:
        row = {"id": _id("seed_"), "candidate_id": candidate_id, "created_at": _now()}
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO scanner_analysis_seeds (id, candidate_id, payload_json, created_at) VALUES (%s, %s, %s, %s)",
                    (row["id"], candidate_id, _dump(payload), row["created_at"]),
                )
            conn.commit()
        return row


_STORE = None


def get_scanner_store():
    global _STORE
    if _STORE is not None:
        return _STORE
    url = os.environ.get("DATABASE_URL") or ""
    if url:
        def connect():
            import psycopg2
            return psycopg2.connect(url)
        _STORE = PostgresScannerStore(connect)
    else:
        _STORE = ScannerStore()
    return _STORE
