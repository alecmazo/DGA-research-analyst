"""Frontier notes and local notes for one ticker, without the full markdown.

The desk sends this pack to the browser. The local model on the Mac reads
the packet, which is the targets and the thesis excerpts, not the appendices.
"""

from __future__ import annotations

import re
from pathlib import Path

from api.domains.local_finance_llm import (
    coerce_local_runs,
    is_model_refusal,
    ordered_local_runs,
    seed_legacy_run,
)

_FRONTIER = (
    ("grok", "Grok", "report_md", "generated_at", "rating", "price_target", "upside_pct"),
    ("claude", "Claude", "report_md_claude", "claude_generated_at", "claude_rating", "claude_price_target", "claude_upside_pct"),
    ("kimi", "Kimi", "report_md_kimi", "kimi_generated_at", "kimi_rating", "kimi_price_target", "kimi_upside_pct"),
    ("deepseek", "DeepSeek", "report_md_deepseek", "deepseek_generated_at", "deepseek_rating", "deepseek_price_target", "deepseek_upside_pct"),
)

_DISK = {
    "report_md": "",
    "report_md_claude": "_claude",
    "report_md_kimi": "_kimi",
    "report_md_deepseek": "_deepseek",
    "report_md_local": "_local",
}

_THESIS_CHARS = 700
_HEADER = re.compile(
    r"^\s{0,3}#{1,4}\s*(?:section\s+)?(?:\d+(?:\.\d+)?[\.\)\s—–-]*)?"
    r"(investment\s+thesis|thesis|executive\s+summary|investment\s+summary|"
    r"why\s+(?:own|buy|this)|bull\s+case)\b",
    re.I,
)
_TARGET = re.compile(
    r"(?:12[- ]month\s+)?(?:price\s+target|12-m\s+target)[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
    re.I,
)


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _iso(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def _thesis(md: str) -> str:
    lines = (md or "").split("\n")
    body: list[str] = []
    capturing = False
    for line in lines:
        if _HEADER.match(line):
            capturing = True
            body = []
            continue
        if capturing:
            if re.match(r"^\s{0,3}#{1,4}\s+\S", line):
                break
            text = line.strip()
            if not text or text.startswith("|") or text.startswith("---"):
                continue
            body.append(text)
            if sum(len(part) for part in body) >= _THESIS_CHARS:
                break
    return " ".join(body)[:_THESIS_CHARS].strip()


def _parsed_target(md: str):
    match = _TARGET.search((md or "")[:5000])
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None


def _side(
    side_id: str,
    label: str,
    md: str,
    rating,
    price_target,
    upside_pct,
    generated_at,
) -> dict | None:
    text = (md or "").strip()
    if len(text) < 40 or is_model_refusal(text):
        return None
    return {
        "id": side_id,
        "label": label,
        "rating": rating or None,
        "price_target": _num(price_target) if price_target is not None else _parsed_target(text),
        "upside_pct": _num(upside_pct),
        "generated_at": _iso(generated_at),
        "thesis": _thesis(text),
    }


def _fmt_target(value) -> str:
    number = _num(value)
    if number is None:
        return "n/a"
    if abs(number) >= 100:
        return f"${number:.0f}"
    return f"${number:.2f}"


def _fmt_upside(value) -> str:
    number = _num(value)
    if number is None:
        return "n/a"
    return f"{number:+.1f}%"


def _block(side: dict) -> str:
    thesis = (side.get("thesis") or "").strip() or "No thesis excerpt in the saved note."
    return (
        f"{side.get('label')} | {side.get('rating') or 'n/a'} | "
        f"target {_fmt_target(side.get('price_target'))} | "
        f"upside {_fmt_upside(side.get('upside_pct'))} | "
        f"{side.get('generated_at') or 'n/a'}\n"
        f"Thesis: {thesis}"
    )


def render_packet(ticker: str, frontier: list[dict], local: list[dict]) -> str:
    frontier_text = "\n\n".join(_block(side) for side in frontier) or "No frontier note is saved."
    local_text = "\n\n".join(_block(side) for side in local) or "No local note is saved."
    return (
        f"Saved notes for {ticker}. Use only these excerpts.\n\n"
        f"FRONTIER\n{frontier_text}\n\n"
        f"LOCAL\n{local_text}"
    )


def fill_missing_reports(ticker: str, row: dict | None, folder: Path) -> dict:
    """Use a saved markdown file when that engine's column is empty."""
    out = dict(row or {})
    out["ticker"] = (ticker or "").strip().upper()
    for column, suffix in _DISK.items():
        if str(out.get(column) or "").strip():
            continue
        path = folder / f"{out['ticker']}_DGA_Report{suffix}.md"
        try:
            if path.is_file():
                out[column] = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
    return out


def build_compare_pack(ticker: str, row: dict | None) -> dict:
    """One row per saved frontier engine and one row per saved local model."""
    data = dict(row or {})
    tk = (ticker or data.get("ticker") or "").strip().upper()
    frontier: list[dict] = []
    for side_id, label, md_key, ts_key, rating_key, pt_key, up_key in _FRONTIER:
        side = _side(
            side_id,
            label,
            str(data.get(md_key) or ""),
            data.get(rating_key),
            data.get(pt_key),
            data.get(up_key),
            data.get(ts_key),
        )
        if side:
            frontier.append(side)
    runs = seed_legacy_run(
        coerce_local_runs(data.get("local_runs")),
        model=data.get("local_model"),
        md=data.get("report_md_local") or "",
        generated_at=data.get("local_generated_at"),
        rating=data.get("local_rating"),
        price_target=data.get("local_price_target"),
        upside_pct=data.get("local_upside_pct"),
        report_date=data.get("local_report_date"),
    )
    local: list[dict] = []
    for view in ordered_local_runs(runs):
        model = str(view.get("model") or "").strip()
        side = _side(
            model,
            model,
            str(view.get("report_md") or ""),
            view.get("rating"),
            view.get("price_target"),
            view.get("upside_pct"),
            view.get("generated_at"),
        )
        if side:
            local.append(side)
    return {
        "ticker": tk,
        "frontier": frontier,
        "local": local,
        "packet": render_packet(tk, frontier, local),
    }
