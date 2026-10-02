"""Saved credit work. The PSKY fixture is not written here unless someone confirms a copy."""

from __future__ import annotations

from copy import deepcopy

SCHEMA_SQL = (
    """
    CREATE TABLE IF NOT EXISTS credit_issuers (
        cik TEXT PRIMARY KEY,
        legal_name TEXT NOT NULL DEFAULT '',
        tickers_json TEXT NOT NULL DEFAULT '[]',
        related_ciks_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'watch',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS credit_packet_versions (
        id BIGSERIAL PRIMARY KEY,
        issuer_cik TEXT NOT NULL,
        version INTEGER NOT NULL,
        stage TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        parent_version INTEGER,
        packet_json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (issuer_cik, version)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS credit_bond_prices (
        id BIGSERIAL PRIMARY KEY,
        instrument_id TEXT NOT NULL,
        clean_price NUMERIC NOT NULL,
        trade_date DATE,
        source_note TEXT NOT NULL DEFAULT '',
        entered_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS credit_reference_tables (
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        source_url TEXT NOT NULL DEFAULT '',
        pulled_at TIMESTAMPTZ,
        rows_json TEXT NOT NULL,
        PRIMARY KEY (name, version)
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
        self.issuers: dict[str, dict] = {}
        self.versions: dict[str, list[dict]] = {}
        self.prices: list[dict] = []
        self.references: dict[tuple[str, str], dict] = {}

    def list_issuers(self) -> list[dict]:
        return [deepcopy(row) for row in self.issuers.values()]

    def get_issuer(self, cik: str) -> dict | None:
        row = self.issuers.get(cik)
        return deepcopy(row) if row else None

    def save_issuer(self, issuer: dict, packet: dict) -> dict:
        cik = issuer["cik"]
        self.issuers[cik] = deepcopy(issuer)
        history = self.versions.setdefault(cik, [])
        stored = deepcopy(packet)
        meta = stored.setdefault("packet_meta", {})
        meta["version"] = len(history) + 1
        history.append(stored)
        return stored

    def latest(self, cik: str) -> dict | None:
        history = self.versions.get(cik) or []
        return deepcopy(history[-1]) if history else None

    def add_price(self, row: dict) -> dict:
        self.prices.append(deepcopy(row))
        return row

    def forget_price(self, instrument_id: str) -> None:
        self.prices = [row for row in self.prices if row.get("instrument_id") != instrument_id]

    def prices_for(self, instrument_id: str) -> list[dict]:
        return [deepcopy(row) for row in self.prices if row.get("instrument_id") == instrument_id]

    def latest_prices(self) -> dict[str, dict]:
        found: dict[str, dict] = {}
        for row in self.prices:
            iid = row.get("instrument_id")
            if iid:
                found[str(iid)] = deepcopy(row)
        return found

    def save_reference(self, name: str, version: str, source_url: str, pulled_at: str, rows: list) -> None:
        self.references[(name, version)] = {
            "name": name, "version": version, "source_url": source_url,
            "pulled_at": pulled_at, "rows": rows,
        }

    def reference(self, name: str) -> dict | None:
        matches = [row for (key, _), row in self.references.items() if key == name]
        return deepcopy(matches[-1]) if matches else None


class PostgresStore:
    """Same methods as MemoryStore. The fixture is never inserted by get_store."""

    def __init__(self, connect) -> None:
        self._connect = connect

    def list_issuers(self) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            ensure_tables(conn)
            cur.execute("SELECT cik, legal_name, status FROM credit_issuers ORDER BY legal_name")
            return [{"cik": cik, "legal_name": name, "status": status} for cik, name, status in cur.fetchall()]

    def get_issuer(self, cik: str) -> dict | None:
        for row in self.list_issuers():
            if row["cik"] == cik:
                return row
        return None

    def latest(self, cik: str) -> dict | None:
        import json
        with self._connect() as conn, conn.cursor() as cur:
            ensure_tables(conn)
            cur.execute(
                """
                SELECT packet_json FROM credit_packet_versions
                 WHERE issuer_cik = %s ORDER BY version DESC LIMIT 1
                """,
                (cik,),
            )
            found = cur.fetchone()
        if not found:
            return None
        return json.loads(found[0])

    def save_issuer(self, issuer: dict, packet: dict) -> dict:
        import json
        cik = issuer["cik"]
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO credit_issuers (cik, legal_name, status)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (cik) DO UPDATE SET
                        legal_name = EXCLUDED.legal_name,
                        status = EXCLUDED.status,
                        updated_at = NOW()
                    """,
                    (cik, issuer.get("legal_name") or "", issuer.get("status") or "watch"),
                )
                cur.execute(
                    "SELECT COALESCE(MAX(version), 0) FROM credit_packet_versions WHERE issuer_cik = %s",
                    (cik,),
                )
                version = int(cur.fetchone()[0]) + 1
                packet = deepcopy(packet)
                packet.setdefault("packet_meta", {})["version"] = version
                cur.execute(
                    """
                    INSERT INTO credit_packet_versions
                        (issuer_cik, version, stage, model, parent_version, packet_json)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        cik, version,
                        (packet.get("packet_meta") or {}).get("stage") or "",
                        (packet.get("packet_meta") or {}).get("model") or "",
                        (packet.get("packet_meta") or {}).get("parent_version"),
                        json.dumps(packet),
                    ),
                )
            conn.commit()
        return packet

    def add_price(self, row: dict) -> dict:
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO credit_bond_prices
                        (instrument_id, clean_price, trade_date, source_note, entered_by)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        row["instrument_id"], row["clean_price"], row.get("trade_date") or None,
                        row.get("source_note") or "", row.get("entered_by") or "",
                    ),
                )
            conn.commit()
        return row

    def forget_price(self, instrument_id: str) -> None:
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM credit_bond_prices WHERE instrument_id = %s",
                    (instrument_id,),
                )
            conn.commit()

    def prices_for(self, instrument_id: str) -> list[dict]:
        with self._connect() as conn, conn.cursor() as cur:
            ensure_tables(conn)
            cur.execute(
                """
                SELECT instrument_id, clean_price::text, trade_date::text, source_note, entered_by
                  FROM credit_bond_prices WHERE instrument_id = %s ORDER BY created_at
                """,
                (instrument_id,),
            )
            cols = ["instrument_id", "clean_price", "trade_date", "source_note", "entered_by"]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

    def latest_prices(self) -> dict[str, dict]:
        with self._connect() as conn, conn.cursor() as cur:
            ensure_tables(conn)
            cur.execute(
                """
                SELECT DISTINCT ON (instrument_id)
                       instrument_id, clean_price::text, trade_date::text, source_note, entered_by
                  FROM credit_bond_prices
                 ORDER BY instrument_id, created_at DESC
                """
            )
            cols = ["instrument_id", "clean_price", "trade_date", "source_note", "entered_by"]
            return {row[0]: dict(zip(cols, row)) for row in cur.fetchall()}

    def save_reference(self, name: str, version: str, source_url: str, pulled_at: str, rows: list) -> None:
        import json
        with self._connect() as conn:
            ensure_tables(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO credit_reference_tables (name, version, source_url, pulled_at, rows_json)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (name, version) DO UPDATE SET
                        source_url = EXCLUDED.source_url,
                        rows_json = EXCLUDED.rows_json
                    """,
                    (name, version, source_url, pulled_at or None, json.dumps(rows)),
                )
            conn.commit()

    def reference(self, name: str) -> dict | None:
        import json
        with self._connect() as conn, conn.cursor() as cur:
            ensure_tables(conn)
            cur.execute(
                """
                SELECT name, version, source_url, pulled_at::text, rows_json
                  FROM credit_reference_tables WHERE name = %s
                 ORDER BY version DESC LIMIT 1
                """,
                (name,),
            )
            found = cur.fetchone()
        if not found:
            return None
        return {
            "name": found[0], "version": found[1], "source_url": found[2],
            "pulled_at": found[3], "rows": json.loads(found[4]),
        }
