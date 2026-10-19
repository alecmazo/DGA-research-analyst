#!/usr/bin/env python3
"""Run local LLM A/B tasks and write scripts/llm_ab/results/<date>.md.

Usage (from repo root):
  python scripts/llm_ab/run.py
  python scripts/llm_ab/run.py --tasks deal_terms,spread
  python scripts/llm_ab/run.py --models gpt-oss-20b-finance,gemma4:12b
  python scripts/llm_ab/run.py --dry-run   # fixtures + calc only, no Ollama

Never touches the production DB. Separate embed indexes land under
scripts/llm_ab/indexes/call_chunks__<slug>.json.

Set OLLAMA_MAX_LOADED_MODELS=1 (or rely on keep_alive=0 unloading between models).
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Encourage single-model residency for ~18 GB chats on 24 GB machines.
os.environ.setdefault("OLLAMA_MAX_LOADED_MODELS", "1")

from scripts.llm_ab.common import (  # noqa: E402
    CHAT_MODELS,
    EMBED_MODELS,
    RESULTS,
    load_json,
    write_results_md,
)
from scripts.llm_ab.tasks import (  # noqa: E402
    format_task_md,
    ground_truth_spread,
    run_deal_terms,
    run_mda,
    run_rag,
    run_spread,
)


def dry_run() -> list[tuple[str, str]]:
    """Validate fixtures + merger_arb calc without calling Ollama."""
    deals = load_json("deal_terms.json")
    spreads = load_json("spread.json")
    mda = load_json("mda.json")
    rag = load_json("rag.json")
    assert len(deals) == 10 and len(spreads) == 10 and len(mda) == 10 and len(rag) == 10
    for item in spreads:
        gt = ground_truth_spread(item)
        assert gt["offer_value"] is not None
        assert gt["gross_spread_pct"] is not None
    body = (
        f"Fixtures OK: deal_terms={len(deals)}, spread={len(spreads)}, "
        f"mda={len(mda)}, rag={len(rag)}.\n\n"
        "Calc engine (merger_arb.calc) ground-truth sample:\n\n"
        "| id | offer | gross_spread_pct | annualized |\n"
        "| --- | --- | --- | --- |\n"
    )
    for item in spreads[:3]:
        gt = ground_truth_spread(item)
        body += (
            f"| {item['id']} | {gt['offer_value']:.4f} | "
            f"{gt['gross_spread_pct']:.6f} | {gt['annualized_spread_pct']:.6f} |\n"
        )
    body += (
        "\nChat models configured: "
        + ", ".join(CHAT_MODELS)
        + "\nEmbed models configured: "
        + ", ".join(EMBED_MODELS)
        + "\n\nRe-run without --dry-run after `ollama pull` of Gemma/Qwen models."
    )
    return [("dry_run", body)]


def decide_chat_winners(results: list[dict]) -> str:
    totals: dict[str, int] = {}
    mem_fail: dict[str, bool] = {}
    for res in results:
        if res.get("task") == "rag":
            continue
        for m, w in (res.get("wins") or {}).items():
            totals[m] = totals.get(m, 0) + int(w)
        for row in res.get("rows") or []:
            m = row.get("model")
            if m:
                mem_fail[m] = mem_fail.get(m, False) or bool(row.get("memory_failure"))
    lines = ["### Chat model decision", ""]
    lines.append("| model | task_wins | memory_failure | add? |")
    lines.append("| --- | --- | --- | --- |")
    for m, w in sorted(totals.items(), key=lambda kv: -kv[1]):
        fail = mem_fail.get(m, False)
        add = (w >= 2) and not fail
        lines.append(f"| {m} | {w} | {fail} | {add} |")
    lines.append("")
    lines.append(
        "Rule: add a chat model only if it wins 2 or more tasks with no memory failures."
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local LLM A/B harness")
    parser.add_argument(
        "--tasks",
        default="deal_terms,spread,mda,rag",
        help="Comma list: deal_terms,spread,mda,rag",
    )
    parser.add_argument("--models", default="", help="Override chat models")
    parser.add_argument("--embed-models", default="", help="Override embed models")
    parser.add_argument("--dry-run", action="store_true", help="No Ollama calls")
    args = parser.parse_args(argv)

    models = [m.strip() for m in args.models.split(",") if m.strip()] or None
    embeds = [m.strip() for m in args.embed_models.split(",") if m.strip()] or None

    if args.dry_run:
        sections = dry_run()
        out = RESULTS / f"{date.today().isoformat()}-dry-run.md"
        write_results_md(out, sections)
        print(out)
        return 0

    wanted = {t.strip() for t in args.tasks.split(",") if t.strip()}
    results = []
    sections: list[tuple[str, str]] = []

    if "deal_terms" in wanted:
        print("[llm_ab] task deal_terms…", flush=True)
        results.append(run_deal_terms(models))
        sections.append(("(a) 8-K deal terms → JSON", format_task_md(results[-1])))
    if "spread" in wanted:
        print("[llm_ab] task spread…", flush=True)
        results.append(run_spread(models))
        sections.append(("(b) Spread math vs merger_arb.calc", format_task_md(results[-1])))
    if "mda" in wanted:
        print("[llm_ab] task mda…", flush=True)
        results.append(run_mda(models))
        sections.append(("(c) 10-Q MD&A summary rubric", format_task_md(results[-1])))
    if "rag" in wanted:
        print("[llm_ab] task rag…", flush=True)
        chat = (models or CHAT_MODELS)[0]
        results.append(run_rag(embeds, chat_model=chat))
        sections.append(("(d) Filing Q&A recall@5", format_task_md(results[-1])))

    sections.append(("Decision", decide_chat_winners(results)))
    out = RESULTS / f"{date.today().isoformat()}.md"
    write_results_md(out, sections)
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
