"""Card, run, and settings storage.

MemoryStore is the test double. PostgresStore connects only when a method
runs, and only if something constructed it with a URL.
"""

from __future__ import annotations

import copy
import json
import os
import re
import threading
from datetime import date, datetime, timezone

from ideas_cards.catalog import DEFAULT_SETTINGS, DEFAULT_WEIGHTS, PASS_CHIPS
from ideas_cards.scoring import SCORERS, normalize_weights, tune_weights

_TICKER = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_KEEP = ("report", "report_at", "watch", "pass_reason", "pass_note")


def merge_card(existing: dict | None, fresh: dict) -> dict:
    """A later scan refreshes the numbers and leaves a decision Alec already made."""
    if not existing:
        return dict(fresh)
    status = existing.get("status") or "new"
    if status == "new":
        return dict(fresh)
    merged = dict(fresh)
    merged["status"] = status
    for key in _KEEP:
        if existing.get(key) not in (None, "", []):
            merged[key] = existing[key]
    return merged


def clean_settings(data: dict | None, base: dict | None = None) -> dict:
    out = copy.deepcopy(base or DEFAULT_SETTINGS)
    src = data if isinstance(data, dict) else {}
    if "auto" in src:
        out["auto"] = bool(src["auto"])
    if "start_local" in src:
        text = str(src["start_local"] or "06:00")
        parts = text.split(":")
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            hour, minute = int(parts[0]), int(parts[1])
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                out["start_local"] = f"{hour:02d}:{minute:02d}"
    _float(out, src, "drawdown_min", 0.05, 0.60)
    _float(out, src, "drop_min", 0.05, 0.60)
    _float(out, src, "min_market_cap", 1e8, 1e12)
    _float(out, src, "ceo_cfo_min_usd", 10_000, 5_000_000)
    _float(out, src, "add_pct", 0.10, 2.0)
    _float(out, src, "grok_cap_usd", 0.0, 100.0)
    _float(out, src, "watch_move_pct", 0.02, 0.50)
    if "insider_window_days" in src:
        out["insider_window_days"] = _bound_int(src["insider_window_days"], 7, 90, out["insider_window_days"])
    if "insider_cluster" in src:
        out["insider_cluster"] = _bound_int(src["insider_cluster"], 2, 6, out["insider_cluster"])
    if "grok_model" in src and str(src["grok_model"] or "").strip():
        out["grok_model"] = str(src["grok_model"]).strip()[:40]
    if "themes" in src:
        out["themes"] = _phrases(src["themes"], 20)
    if "discovered_themes" in src:
        out["discovered_themes"] = _phrases(src["discovered_themes"], 8)
    if "extra_tickers" in src:
        out["extra_tickers"] = _tickers(src["extra_tickers"])
    if "funds" in src:
        out["funds"] = _funds(src["funds"])
    if isinstance(src.get("weights"), dict):
        for kind, default in DEFAULT_WEIGHTS.items():
            raw = src["weights"].get(kind)
            merged = dict(out["weights"].get(kind) or default)
            if isinstance(raw, dict):
                for key in default:
                    if key in raw:
                        try:
                            merged[key] = float(raw[key])
                        except (TypeError, ValueError):
                            pass
            out["weights"][kind] = normalize_weights(merged)
    return out


def _float(out: dict, src: dict, key: str, lo: float, hi: float) -> None:
    if key not in src:
        return
    try:
        value = float(src[key])
    except (TypeError, ValueError):
        return
    if value != value or value in {float("inf"), float("-inf")}:
        return
    out[key] = min(hi, max(lo, value))


def _bound_int(value, lo: int, hi: int, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return min(hi, max(lo, number))


def _phrases(value, limit: int) -> list[str]:
    rows = value if isinstance(value, list) else str(value or "").splitlines()
    out = []
    for row in rows:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text[:60])
        if len(out) >= limit:
            break
    return out


def _tickers(value) -> list[str]:
    if isinstance(value, str):
        parts = value.replace(";", ",").split(",")
    else:
        parts = list(value or [])
    out = []
    for part in parts:
        ticker = str(part or "").strip().upper()
        if _TICKER.match(ticker) and ticker not in out:
            out.append(ticker)
        if len(out) >= 200:
            break
    return out


def _funds(value) -> list[dict]:
    rows = value if isinstance(value, list) else []
    out = []
    for row in rows:
        if isinstance(row, str) and "|" in row:
            name, cik = row.split("|", 1)
            row = {"name": name, "cik": cik}
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        cik = "".join(ch for ch in str(row.get("cik") or "") if ch.isdigit())
        if not name:
            continue
        out.append({"name": name[:80], "cik": cik[-10:].zfill(10) if cik else ""})
        if len(out) >= 20:
            break
    return out


def _month(when) -> str:
    if isinstance(when, datetime):
        return when.date().isoformat()[:7]
    if isinstance(when, date):
        return when.isoformat()[:7]
    if when:
        return str(when)[:7]
    return datetime.now(timezone.utc).date().isoformat()[:7]


def _rescore(card: dict, weights: dict) -> dict:
    signals = card.get("signals") or {}
    scorer = SCORERS.get(card.get("type") or "")
    if not scorer or not signals:
        return card
    scored = scorer(signals, weights)
    updated = dict(card)
    updated["score"] = scored["total"]
    updated["score_breakdown"] = scored["breakdown"]
    updated["weights"] = weights
    return updated


class MemoryStore:
    def __init__(self, settings: dict | None = None):
        self._lock = threading.Lock()
        self._settings = clean_settings(settings or DEFAULT_SETTINGS)
        self._cards: dict[str, dict] = {}
        self._actions: list[dict] = []
        self._runs: dict[tuple, dict] = {}
        self._spend: dict[str, float] = {}
        self._blobs: dict[str, object] = {}

    def get_settings(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._settings)

    def save_settings(self, data: dict) -> dict:
        with self._lock:
            self._settings = clean_settings(data, self._settings)
            return copy.deepcopy(self._settings)

    def list_cards(self, card_type: str | None = None, status: str | None = None) -> list[dict]:
        with self._lock:
            rows = [copy.deepcopy(card) for card in self._cards.values()]
        if card_type:
            rows = [card for card in rows if card.get("type") == card_type]
        if status:
            rows = [card for card in rows if card.get("status") == status]
        return rows

    def get_card(self, card_id: str) -> dict | None:
        with self._lock:
            card = self._cards.get(card_id)
            return copy.deepcopy(card) if card else None

    def upsert_cards(self, cards: list[dict]) -> int:
        with self._lock:
            for card in cards or []:
                card_id = card.get("id")
                if not card_id:
                    continue
                self._cards[card_id] = merge_card(self._cards.get(card_id), card)
        return len(cards or [])

    def runs_on(self, day) -> dict:
        key_day = day.isoformat() if isinstance(day, date) else str(day)[:10]
        with self._lock:
            out = {}
            for (run_day, stage), row in self._runs.items():
                if run_day == key_day:
                    out[stage] = dict(row)
            return out

    def finish_run(self, day, stage: str, status: str, error: str = "", cost: float = 0.0, attempts: int | None = None) -> None:
        key_day = day.isoformat() if isinstance(day, date) else str(day)[:10]
        with self._lock:
            prev = self._runs.get((key_day, stage)) or {}
            self._runs[(key_day, stage)] = {
                "status": status,
                "error": (error or "")[:500],
                "cost_usd": float(cost or 0),
                "attempts": int(prev.get("attempts") or 0) if attempts is None else int(attempts),
            }

    def note_failure(self, day, stage: str, error: str) -> dict:
        key_day = day.isoformat() if isinstance(day, date) else str(day)[:10]
        with self._lock:
            prev = self._runs.get((key_day, stage)) or {}
            attempts = int(prev.get("attempts") or 0) + 1
            row = {
                "status": "failed",
                "error": (error or "")[:500],
                "cost_usd": float(prev.get("cost_usd") or 0),
                "attempts": attempts,
            }
            self._runs[(key_day, stage)] = row
            return dict(row)

    def add_cost(self, amount: float, when=None) -> None:
        try:
            value = float(amount or 0)
        except (TypeError, ValueError):
            return
        if value <= 0:
            return
        with self._lock:
            month = _month(when)
            self._spend[month] = round(self._spend.get(month, 0.0) + value, 6)

    def month_spend(self, when=None) -> float:
        with self._lock:
            return float(self._spend.get(_month(when), 0.0))

    def get_blob(self, key: str):
        with self._lock:
            value = self._blobs.get(key)
            return copy.deepcopy(value) if isinstance(value, (dict, list)) else value

    def set_blob(self, key: str, value) -> None:
        with self._lock:
            self._blobs[key] = copy.deepcopy(value) if isinstance(value, (dict, list)) else value

    def act(self, card_id: str, action: str, reason: str = "", note: str = "",
            report: str | None = None, watch: dict | None = None) -> dict:
        if action not in {"dig", "watch", "pass"}:
            raise ValueError(action)
        with self._lock:
            card = self._cards.get(card_id)
            if not card:
                raise KeyError(card_id)
            if action == "dig":
                card["status"] = "dug_in"
                card["report"] = report or ""
                card["report_at"] = datetime.now(timezone.utc).isoformat()
            elif action == "watch":
                card["status"] = "watching"
                card["watch"] = dict(watch or {})
            else:
                chip = (reason or "").strip()
                if not chip:
                    raise ValueError("reason")
                card["status"] = "passed"
                card["pass_reason"] = chip[:80]
                card["pass_note"] = (note or "")[:500]
            self._actions.append({
                "card_id": card_id,
                "action": action,
                "reason": (reason or "")[:80],
                "note": (note or "")[:500],
            })
            kind = card.get("type") or ""
            if kind in self._settings["weights"]:
                self._settings["weights"][kind] = tune_weights(
                    self._settings["weights"][kind], kind, action, reason,
                )
                weights = self._settings["weights"][kind]
                for stored in self._cards.values():
                    if stored.get("type") == kind:
                        updated = _rescore(stored, weights)
                        stored.update(updated)
            return copy.deepcopy(card)

    def pass_chips(self) -> list[str]:
        return list(PASS_CHIPS)


class PostgresStore(MemoryStore):
    """Same methods as MemoryStore. The first call opens Postgres and creates tables."""

    def __init__(self, url: str):
        super().__init__()
        self._url = url
        self._ready = False
        self._schema_lock = threading.Lock()

    def _conn(self):
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(self._url, connect_timeout=int(os.environ.get("PG_CONNECT_TIMEOUT", "10")))
        return conn, psycopg2.extras

    def _ensure(self) -> None:
        if self._ready:
            return
        with self._schema_lock:
            if self._ready:
                return
            conn, _extras = self._conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS ideas_cards (
                            id TEXT PRIMARY KEY,
                            card_type TEXT NOT NULL,
                            as_of DATE NOT NULL,
                            title TEXT NOT NULL,
                            score DOUBLE PRECISION NOT NULL,
                            status TEXT NOT NULL,
                            payload JSONB NOT NULL,
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS ideas_actions (
                            id BIGSERIAL PRIMARY KEY,
                            card_id TEXT NOT NULL,
                            action TEXT NOT NULL,
                            reason TEXT,
                            note TEXT,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS ideas_runs (
                            run_date DATE NOT NULL,
                            stage TEXT NOT NULL,
                            status TEXT NOT NULL,
                            error TEXT,
                            cost_usd DOUBLE PRECISION DEFAULT 0,
                            attempts INTEGER DEFAULT 0,
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                            PRIMARY KEY (run_date, stage)
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS ideas_settings (
                            id INTEGER PRIMARY KEY,
                            payload JSONB NOT NULL
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS ideas_spend (
                            month TEXT PRIMARY KEY,
                            cost_usd DOUBLE PRECISION NOT NULL
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS ideas_blobs (
                            key TEXT PRIMARY KEY,
                            payload JSONB NOT NULL
                        )
                    """)
                conn.commit()
            finally:
                conn.close()
            self._ready = True

    def get_settings(self) -> dict:
        self._ensure()
        conn, extras = self._conn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT payload FROM ideas_settings WHERE id = 1")
                row = cur.fetchone()
            if not row:
                payload = clean_settings(DEFAULT_SETTINGS)
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO ideas_settings (id, payload) VALUES (1, %s::jsonb)",
                        (json.dumps(payload),),
                    )
                conn.commit()
                return payload
            return clean_settings(row["payload"])
        finally:
            conn.close()

    def save_settings(self, data: dict) -> dict:
        current = self.get_settings()
        payload = clean_settings(data, current)
        conn, _extras = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ideas_settings (id, payload) VALUES (1, %s::jsonb)
                    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload
                    """,
                    (json.dumps(payload),),
                )
            conn.commit()
            return payload
        finally:
            conn.close()

    def list_cards(self, card_type: str | None = None, status: str | None = None) -> list[dict]:
        self._ensure()
        conn, extras = self._conn()
        try:
            sql = "SELECT payload FROM ideas_cards WHERE 1=1"
            args: list = []
            if card_type:
                sql += " AND card_type = %s"
                args.append(card_type)
            if status:
                sql += " AND status = %s"
                args.append(status)
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(sql, args)
                return [dict(row["payload"]) for row in cur.fetchall()]
        finally:
            conn.close()

    def get_card(self, card_id: str) -> dict | None:
        self._ensure()
        conn, extras = self._conn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT payload FROM ideas_cards WHERE id = %s", (card_id,))
                row = cur.fetchone()
            return dict(row["payload"]) if row else None
        finally:
            conn.close()

    def upsert_cards(self, cards: list[dict]) -> int:
        self._ensure()
        conn, extras = self._conn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                for card in cards or []:
                    card_id = card.get("id")
                    if not card_id:
                        continue
                    cur.execute("SELECT payload FROM ideas_cards WHERE id = %s", (card_id,))
                    row = cur.fetchone()
                    merged = merge_card(dict(row["payload"]) if row else None, card)
                    cur.execute(
                        """
                        INSERT INTO ideas_cards (id, card_type, as_of, title, score, status, payload, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, now())
                        ON CONFLICT (id) DO UPDATE SET
                            card_type = EXCLUDED.card_type,
                            as_of = EXCLUDED.as_of,
                            title = EXCLUDED.title,
                            score = EXCLUDED.score,
                            status = EXCLUDED.status,
                            payload = EXCLUDED.payload,
                            updated_at = now()
                        """,
                        (
                            merged["id"],
                            merged.get("type") or "",
                            merged.get("as_of"),
                            merged.get("title") or "",
                            float(merged.get("score") or 0),
                            merged.get("status") or "new",
                            json.dumps(merged),
                        ),
                    )
            conn.commit()
            return len(cards or [])
        finally:
            conn.close()

    def runs_on(self, day) -> dict:
        self._ensure()
        key_day = day.isoformat() if isinstance(day, date) else str(day)[:10]
        conn, extras = self._conn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT stage, status, error, cost_usd, attempts FROM ideas_runs WHERE run_date = %s",
                    (key_day,),
                )
                return {
                    row["stage"]: {
                        "status": row["status"],
                        "error": row["error"] or "",
                        "cost_usd": float(row["cost_usd"] or 0),
                        "attempts": int(row["attempts"] or 0),
                    }
                    for row in cur.fetchall()
                }
        finally:
            conn.close()

    def finish_run(self, day, stage: str, status: str, error: str = "", cost: float = 0.0, attempts: int | None = None) -> None:
        self._ensure()
        key_day = day.isoformat() if isinstance(day, date) else str(day)[:10]
        prev = self.runs_on(day).get(stage) or {}
        used = int(prev.get("attempts") or 0) if attempts is None else int(attempts)
        conn, _extras = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ideas_runs (run_date, stage, status, error, cost_usd, attempts, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, now())
                    ON CONFLICT (run_date, stage) DO UPDATE SET
                        status = EXCLUDED.status,
                        error = EXCLUDED.error,
                        cost_usd = EXCLUDED.cost_usd,
                        attempts = EXCLUDED.attempts,
                        updated_at = now()
                    """,
                    (key_day, stage, status, (error or "")[:500], float(cost or 0), used),
                )
            conn.commit()
        finally:
            conn.close()

    def note_failure(self, day, stage: str, error: str) -> dict:
        prev = self.runs_on(day).get(stage) or {}
        attempts = int(prev.get("attempts") or 0) + 1
        self.finish_run(day, stage, "failed", error=error, cost=float(prev.get("cost_usd") or 0), attempts=attempts)
        return {"status": "failed", "error": (error or "")[:500], "attempts": attempts, "cost_usd": float(prev.get("cost_usd") or 0)}

    def add_cost(self, amount: float, when=None) -> None:
        try:
            value = float(amount or 0)
        except (TypeError, ValueError):
            return
        if value <= 0:
            return
        self._ensure()
        month = _month(when)
        conn, _extras = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ideas_spend (month, cost_usd) VALUES (%s, %s)
                    ON CONFLICT (month) DO UPDATE SET cost_usd = ideas_spend.cost_usd + EXCLUDED.cost_usd
                    """,
                    (month, value),
                )
            conn.commit()
        finally:
            conn.close()

    def month_spend(self, when=None) -> float:
        self._ensure()
        conn, extras = self._conn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT cost_usd FROM ideas_spend WHERE month = %s", (_month(when),))
                row = cur.fetchone()
            return float(row["cost_usd"]) if row else 0.0
        finally:
            conn.close()

    def get_blob(self, key: str):
        self._ensure()
        conn, extras = self._conn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT payload FROM ideas_blobs WHERE key = %s", (key,))
                row = cur.fetchone()
            if not row:
                return None
            payload = row["payload"]
            if isinstance(payload, str):
                return json.loads(payload)
            return payload
        finally:
            conn.close()

    def set_blob(self, key: str, value) -> None:
        self._ensure()
        conn, _extras = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ideas_blobs (key, payload) VALUES (%s, %s::jsonb)
                    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload
                    """,
                    (key, json.dumps(value)),
                )
            conn.commit()
        finally:
            conn.close()

    def act(self, card_id: str, action: str, reason: str = "", note: str = "",
            report: str | None = None, watch: dict | None = None) -> dict:
        if action not in {"dig", "watch", "pass"}:
            raise ValueError(action)
        card = self.get_card(card_id)
        if not card:
            raise KeyError(card_id)
        if action == "dig":
            card["status"] = "dug_in"
            card["report"] = report or ""
            card["report_at"] = datetime.now(timezone.utc).isoformat()
        elif action == "watch":
            card["status"] = "watching"
            card["watch"] = dict(watch or {})
        else:
            chip = (reason or "").strip()
            if not chip:
                raise ValueError("reason")
            card["status"] = "passed"
            card["pass_reason"] = chip[:80]
            card["pass_note"] = (note or "")[:500]
        settings = self.get_settings()
        kind = card.get("type") or ""
        if kind in (settings.get("weights") or {}):
            settings["weights"][kind] = tune_weights(settings["weights"][kind], kind, action, reason)
            self.save_settings(settings)
            weights = settings["weights"][kind]
            for stored in self.list_cards(card_type=kind):
                updated = _rescore(stored, weights)
                if stored.get("id") == card_id:
                    card = {**card, **{k: updated[k] for k in ("score", "score_breakdown", "weights")}}
                else:
                    stored.update(updated)
                    self.upsert_cards([stored])
        self.upsert_cards([card])
        self._ensure()
        conn, _extras = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO ideas_actions (card_id, action, reason, note) VALUES (%s, %s, %s, %s)",
                    (card_id, action, (reason or "")[:80], (note or "")[:500]),
                )
            conn.commit()
        finally:
            conn.close()
        return card


_STORE = None
_STORE_LOCK = threading.Lock()


def get_store():
    """Process-wide store. Tests should construct MemoryStore themselves."""
    global _STORE
    if _STORE is not None:
        return _STORE
    with _STORE_LOCK:
        if _STORE is None:
            url = os.environ.get("DATABASE_URL") or ""
            if url:
                _STORE = PostgresStore(url)
            else:
                _STORE = MemoryStore()
        return _STORE
