#!/usr/bin/env python3
"""Generate today's Systems Over Goals Daily episode.

The server scheduler calls the same orchestrator. This script is the manual
path, including a dry run that does not call Grok or the speech API.

    python3 scripts/sogd_daily.py
    python3 scripts/sogd_daily.py --date 2026-10-26 --dry-run
    python3 scripts/sogd_daily.py --force
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _connect():
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"])

    class _Closer:
        def __enter__(self):
            return conn

        def __exit__(self, exc_type, exc, tb):
            try:
                if exc_type:
                    conn.rollback()
                else:
                    conn.commit()
            finally:
                conn.close()

    return _Closer()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Systems Over Goals Daily")
    parser.add_argument("--date", default="", help="YYYY-MM-DD in America/Los_Angeles")
    parser.add_argument("--force", action="store_true", help="Replace today's episode")
    parser.add_argument("--dry-run", action="store_true", help="Plan only. No Grok, no speech, no publish")
    parser.add_argument("--import-pilot", action="store_true", help="Store the Oct 27 pilot MP3 as episode 1")
    parser.add_argument("--pilot-file", default="", help="Path to the pilot MP3")
    args = parser.parse_args(argv)
    if args.import_pilot:
        from podcast_sogd import import_sogd_pilot
        connect = _connect if os.environ.get("DATABASE_URL") else None
        result = import_sogd_pilot(path=args.pilot_file or None, connect=connect)
        print(json.dumps({
            "ok": result.get("ok"),
            "status": result.get("status"),
            "episode_guid": result.get("episode_guid"),
            "byte_size": result.get("byte_size"),
            "md5": result.get("md5"),
            "path": result.get("path"),
        }, indent=2))
        return 0 if result.get("ok") else 1
    if args.date:
        day = date.fromisoformat(args.date)
    else:
        day = datetime.now(ZoneInfo("America/Los_Angeles")).date()
    from podcast_engine import generate_sogd_episode
    connect = _connect if os.environ.get("DATABASE_URL") else None
    result = generate_sogd_episode(day, force=args.force, dry_run=args.dry_run, connect=connect)
    summary = {
        "ok": result.get("ok"),
        "status": result.get("status"),
        "stage": result.get("stage"),
        "error": result.get("error"),
        "title": result.get("title"),
        "episode_date": result.get("episode_date"),
        "episode_guid": result.get("episode_guid"),
        "words": result.get("words"),
        "cost_usd_total": (result.get("usage") or {}).get("cost_usd_total"),
    }
    published = result.get("published_at")
    summary["published_at"] = published.isoformat() if hasattr(published, "isoformat") else published
    print(json.dumps(summary, indent=2))
    if result.get("status") in ("dry_run", "skipped") or result.get("ok"):
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
