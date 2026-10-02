"""CLI: python -m podcast_intel ingest --show "Odd Lots" --limit 3"""

from __future__ import annotations

import argparse
import sys

from podcast_intel.ingest import format_report, ingest_feeds, ingest_show
from podcast_intel.shows import ShowSkipped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="podcast-intel")
    sub = parser.add_subparsers(dest="command", required=True)
    ingest = sub.add_parser("ingest", help="Store published transcripts for the starter shows")
    ingest.add_argument("--show", default="", help='One show, for example "Odd Lots"')
    ingest.add_argument("--limit", type=int, default=3)
    ingest.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.command != "ingest":
        parser.error("unknown command")
        return 2
    limit = max(1, min(int(args.limit), 10))
    try:
        if args.show.strip():
            rows = ingest_show(args.show, limit=limit, dry_run=args.dry_run)
        else:
            rows = ingest_feeds(limit=limit, dry_run=args.dry_run)
    except ShowSkipped as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(format_report(rows) or "No episodes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
