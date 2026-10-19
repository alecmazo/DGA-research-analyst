"""Copy scanner terms onto a desk row that was saved without them.

A collar flag still leaves the modeled spread empty. The stated cash or
ratio, the close date, and a readable acquirer name are kept.
"""
from __future__ import annotations

import json
import re
from datetime import date

from merger_arb.calc import deal_metrics
from merger_arb.store import _terms_from_fields

_CLAUSE = re.compile(r",|\bwith\b", re.I)
_LEAD = re.compile(r"^([A-Z][A-Za-z0-9.&'-]{1,40})")


def _messy(name: str) -> bool:
    text = (name or "").strip()
    if not text:
        return True
    return bool(_CLAUSE.search(text)) or len(text) > 48


def clean_acquirer(name: str, terms: dict) -> str:
    text = (name or "").strip()
    stock = str(terms.get("exchange_stock") or "")
    if _messy(text) and stock:
        match = _LEAD.match(stock)
        if match:
            return match.group(1)
    return text


def facts_from_candidate(candidate: dict, *, price=None) -> dict:
    terms = _terms_from_fields(candidate.get("fields") or [])
    collar = str(terms.get("collar") or "").lower() in {"flagged", "true", "yes"}
    election = str(terms.get("election") or "").lower() in {"flagged", "true", "yes"}
    proration = str(terms.get("proration") or "").lower() in {"flagged", "true", "yes"}
    mark = price if price not in (None, "") else candidate.get("current_price")
    close = terms.get("expected_close") or candidate.get("expected_close") or ""
    metrics = deal_metrics(
        cash=terms.get("cash_per_share"),
        ratio=terms.get("exchange_ratio"),
        target_price=mark,
        close_date=str(close)[:10],
        as_of=date.today(),
        collar=collar,
        election=election,
        proration=proration,
    )
    target_name = (candidate.get("target_name") or "").strip()
    acquirer = clean_acquirer(candidate.get("acquirer_name") or "", terms)
    announced = terms.get("announce_date") or candidate.get("announce_date") or ""
    return {
        "target_name": target_name,
        "target_cik": candidate.get("target_cik") or "",
        "acquirer_name": acquirer,
        "acquirer_cik": candidate.get("acquirer_cik") or "",
        "announce_date": str(announced)[:10] or None,
        "announced_on": str(announced)[:10] or None,
        "expected_close": str(close)[:10] or None,
        "outside_date": str(terms.get("outside_date") or "")[:10] or None,
        "deal_type": metrics.consideration or candidate.get("consideration_type") or None,
        "terms_json": terms or None,
        "metrics_json": metrics.as_json(),
        "offer_value": metrics.offer_value,
        "target_price": mark,
        "gross_pct": metrics.gross_pct,
        "ann_pct": metrics.annualized_pct,
        "downside_pct": metrics.downside_pct,
        "implied_p": metrics.implied_p,
        "data_confidence": candidate.get("confidence"),
        "needs_manual_terms": metrics.needs_manual_terms,
    }


def _blank(deal: dict) -> bool:
    terms = deal.get("terms_json") or {}
    if isinstance(terms, str):
        try:
            terms = json.loads(terms)
        except json.JSONDecodeError:
            terms = {}
    if isinstance(terms, dict) and terms:
        return False
    return not deal.get("expected_close") and deal.get("offer_value") in (None, "")


def candidates_by_ticker(rows: list[dict]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for row in rows:
        ticker = str(row.get("target_ticker") or "").upper()
        if ticker and ticker not in found:
            found[ticker] = row
    return found


def sync_deals(store, deals: list[dict], candidates: list[dict]) -> list[str]:
    """Fill desk rows that have no terms. Returns the ids that changed."""
    index = candidates_by_ticker(candidates)
    changed: list[str] = []
    for deal in deals:
        if not _blank(deal):
            continue
        candidate = index.get(str(deal.get("target_ticker") or "").upper())
        if not candidate:
            continue
        facts = facts_from_candidate(candidate, price=deal.get("target_price"))
        merged = dict(deal)
        for key, value in facts.items():
            if value in (None, "", {}):
                continue
            if key == "target_name":
                current = str(deal.get("target_name") or "")
                ticker = str(deal.get("target_ticker") or "")
                if current and current.upper() != ticker.upper() and not _messy(current):
                    continue
            if key == "acquirer_name":
                current = str(deal.get("acquirer_name") or "")
                if current and not _messy(current):
                    continue
            merged[key] = value
        store.upsert_deal(merged)
        if hasattr(store, "merge_deal_fields"):
            store.merge_deal_fields(deal["id"], candidate.get("fields") or [])
        fresh = store.get_deal(deal["id"]) or merged
        try:
            from merger_arb.score import inputs_from_deal
            store.score_deal_row(fresh, inputs_from_deal(fresh))
        except Exception:
            pass
        changed.append(deal["id"])
    return changed


def load_candidates(store) -> list[dict]:
    connect = getattr(store, "_connect", None)
    if connect is None:
        return []
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT payload_json
              FROM scanner_candidates
             WHERE COALESCE(hidden, 0) = 0
               AND COALESCE(ignored, 0) = 0
            """
        )
        rows = []
        for (payload,) in cur.fetchall():
            row = json.loads(payload) if isinstance(payload, str) else dict(payload or {})
            if isinstance(row, dict):
                rows.append(row)
        return rows
