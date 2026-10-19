"""Collapse duplicate merger-arb rows. Dry-run is the default.

Local only. This script never reads DATABASE_URL and never connects to a
remote database. A production dry-run and --apply are left for Alec.

    python scripts/merger_arb_dedupe.py              # fixtures, dry-run
    python scripts/merger_arb_dedupe.py --apply      # fixtures, in memory
    python scripts/merger_arb_dedupe.py --dsn postgresql://localhost/... 

A second --apply on the same rows changes nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from merger_arb.scanner.dedupe import collapse, fixture_rows  # noqa: E402
from merger_arb.store import MemoryStore  # noqa: E402


def _write_deals(store, rows: list[dict], aliases: list[dict] | None = None) -> int:
    wrote = 0
    for row in rows:
        store.upsert_screen_deal(row)
        wrote += 1
    for alias in aliases or []:
        deal_id = store.resolve_alias(alias.get("deal_key") or "")
        if deal_id:
            store.put_alias(alias.get("alias_key") or "", deal_id)
    return wrote


def _local_dsn(dsn: str) -> bool:
    parsed = urlparse(dsn)
    host = (parsed.hostname or "").lower()
    if host not in {"localhost", "127.0.0.1", "::1"}:
        return False
    if "railway" in dsn.lower() or "rlwy.net" in dsn.lower():
        return False
    return True


def _load_rows(path: str) -> list[dict]:
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        data = data.get("rows") or data.get("candidates") or []
    if not isinstance(data, list):
        raise SystemExit("Fixture file must be a list of deal rows")
    return data


def _print_report(label: str, rows: list[dict], report: dict) -> None:
    print(f"{label}: {report['before']} rows -> {report['after']} rows")
    if not report["collapsed"]:
        print("  no duplicate groups")
    for group in report["collapsed"]:
        members = ", ".join(group["members"])
        print(f"  collapse {len(group['members'])} -> 1 ({group['into']}): {members}")
    competing = [
        row for row in rows
        if str(row.get("target_ticker") or "").upper() == "DUAL"
    ]
    if competing:
        names = sorted({str(row.get("acquirer_name") or "") for row in competing})
        print(f"  competing bids kept separate: {', '.join(names)}")
    if report["aliases"]:
        print(f"  aliases: {len(report['aliases'])}")


def _apply_postgres(dsn: str, apply: bool) -> int:
    if not _local_dsn(dsn):
        print("Refusing DSN: only localhost is allowed. Production is left for Alec.", file=sys.stderr)
        return 2
    import psycopg2

    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, deal_key, payload_json
                  FROM scanner_candidates
                """
            )
            fetched = cur.fetchall()
        rows = []
        for candidate_id, deal_key, payload in fetched:
            row = json.loads(payload) if isinstance(payload, str) else dict(payload or {})
            row["id"] = row.get("id") or candidate_id
            row["deal_key"] = row.get("deal_key") or deal_key
            rows.append(row)
        collapsed, report = collapse(rows)
        _print_report("dry-run" if not apply else "apply", collapsed if apply else rows, report)
        if not apply:
            print("Dry-run only. Pass --apply to write this local database.")
            return 0
        by_id = {row.get("id"): row for row in collapsed}
        drop = []
        if not report["unchanged"]:
            with conn.cursor() as cur:
                for group in report["collapsed"]:
                    keep_key = group["into"]
                    keep = next((row for row in collapsed if row.get("deal_key") == keep_key), None)
                    for member in group["members"]:
                        if keep and member == keep.get("deal_key"):
                            continue
                        drop.append(member)
                for row in collapsed:
                    if row.get("id") not in {item.get("id") for item in rows}:
                        continue
                    cur.execute(
                        """
                        UPDATE scanner_candidates
                           SET deal_key = %s, payload_json = %s
                         WHERE id = %s
                        """,
                        (row.get("deal_key") or "", json.dumps(row), row.get("id")),
                    )
                for alias in report["aliases"]:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS merger_arb_deal_aliases (
                            alias_key TEXT PRIMARY KEY,
                            deal_id TEXT
                        )
                        """
                    )
                    cur.execute(
                        """
                        INSERT INTO merger_arb_deal_aliases (alias_key, deal_id)
                        VALUES (%s, %s)
                        ON CONFLICT (alias_key) DO UPDATE SET deal_id = EXCLUDED.deal_id
                        """,
                        (alias["alias_key"], alias["deal_key"]),
                    )
                for key in drop:
                    cur.execute("DELETE FROM scanner_candidates WHERE deal_key = %s", (key,))
            conn.commit()
        from merger_arb.store import PostgresStore, reset_ensure_tables

        reset_ensure_tables()

        def connect():
            return psycopg2.connect(dsn)

        desk = PostgresStore(connect)
        _write_deals(desk, collapsed, report["aliases"])
        before_n = len(desk.list_deals())
        _write_deals(desk, collapsed, report["aliases"])
        after_n = len(desk.list_deals())
        if before_n != after_n:
            print("Second apply created new deal rows.", file=sys.stderr)
            return 1
        again, second = collapse(list(by_id.values()))
        print(f"second apply: {second['before']} -> {second['after']} (unchanged={second['unchanged']})")
        if not second["unchanged"]:
            print("Second apply was not a no-op.", file=sys.stderr)
            return 1
        print(f"Local merger_arb_deals: {after_n} rows at stage screen.")
        return 0
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Dedupe merger-arb deals locally")
    parser.add_argument("--apply", action="store_true", help="Write the collapse. Default is dry-run.")
    parser.add_argument("--dsn", default="", help="Local Postgres DSN. Remote hosts are refused.")
    parser.add_argument("--fixtures", default="", help="JSON file of rows. Default is the built-in fixtures.")
    args = parser.parse_args(argv)
    if args.dsn:
        return _apply_postgres(args.dsn, args.apply)
    rows = _load_rows(args.fixtures) if args.fixtures else fixture_rows()
    collapsed, report = collapse(rows)
    _print_report("dry-run" if not args.apply else "apply", collapsed, report)
    if not args.apply:
        print("Dry-run only. No database was opened. Pass --apply to collapse the fixture rows in memory.")
        return 0
    _again, second = collapse(collapsed)
    print(f"second apply: {second['before']} -> {second['after']} (unchanged={second['unchanged']})")
    if not second["unchanged"]:
        print("Second apply was not a no-op.", file=sys.stderr)
        return 1
    store = MemoryStore()
    _write_deals(store, collapsed, report["aliases"])
    before_ids = {deal["id"] for deal in store.list_deals()}
    _write_deals(store, collapsed, report["aliases"])
    after_ids = {deal["id"] for deal in store.list_deals()}
    if before_ids != after_ids:
        print("Second apply created new deal rows.", file=sys.stderr)
        return 1
    print(
        f"In-memory result: {len(store.list_deals())} merger_arb_deals rows at stage screen. "
        "Nothing was written to a remote database."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
