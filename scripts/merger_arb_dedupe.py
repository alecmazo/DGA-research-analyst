"""Collapse duplicate scanner rows. Dry-run is the default.

A database apply updates scanner_candidates only. It does not insert
rows into merger_arb_deals. Passing a remote DSN is refused.

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

from merger_arb.scanner.dedupe import collapse, fixture_rows, plan_collapse  # noqa: E402
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


def _load_scanner_rows(cur) -> list[dict]:
    cur.execute("SELECT id, deal_key, payload_json FROM scanner_candidates")
    rows = []
    for candidate_id, deal_key, payload in cur.fetchall():
        row = json.loads(payload) if isinstance(payload, str) else dict(payload or {})
        row["id"] = row.get("id") or candidate_id
        row["deal_key"] = row.get("deal_key") or deal_key
        rows.append(row)
    return rows


def _table_exists(cur, name: str) -> bool:
    cur.execute(
        """
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = %s
        """,
        (name,),
    )
    return cur.fetchone() is not None


def apply_scanner_plan(conn, plan: dict) -> dict:
    """Delete duplicate scanner rows and update the survivors.

    merger_arb_deals is counted before and after and must stay the same.
    Aliases are not written: that table only accepts a desk deal id.
    """
    drop_ids = [item for item in plan["drop_ids"] if item]
    updates = plan["updates"]
    keys = [row.get("deal_key") or "" for row in updates]
    if len(keys) != len(set(keys)):
        raise RuntimeError("collapsed deal keys are not unique")
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM merger_arb_deals")
        deals_before = cur.fetchone()[0]
        if drop_ids:
            for table in (
                "scanner_candidate_fields",
                "scanner_candidate_sources",
                "scanner_analysis_seeds",
            ):
                if _table_exists(cur, table):
                    cur.execute(
                        f"DELETE FROM {table} WHERE candidate_id = ANY(%s)",
                        (drop_ids,),
                    )
            cur.execute("DELETE FROM scanner_candidates WHERE id = ANY(%s)", (drop_ids,))
        for row in updates:
            cur.execute(
                """
                UPDATE scanner_candidates
                   SET deal_key = %s, payload_json = %s
                 WHERE id = %s
                """,
                (row.get("deal_key") or "", json.dumps(row, default=str), row.get("id")),
            )
        cur.execute("SELECT COUNT(*) FROM merger_arb_deals")
        deals_after = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM scanner_candidates")
        scanner_after = cur.fetchone()[0]
    if deals_before != deals_after:
        conn.rollback()
        raise RuntimeError("merger_arb_deals changed during a scanner collapse")
    conn.commit()
    return {
        "deals_before": deals_before,
        "deals_after": deals_after,
        "scanner_after": scanner_after,
        "dropped": len(drop_ids),
    }


def _apply_postgres(dsn: str, apply: bool) -> int:
    if not _local_dsn(dsn):
        print("Refusing DSN: only localhost is allowed.", file=sys.stderr)
        return 2
    import psycopg2

    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            rows = _load_scanner_rows(cur)
        plan = plan_collapse(rows)
        report = plan["report"]
        _print_report("dry-run" if not apply else "apply", rows, report)
        if not apply:
            print("Dry-run only. Pass --apply to update scanner_candidates. merger_arb_deals is not written.")
            return 0
        if report["unchanged"]:
            print("Nothing to collapse.")
            return 0
        result = apply_scanner_plan(conn, plan)
        with conn.cursor() as cur:
            again_rows = _load_scanner_rows(cur)
        _again, second = collapse(again_rows)
        print(
            f"second apply: {second['before']} -> {second['after']} "
            f"(unchanged={second['unchanged']})"
        )
        print(
            f"scanner_candidates: {result['scanner_after']}. "
            f"merger_arb_deals stayed {result['deals_after']}."
        )
        if not second["unchanged"] or result["deals_before"] != result["deals_after"]:
            print("Scanner collapse did not stick.", file=sys.stderr)
            return 1
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
