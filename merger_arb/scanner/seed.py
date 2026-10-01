"""Turn a candidate into the analysis packet the desk already opens. No second packet format."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone

from merger_arb.calc import recompute
from merger_arb.freshness import score_packet
from merger_arb.schema import sourced

_SECTIONS = (
    "overview", "spread", "structure", "regulatory", "votes",
    "catalysts", "downside", "upside", "sources",
)


def _num(value):
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "").replace("$", "").replace("%", ""))
    except ValueError:
        return None


def _source_type(field: dict) -> str:
    if field.get("method") == "computed":
        return "derived"
    name = (field.get("source_name") or "").lower()
    if "sec" in name:
        return "sec_filing"
    if "ftc" in name:
        return "regulator"
    if "chart" in name or name.startswith("market"):
        return "market_data"
    if any(token in name for token in ("news", "yahoo", "newswire", "globe", "nasdaq", "business")):
        return "news"
    return "press_release"


def _confidence(method: str) -> str:
    if method == "llm_verified":
        return "reported"
    return "confirmed"


def _field(field_id: str, field: dict, *, inputs: list[str] | None = None):
    method = field.get("method") or "regex"
    unverified = method == "llm_unverified"
    notes = field.get("evidence") or ""
    if unverified:
        notes = (notes + " UNVERIFIED").strip()
    return sourced(
        field_id,
        _num(field.get("value")) if field_id.endswith(("cash_per_share", "exchange_ratio", "target_price", "acquirer_price", "years_to_close")) else field.get("value"),
        unit="USD" if "price" in field_id or field_id.endswith("cash_per_share") else "",
        source={
            "type": _source_type(field),
            "name": field.get("source_name") or "Scanner",
            "url": field.get("source_url") or "",
            "locator": field.get("method") or "",
            "input_ids": inputs or [],
        },
        pulled_at=field.get("pulled_at") or datetime.now(timezone.utc).isoformat(),
        as_of=field.get("pulled_at") or "",
        freshness_class="market" if "price" in field_id else "terms",
        confidence=_confidence(method),
        notes=notes,
        inputs=inputs,
        unverified=unverified,
    )


def _current(candidate: dict, name: str) -> dict | None:
    rows = [
        row for row in candidate.get("fields") or []
        if row.get("field_name") == name and row.get("is_current", True)
    ]
    return rows[-1] if rows else None


def deal_id_for(candidate: dict, existing_ids: set[str] | None = None) -> str:
    target = re.sub(r"[^a-z0-9]", "", str(candidate.get("target_ticker") or "target").lower()) or "target"
    acquirer_raw = candidate.get("acquirer_ticker") or candidate.get("acquirer_name") or "buyer"
    acquirer = re.sub(r"[^a-z0-9]", "", str(acquirer_raw).lower())[:12] or "buyer"
    text = f"{target}-{acquirer}"[:40]
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,40}", text):
        text = "scanned-deal"
    if text == "fixture-acme":
        text = "scanned-deal"
    taken = existing_ids or set()
    if text in taken:
        suffix = re.sub(r"[^a-z0-9]", "", str(candidate.get("id") or "x"))[:6] or "x"
        text = f"{text[:33]}-{suffix}"[:41]
    return text


def _years(close_on: str, as_of: date) -> float | None:
    try:
        close = date.fromisoformat(close_on[:10])
    except ValueError:
        return None
    days = (close - as_of).days
    if days <= 0:
        return None
    return round(days / 365.0, 4)


def build_seed(candidate: dict, *, deal_id: str | None = None, as_of: date | None = None) -> tuple[dict, dict]:
    as_of = as_of or datetime.now(timezone.utc).date()
    deal_id = deal_id or deal_id_for(candidate)
    pulled = datetime.now(timezone.utc).isoformat()
    cash = _current(candidate, "cash_per_share")
    ratio = _current(candidate, "exchange_ratio")
    close = _current(candidate, "expected_close")
    outside = _current(candidate, "outside_date")
    vote = _current(candidate, "vote_date")
    announced = _current(candidate, "announce_date")
    kind = candidate.get("consideration_type") or "cash"
    empty = {"value": "", "source_name": "Scanner", "source_url": "", "pulled_at": pulled, "method": "structured", "evidence": ""}

    def text_field(field_id, value, basis=None):
        basis = basis or empty
        row = dict(basis)
        row["value"] = value
        return _field(field_id, row)

    sections = {key: {} for key in _SECTIONS}
    sections["overview"] = {
        "target_name": text_field("overview.target_name", candidate.get("target_name") or candidate.get("target_ticker") or ""),
        "target_ticker": text_field("overview.target_ticker", candidate.get("target_ticker") or ""),
        "acquirer_name": text_field("overview.acquirer_name", candidate.get("acquirer_name") or ""),
        "acquirer_ticker": text_field("overview.acquirer_ticker", candidate.get("acquirer_ticker") or ""),
        "announced_date": text_field("overview.announced_date", (announced or {}).get("value") or candidate.get("announce_date") or "", announced),
        "offer_terms": text_field("overview.offer_terms", candidate.get("offer_terms") or ""),
        "status": text_field("overview.status", (candidate.get("status") or "pending").lower()),
    }
    if candidate.get("current_price"):
        sections["overview"]["target_price"] = _field("overview.target_price", {
            "value": candidate.get("current_price"),
            "source_name": "market data",
            "source_url": "",
            "pulled_at": pulled,
            "method": "structured",
            "evidence": "price used for the scan table",
        })
    if candidate.get("acquirer_price"):
        sections["overview"]["acquirer_price"] = _field("overview.acquirer_price", {
            "value": candidate.get("acquirer_price"),
            "source_name": "market data",
            "source_url": "",
            "pulled_at": pulled,
            "method": "structured",
            "evidence": "acquirer price used for the scan table",
        })
    if close and close.get("value"):
        sections["overview"]["expected_close"] = _field("overview.expected_close", close)
        years = _years(str(close.get("value")), as_of)
        if years is not None:
            sections["overview"]["years_to_close"] = _field(
                "overview.years_to_close",
                {
                    "value": years,
                    "source_name": "Computed from the expected close",
                    "source_url": close.get("source_url") or "",
                    "pulled_at": pulled,
                    "method": "computed",
                    "evidence": close.get("evidence") or "",
                },
                inputs=["overview.expected_close"],
            )
    if outside and outside.get("value"):
        sections["overview"]["outside_date"] = _field("overview.outside_date", outside)
    sections["structure"]["consideration"] = text_field("structure.consideration", kind or "cash", cash or ratio or empty)
    if cash:
        sections["structure"]["cash_per_share"] = _field("structure.cash_per_share", cash)
    if ratio:
        sections["structure"]["exchange_ratio"] = _field("structure.exchange_ratio", ratio)
    if vote and vote.get("value"):
        sections["votes"]["meeting_date"] = _field("votes.meeting_date", vote)
    if candidate.get("hsr"):
        sections["regulatory"]["hsr"] = text_field("regulatory.hsr", candidate.get("hsr"))
    packet = {
        "packet_meta": {
            "deal_id": deal_id,
            "version": 1,
            "model": "scanner",
            "created_at": pulled,
            "stage": "scanner",
            "parent_version": None,
        },
        "stage1_notes": [],
        "flags": [],
        "confirmed_ids": [],
        "sections": sections,
    }
    recompute(packet)
    score_packet(packet)
    deal = {
        "id": deal_id,
        "target_ticker": candidate.get("target_ticker") or "",
        "target_name": candidate.get("target_name") or candidate.get("target_ticker") or "",
        "acquirer_ticker": candidate.get("acquirer_ticker") or "",
        "acquirer_name": candidate.get("acquirer_name") or "",
        "announced_on": str((announced or {}).get("value") or candidate.get("announce_date") or "")[:10],
        "status": "pending",
    }
    return packet, deal
