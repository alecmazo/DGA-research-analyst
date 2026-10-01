"""Packet versions. Postgres when a connection is passed, memory otherwise."""

from __future__ import annotations

import json
from copy import deepcopy

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
)


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        for statement in SCHEMA_SQL:
            cur.execute(statement)
    conn.commit()


class MemoryStore:
    def __init__(self) -> None:
        self.deals: dict[str, dict] = {}
        self.versions: dict[str, list[dict]] = {}

    def upsert_deal(self, deal: dict) -> dict:
        row = dict(deal)
        self.deals[row["id"]] = row
        return row

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

    def upsert_deal(self, deal: dict) -> dict:
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO merger_arb_deals
                        (id, target_ticker, target_name, acquirer_ticker, acquirer_name, announced_on, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        target_ticker = EXCLUDED.target_ticker,
                        target_name = EXCLUDED.target_name,
                        acquirer_ticker = EXCLUDED.acquirer_ticker,
                        acquirer_name = EXCLUDED.acquirer_name,
                        status = EXCLUDED.status
                    """,
                    (
                        deal["id"],
                        deal.get("target_ticker") or "",
                        deal.get("target_name") or "",
                        deal.get("acquirer_ticker") or "",
                        deal.get("acquirer_name") or "",
                        deal.get("announced_on") or None,
                        deal.get("status") or "pending",
                    ),
                )
            conn.commit()
        return deal

    def list_deals(self) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            ensure_tables(conn)
            cur.execute(
                """
                SELECT id, target_ticker, target_name, acquirer_ticker, acquirer_name,
                       announced_on::text, status
                  FROM merger_arb_deals
                 ORDER BY created_at DESC
                """
            )
            cols = ["id", "target_ticker", "target_name", "acquirer_ticker", "acquirer_name", "announced_on", "status"]
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
