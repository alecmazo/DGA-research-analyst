"""Packet versions. Postgres when a connection is passed, memory otherwise."""

from __future__ import annotations

import json
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timezone

SCHEMA_SQL = (
    """
    CREATE TABLE IF NOT EXISTS merger_arb_deals (
        id TEXT PRIMARY KEY,
        target_ticker TEXT NOT NULL,
        target_name TEXT NOT NULL DEFAULT '',
        acquirer_ticker TEXT NOT NULL DEFAULT '',
        acquirer_name TEXT NOT NULL DEFAULT '',
        announced_on DATE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS deal_key TEXT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS target_cik TEXT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS acquirer_cik TEXT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'screen'
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS outcome TEXT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS deal_type TEXT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS is_tender BOOLEAN
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS acquirer_kind TEXT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS hostile BOOLEAN
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS sector TEXT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS deal_value_usd NUMERIC
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS announce_date DATE
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS expected_close DATE
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS outside_date DATE
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS terms_json JSONB
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS metrics_json JSONB
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS offer_value NUMERIC
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS target_price NUMERIC
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS gross_pct NUMERIC
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS ann_pct NUMERIC
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS downside_pct NUMERIC
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS implied_p NUMERIC
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS reg_flags TEXT[]
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS score INT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS score_band TEXT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS score_json JSONB
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS data_confidence INT
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ
    """,
    """
    ALTER TABLE merger_arb_deals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS merger_arb_deals_deal_key_idx
        ON merger_arb_deals (deal_key)
    """,
    """
    CREATE INDEX IF NOT EXISTS merger_arb_deals_stage_idx ON merger_arb_deals (stage)
    """,
    """
    CREATE INDEX IF NOT EXISTS merger_arb_deals_score_idx ON merger_arb_deals (score)
    """,
    """
    CREATE INDEX IF NOT EXISTS merger_arb_deals_expected_close_idx ON merger_arb_deals (expected_close)
    """,
    """
    CREATE INDEX IF NOT EXISTS merger_arb_deals_ann_pct_idx ON merger_arb_deals (ann_pct)
    """,
    """
    CREATE INDEX IF NOT EXISTS merger_arb_deals_reg_flags_idx ON merger_arb_deals USING GIN (reg_flags)
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_packet_versions (
        id BIGSERIAL PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES merger_arb_deals(id),
        version INT NOT NULL,
        stage TEXT NOT NULL,
        parent_version INT,
        model TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        packet JSONB NOT NULL,
        UNIQUE (deal_id, version)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_field_values (
        version_id BIGINT NOT NULL REFERENCES merger_arb_packet_versions(id) ON DELETE CASCADE,
        field_id TEXT NOT NULL,
        value_json JSONB,
        unit TEXT,
        source_id TEXT,
        pulled_at TIMESTAMPTZ,
        as_of TIMESTAMPTZ,
        freshness_class TEXT,
        confidence TEXT,
        unverified BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (version_id, field_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_sources (
        version_id BIGINT NOT NULL REFERENCES merger_arb_packet_versions(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        source_type TEXT,
        name TEXT,
        url TEXT,
        locator TEXT,
        published_at TIMESTAMPTZ,
        pulled_at TIMESTAMPTZ,
        refresh_priority INT,
        time_limit_hours INT,
        PRIMARY KEY (version_id, source_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_flags (
        id BIGSERIAL PRIMARY KEY,
        version_id BIGINT NOT NULL REFERENCES merger_arb_packet_versions(id) ON DELETE CASCADE,
        field_id TEXT,
        kind TEXT NOT NULL,
        detail TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_deal_aliases (
        alias_key TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES merger_arb_deals(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_deal_fields (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES merger_arb_deals(id),
        field_name TEXT,
        value_json JSONB,
        raw TEXT,
        source_name TEXT,
        source_url TEXT,
        pulled_at TEXT,
        method TEXT,
        evidence TEXT,
        is_current BOOLEAN,
        conflict BOOLEAN,
        override_note TEXT,
        user_name TEXT
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS merger_arb_deal_fields_deal_idx
        ON merger_arb_deal_fields (deal_id)
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_regulatory (
        deal_id TEXT NOT NULL REFERENCES merger_arb_deals(id),
        regulator TEXT NOT NULL,
        stage TEXT,
        filed_on DATE,
        deadline DATE,
        cleared_on DATE,
        source_url TEXT,
        updated_at TIMESTAMPTZ,
        PRIMARY KEY (deal_id, regulator)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_events (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES merger_arb_deals(id),
        kind TEXT,
        expected_on DATE,
        actual_on DATE,
        source_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS merger_arb_events_deal_idx ON merger_arb_events (deal_id)
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_spread_history (
        deal_id TEXT NOT NULL REFERENCES merger_arb_deals(id),
        d DATE NOT NULL,
        target_px NUMERIC,
        acquirer_px NUMERIC,
        offer_value NUMERIC,
        gross_pct NUMERIC,
        net_ann_pct NUMERIC,
        implied_p NUMERIC,
        score INT,
        PRIMARY KEY (deal_id, d)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS merger_arb_score_config (
        version SERIAL PRIMARY KEY,
        weights JSONB,
        thresholds JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by TEXT
    )
    """,
)

_STAGE_RANK = {
    "screen": 0,
    "watch": 1,
    "active": 2,
    "closed": 3,
    "broken": 3,
    "ignored": 3,
}

_TABLES_READY = False
_TABLES_LOCK = threading.Lock()


def reset_ensure_tables() -> None:
    global _TABLES_READY
    _TABLES_READY = False


def ensure_tables(conn) -> None:
    global _TABLES_READY
    if _TABLES_READY:
        return
    with _TABLES_LOCK:
        if _TABLES_READY:
            return
        with conn.cursor() as cur:
            for statement in SCHEMA_SQL:
                cur.execute(statement)
        conn.commit()
        _TABLES_READY = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str = "d_") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def _blank(value) -> bool:
    return value in (None, "", [], {}, ())


def _merge_deal_row(existing: dict, incoming: dict) -> dict:
    out = dict(existing)
    for key, value in incoming.items():
        if key in {"fields", "id"}:
            continue
        if _blank(value):
            continue
        out[key] = value
    old_stage = existing.get("stage") or "screen"
    new_stage = incoming.get("stage") or old_stage
    if incoming.get("stage") == "screen" and _STAGE_RANK.get(old_stage, 0) > 0:
        out["stage"] = old_stage
    else:
        out["stage"] = new_stage
    out["id"] = existing.get("id") or incoming.get("id")
    return out


def _terms_from_fields(fields: list) -> dict:
    terms = {}
    for row in fields or []:
        if isinstance(row, dict):
            name = row.get("field_name") or ""
            current = row.get("is_current", True)
            value = row.get("value")
        else:
            name = getattr(row, "field_name", "") or ""
            current = getattr(row, "is_current", True)
            value = getattr(row, "value", None)
        if name and current and value not in (None, ""):
            terms[name] = value
    return terms


class MemoryStore:
    def __init__(self) -> None:
        self.deals: dict[str, dict] = {}
        self.versions: dict[str, list[dict]] = {}
        self.aliases: dict[str, str] = {}
        self.deal_fields: dict[str, list[dict]] = {}
        self.regulatory: dict[tuple[str, str], dict] = {}
        self.events: list[dict] = []
        self.spread_history: dict[tuple[str, str], dict] = {}
        self.score_config: list[dict] = []

    def put_alias(self, alias_key: str, deal_id: str) -> None:
        if alias_key and deal_id:
            self.aliases[alias_key] = deal_id

    def resolve_alias(self, alias_key: str) -> str | None:
        if not alias_key:
            return None
        return self.aliases.get(alias_key)

    def resolve_candidate(self, candidate: dict) -> dict | None:
        from merger_arb.scanner.dedupe import find_match

        key = candidate.get("deal_key") or ""
        deal_id = self.resolve_alias(key)
        if deal_id and deal_id in self.deals:
            return self.deals[deal_id]
        open_deals = [
            row for row in self.deals.values()
            if not row.get("sample") and row.get("id") != "fixture-acme"
        ]
        return find_match(candidate, open_deals)

    def upsert_deal(self, deal: dict) -> dict:
        row = dict(deal)
        existing = self.deals.get(row["id"])
        if existing:
            row = _merge_deal_row(existing, row)
        else:
            row.setdefault("stage", "screen")
            row.setdefault("first_seen_at", row.get("created_at") or _now())
        row["updated_at"] = _now()
        self.deals[row["id"]] = row
        key = row.get("deal_key") or ""
        if key:
            self.put_alias(key, row["id"])
        return row

    def merge_deal_fields(self, deal_id: str, incoming: list) -> list[dict]:
        from merger_arb.scanner.merge import as_field_value, merge_field_lists

        stored = [as_field_value(row) for row in self.deal_fields.get(deal_id) or []]
        merged = merge_field_lists(stored, incoming)
        self.deal_fields[deal_id] = [row.to_dict() for row in merged]
        return self.deal_fields[deal_id]

    def list_deal_fields(self, deal_id: str) -> list[dict]:
        return list(self.deal_fields.get(deal_id) or [])

    def upsert_screen_deal(self, candidate: dict) -> dict:
        """Scanner write path. Merge-not-replace. Default stage is screen."""
        from merger_arb.scanner.resolve import deal_key as make_key

        match = self.resolve_candidate(candidate)
        deal_id = (match or {}).get("id") or candidate.get("id") or _id("d_")
        old_key = (match or {}).get("deal_key") or ""
        new_key = candidate.get("deal_key") or make_key(
            candidate.get("target_cik") or "",
            candidate.get("target_ticker") or "",
            candidate.get("acquirer_name") or "",
        )
        now = _now()
        incoming = {
            "id": deal_id,
            "deal_key": new_key,
            "target_ticker": candidate.get("target_ticker") or "",
            "target_name": candidate.get("target_name") or "",
            "target_cik": candidate.get("target_cik") or "",
            "acquirer_ticker": candidate.get("acquirer_ticker") or "",
            "acquirer_name": candidate.get("acquirer_name") or "",
            "acquirer_cik": candidate.get("acquirer_cik") or "",
            "announce_date": candidate.get("announce_date") or None,
            "announced_on": candidate.get("announce_date") or candidate.get("announced_on") or None,
            "expected_close": candidate.get("expected_close") or None,
            "status": candidate.get("status") or "pending",
            "stage": "screen",
            "terms_json": _terms_from_fields(candidate.get("fields") or []),
            "data_confidence": candidate.get("confidence"),
            "last_seen_at": now,
        }
        if match is None:
            incoming["first_seen_at"] = candidate.get("first_seen_at") or now
            incoming["created_at"] = now
        if old_key and new_key and old_key != new_key:
            self.put_alias(old_key, deal_id)
        deal = self.upsert_deal(incoming)
        self.merge_deal_fields(deal["id"], candidate.get("fields") or [])
        terms = dict(deal.get("terms_json") or {})
        for row in self.deal_fields.get(deal["id"]) or []:
            if row.get("is_current") and row.get("field_name") and row.get("value") not in (None, ""):
                terms[row["field_name"]] = row["value"]
        deal["terms_json"] = terms
        self.deals[deal["id"]] = deal
        candidate["screen_deal_id"] = deal["id"]
        return deal

    def list_deals(self) -> list[dict]:
        return list(self.deals.values())

    def get_deal(self, deal_id: str) -> dict | None:
        return self.deals.get(deal_id)

    def save_version(self, packet: dict) -> dict:
        stored = deepcopy(packet)
        meta = stored.setdefault("packet_meta", {})
        deal_id = str(meta.get("deal_id") or "")
        history = self.versions.setdefault(deal_id, [])
        if not meta.get("version"):
            meta["version"] = len(history) + 1
        history.append(stored)
        return stored

    def latest(self, deal_id: str) -> dict | None:
        history = self.versions.get(deal_id) or []
        return deepcopy(history[-1]) if history else None

    def history(self, deal_id: str) -> list[dict]:
        return [deepcopy(row) for row in self.versions.get(deal_id) or []]


class PostgresStore:
    def __init__(self, connect) -> None:
        self._connect = connect

    def put_alias(self, alias_key: str, deal_id: str) -> None:
        if not alias_key or not deal_id:
            return
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO merger_arb_deal_aliases (alias_key, deal_id)
                    VALUES (%s, %s)
                    ON CONFLICT (alias_key) DO UPDATE SET deal_id = EXCLUDED.deal_id
                    """,
                    (alias_key, deal_id),
                )
            conn.commit()

    def resolve_alias(self, alias_key: str) -> str | None:
        if not alias_key:
            return None
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT deal_id FROM merger_arb_deal_aliases WHERE alias_key = %s",
                    (alias_key,),
                )
                row = cur.fetchone()
        return row[0] if row else None

    def resolve_candidate(self, candidate: dict) -> dict | None:
        from merger_arb.scanner.dedupe import find_match

        key = candidate.get("deal_key") or ""
        deal_id = self.resolve_alias(key)
        if deal_id:
            found = self.get_deal(deal_id)
            if found:
                return found
        open_deals = [
            row for row in self.list_deals()
            if not row.get("sample") and row.get("id") != "fixture-acme"
        ]
        return find_match(candidate, open_deals)

    def upsert_deal(self, deal: dict) -> dict:
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO merger_arb_deals
                        (id, target_ticker, target_name, acquirer_ticker, acquirer_name, announced_on, status,
                         deal_key, target_cik, acquirer_cik, stage, outcome, deal_type, is_tender,
                         acquirer_kind, hostile, sector, deal_value_usd, announce_date, expected_close,
                         outside_date, terms_json, metrics_json, offer_value, target_price, gross_pct,
                         ann_pct, downside_pct, implied_p, reg_flags, score, score_band, score_json,
                         data_confidence, first_seen_at, last_seen_at, updated_at)
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        target_ticker = CASE WHEN EXCLUDED.target_ticker <> '' THEN EXCLUDED.target_ticker ELSE merger_arb_deals.target_ticker END,
                        target_name = CASE WHEN EXCLUDED.target_name <> '' THEN EXCLUDED.target_name ELSE merger_arb_deals.target_name END,
                        acquirer_ticker = CASE WHEN EXCLUDED.acquirer_ticker <> '' THEN EXCLUDED.acquirer_ticker ELSE merger_arb_deals.acquirer_ticker END,
                        acquirer_name = CASE WHEN EXCLUDED.acquirer_name <> '' THEN EXCLUDED.acquirer_name ELSE merger_arb_deals.acquirer_name END,
                        status = COALESCE(EXCLUDED.status, merger_arb_deals.status),
                        deal_key = COALESCE(EXCLUDED.deal_key, merger_arb_deals.deal_key),
                        target_cik = COALESCE(NULLIF(EXCLUDED.target_cik, ''), merger_arb_deals.target_cik),
                        acquirer_cik = COALESCE(NULLIF(EXCLUDED.acquirer_cik, ''), merger_arb_deals.acquirer_cik),
                        stage = CASE
                            WHEN merger_arb_deals.stage IN ('watch','active','closed','broken','ignored')
                                 AND EXCLUDED.stage = 'screen'
                            THEN merger_arb_deals.stage
                            ELSE COALESCE(EXCLUDED.stage, merger_arb_deals.stage)
                        END,
                        outcome = COALESCE(EXCLUDED.outcome, merger_arb_deals.outcome),
                        deal_type = COALESCE(EXCLUDED.deal_type, merger_arb_deals.deal_type),
                        announce_date = COALESCE(EXCLUDED.announce_date, merger_arb_deals.announce_date),
                        expected_close = COALESCE(EXCLUDED.expected_close, merger_arb_deals.expected_close),
                        terms_json = COALESCE(EXCLUDED.terms_json, merger_arb_deals.terms_json),
                        data_confidence = COALESCE(EXCLUDED.data_confidence, merger_arb_deals.data_confidence),
                        last_seen_at = COALESCE(EXCLUDED.last_seen_at, merger_arb_deals.last_seen_at),
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        deal["id"],
                        deal.get("target_ticker") or "",
                        deal.get("target_name") or "",
                        deal.get("acquirer_ticker") or "",
                        deal.get("acquirer_name") or "",
                        deal.get("announced_on") or None,
                        deal.get("status") or "pending",
                        deal.get("deal_key") or None,
                        deal.get("target_cik") or None,
                        deal.get("acquirer_cik") or None,
                        deal.get("stage") or "screen",
                        deal.get("outcome"),
                        deal.get("deal_type"),
                        deal.get("is_tender"),
                        deal.get("acquirer_kind"),
                        deal.get("hostile"),
                        deal.get("sector"),
                        deal.get("deal_value_usd"),
                        deal.get("announce_date") or None,
                        deal.get("expected_close") or None,
                        deal.get("outside_date") or None,
                        json.dumps(deal["terms_json"]) if isinstance(deal.get("terms_json"), (dict, list)) else deal.get("terms_json"),
                        json.dumps(deal["metrics_json"]) if isinstance(deal.get("metrics_json"), (dict, list)) else deal.get("metrics_json"),
                        deal.get("offer_value"),
                        deal.get("target_price"),
                        deal.get("gross_pct"),
                        deal.get("ann_pct"),
                        deal.get("downside_pct"),
                        deal.get("implied_p"),
                        deal.get("reg_flags"),
                        deal.get("score"),
                        deal.get("score_band"),
                        json.dumps(deal["score_json"]) if isinstance(deal.get("score_json"), (dict, list)) else deal.get("score_json"),
                        deal.get("data_confidence"),
                        deal.get("first_seen_at"),
                        deal.get("last_seen_at"),
                        deal.get("updated_at") or _now(),
                    ),
                )
            conn.commit()
        key = deal.get("deal_key") or ""
        if key:
            self.put_alias(key, deal["id"])
        return deal

    def merge_deal_fields(self, deal_id: str, incoming: list) -> list[dict]:
        from merger_arb.scanner.merge import as_field_value, merge_field_lists

        stored = [as_field_value(row) for row in self.list_deal_fields(deal_id)]
        merged = merge_field_lists(stored, incoming)
        rows = [row.to_dict() for row in merged]
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute("DELETE FROM merger_arb_deal_fields WHERE deal_id = %s", (deal_id,))
                for field_row in rows:
                    cur.execute(
                        """
                        INSERT INTO merger_arb_deal_fields
                            (id, deal_id, field_name, value_json, raw, source_name, source_url,
                             pulled_at, method, evidence, is_current, conflict, override_note, user_name)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            field_row.get("id") or _id("fld_"),
                            deal_id,
                            field_row.get("field_name"),
                            json.dumps(field_row.get("value")),
                            field_row.get("raw") or "",
                            field_row.get("source_name") or "",
                            field_row.get("source_url") or "",
                            field_row.get("pulled_at") or "",
                            field_row.get("method") or "",
                            field_row.get("evidence") or "",
                            bool(field_row.get("is_current", True)),
                            bool(field_row.get("conflict")),
                            field_row.get("override_note") or "",
                            field_row.get("user_name") or field_row.get("user") or "",
                        ),
                    )
            conn.commit()
        return rows

    def list_deal_fields(self, deal_id: str) -> list[dict]:
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT field_name, value_json, raw, source_name, source_url, pulled_at,
                           method, evidence, is_current, conflict, override_note, user_name
                      FROM merger_arb_deal_fields
                     WHERE deal_id = %s
                    """,
                    (deal_id,),
                )
                cols = [
                    "field_name", "value_json", "raw", "source_name", "source_url", "pulled_at",
                    "method", "evidence", "is_current", "conflict", "override_note", "user_name",
                ]
                rows = []
                for fetched in cur.fetchall():
                    item = dict(zip(cols, fetched))
                    value = item.pop("value_json")
                    if isinstance(value, str):
                        try:
                            value = json.loads(value)
                        except json.JSONDecodeError:
                            pass
                    item["value"] = value
                    rows.append(item)
        return rows

    def upsert_screen_deal(self, candidate: dict) -> dict:
        from merger_arb.scanner.resolve import deal_key as make_key

        match = self.resolve_candidate(candidate)
        deal_id = (match or {}).get("id") or candidate.get("id") or _id("d_")
        old_key = (match or {}).get("deal_key") or ""
        new_key = candidate.get("deal_key") or make_key(
            candidate.get("target_cik") or "",
            candidate.get("target_ticker") or "",
            candidate.get("acquirer_name") or "",
        )
        now = _now()
        incoming = {
            "id": deal_id,
            "deal_key": new_key,
            "target_ticker": candidate.get("target_ticker") or "",
            "target_name": candidate.get("target_name") or "",
            "target_cik": candidate.get("target_cik") or "",
            "acquirer_ticker": candidate.get("acquirer_ticker") or "",
            "acquirer_name": candidate.get("acquirer_name") or "",
            "acquirer_cik": candidate.get("acquirer_cik") or "",
            "announce_date": candidate.get("announce_date") or None,
            "announced_on": candidate.get("announce_date") or candidate.get("announced_on") or None,
            "expected_close": candidate.get("expected_close") or None,
            "status": candidate.get("status") or "pending",
            "stage": "screen",
            "terms_json": _terms_from_fields(candidate.get("fields") or []),
            "data_confidence": candidate.get("confidence"),
            "last_seen_at": now,
            "updated_at": now,
        }
        if match is None:
            incoming["first_seen_at"] = candidate.get("first_seen_at") or now
        if old_key and new_key and old_key != new_key:
            self.put_alias(old_key, deal_id)
        deal = self.upsert_deal(incoming)
        self.merge_deal_fields(deal["id"], candidate.get("fields") or [])
        candidate["screen_deal_id"] = deal["id"]
        return deal

    def list_deals(self) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            ensure_tables(conn)
            cur.execute(
                """
                SELECT id, target_ticker, target_name, acquirer_ticker, acquirer_name,
                       announced_on::text, status, deal_key, target_cik, acquirer_cik, stage,
                       announce_date::text, expected_close::text, data_confidence
                  FROM merger_arb_deals
                 ORDER BY created_at DESC
                """
            )
            cols = [
                "id", "target_ticker", "target_name", "acquirer_ticker", "acquirer_name",
                "announced_on", "status", "deal_key", "target_cik", "acquirer_cik", "stage",
                "announce_date", "expected_close", "data_confidence",
            ]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

    def get_deal(self, deal_id: str) -> dict | None:
        for deal in self.list_deals():
            if deal["id"] == deal_id:
                return deal
        return None

    def save_version(self, packet: dict) -> dict:
        from merger_arb.schema import field_map

        meta = packet.get("packet_meta") or {}
        deal_id = meta.get("deal_id")
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COALESCE(MAX(version), 0) FROM merger_arb_packet_versions WHERE deal_id = %s",
                    (deal_id,),
                )
                version = int(cur.fetchone()[0]) + 1
                packet["packet_meta"]["version"] = version
                cur.execute(
                    """
                    INSERT INTO merger_arb_packet_versions
                        (deal_id, version, stage, parent_version, model, packet)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        deal_id,
                        version,
                        meta.get("stage") or "",
                        meta.get("parent_version"),
                        meta.get("model") or "",
                        json.dumps(packet),
                    ),
                )
                version_id = cur.fetchone()[0]
                for field in field_map(packet).values():
                    source = field.get("source") if isinstance(field.get("source"), dict) else {}
                    cur.execute(
                        """
                        INSERT INTO merger_arb_field_values
                            (version_id, field_id, value_json, unit, source_id, pulled_at, as_of,
                             freshness_class, confidence, unverified)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            version_id,
                            field["id"],
                            json.dumps(field.get("value")),
                            field.get("unit") or "",
                            source.get("type") or "",
                            field.get("pulled_at") or None,
                            field.get("as_of") or None,
                            field.get("freshness_class") or "",
                            field.get("confidence") or "",
                            bool(field.get("unverified")),
                        ),
                    )
                for source in (packet.get("sections") or {}).get("sources") or []:
                    if not isinstance(source, dict) or not source.get("id"):
                        continue
                    cur.execute(
                        """
                        INSERT INTO merger_arb_sources
                            (version_id, source_id, source_type, name, url, locator,
                             published_at, pulled_at, refresh_priority, time_limit_hours)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            version_id,
                            source.get("id"),
                            source.get("type") or "",
                            source.get("name") or "",
                            source.get("url") or "",
                            source.get("locator") or "",
                            source.get("published_at") or None,
                            source.get("pulled_at") or None,
                            source.get("refresh_priority"),
                            source.get("time_limit_hours"),
                        ),
                    )
                for flag in packet.get("flags") or []:
                    cur.execute(
                        """
                        INSERT INTO merger_arb_flags (version_id, field_id, kind, detail)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (version_id, flag.get("id") or "", flag.get("kind") or "unverifiable", flag.get("detail") or ""),
                    )
            conn.commit()
        return packet

    def latest(self, deal_id: str) -> dict | None:
        history = self.history(deal_id)
        return history[-1] if history else None

    def history(self, deal_id: str) -> list[dict]:
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT packet::text
                      FROM merger_arb_packet_versions
                     WHERE deal_id = %s
                     ORDER BY version
                    """,
                    (deal_id,),
                )
                return [json.loads(row[0]) for row in cur.fetchall()]
