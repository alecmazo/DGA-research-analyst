"""python -m merger_arb.scanner.cli scan --incremental|--full --since YYYY-MM-DD"""

from __future__ import annotations

import argparse
import json


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="merger_arb.scanner")
    parser.add_argument("command", choices=["scan"])
    parser.add_argument("--incremental", action="store_true")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--since", default="")
    args = parser.parse_args(argv)
    if args.full and args.incremental:
        parser.error("Pick incremental or full, not both")
    args.mode = "full" if args.full else "incremental"
    return args


def main(argv: list[str] | None = None, runner=None) -> int:
    args = parse_args(argv)
    if runner is None:
        from merger_arb.scanner.config import ScannerConfig
        from merger_arb.scanner.runner import ScanRunner, default_client, load_quotes
        from merger_arb.scanner.sources import build_sources
        from merger_arb.scanner.store import get_scanner_store

        config = ScannerConfig.from_env()
        store = get_scanner_store()
        runner = ScanRunner(
            store,
            build_sources(config),
            config=config,
            client=default_client(config),
            quotes_fn=load_quotes,
        )
    run = runner.scan_sync(mode=args.mode, since=args.since or None)
    print(json.dumps({
        "id": run.get("id"),
        "status": run.get("status"),
        "mode": run.get("mode"),
        "counts": run.get("counts") or {},
    }))
    return 0 if run.get("status") == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
