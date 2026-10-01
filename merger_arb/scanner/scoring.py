"""Confidence from the handoff point list. Clamped to 0–100."""

from __future__ import annotations

_PRIMARY_FORMS = {"DEFM14A", "PREM14A", "S-4", "F-4", "SC TO-T", "SC 13E3"}


def _root(form: str) -> str:
    return (form or "").upper().split("/")[0].strip()


def _sec_primary(candidate: dict) -> bool:
    for source in candidate.get("sources") or []:
        form = _root(source.get("form") or "")
        items = [str(item).strip() for item in (source.get("items") or [])]
        event = source.get("event_type") or ""
        name = (source.get("name") or "").lower()
        if "sec" not in name and not form:
            continue
        if form in _PRIMARY_FORMS:
            return True
        if form == "8-K" and "1.01" in items and event in {"NEW_DEAL", "AMENDED", ""}:
            return True
        if event == "NEW_DEAL" and "sec" in name and form in _PRIMARY_FORMS | {"8-K", "425"}:
            return True
    return False


def _kinds(candidate: dict) -> set[str]:
    kinds = set()
    for source in candidate.get("sources") or []:
        name = (source.get("name") or "").lower()
        form = source.get("form") or ""
        if "sec" in name or form:
            kinds.add("sec")
        elif "ftc" in name:
            kinds.add("ftc")
        elif "nasdaq" in name:
            kinds.add("nasdaq")
        elif any(token in name for token in ("newswire", "yahoo", "globe", "google", "news", "business")):
            kinds.add("news")
    return kinds


def score_candidate(candidate: dict) -> tuple[int, list[dict]]:
    rows: list[dict] = []

    def add(points: int, reason: str) -> None:
        if points:
            rows.append({"points": points, "reason": reason})

    if _sec_primary(candidate):
        add(40, "SEC filing confirms the agreement")
    fields = candidate.get("fields") or []
    if any(
        row.get("field_name") in {"cash_per_share", "exchange_ratio"}
        and row.get("method") == "regex"
        and row.get("is_current", True)
        and "sec" in (row.get("source_name") or "").lower()
        for row in fields
    ):
        add(15, "Consideration parsed from SEC text")
    if candidate.get("target_ticker") and candidate.get("current_price"):
        add(10, "Target ticker resolved and a price fetched")
    kinds = _kinds(candidate)
    if "sec" in kinds and kinds & {"news", "nasdaq", "ftc"}:
        add(10, "A second source agrees")
    if any(row.get("field_name") in {"expected_close", "outside_date"} and row.get("is_current", True) for row in fields):
        add(5, "Expected close or outside date found")
    elif candidate.get("expected_close"):
        add(5, "Expected close or outside date found")
    if candidate.get("acquirer_ticker") or candidate.get("acquirer_cik"):
        add(5, "Acquirer resolved to a ticker or CIK")
    if any(row.get("method") == "llm_unverified" and row.get("is_current", True) for row in fields):
        add(-15, "A displayed term is unverified model text")
    if any(
        row.get("field_name") in {"cash_per_share", "exchange_ratio"} and row.get("conflict")
        for row in fields
    ):
        add(-10, "Conflicting consideration values")
    if candidate.get("news_only"):
        add(-20, "News only, no SEC confirmation")
    total = sum(row["points"] for row in rows)
    return max(0, min(100, total)), rows
