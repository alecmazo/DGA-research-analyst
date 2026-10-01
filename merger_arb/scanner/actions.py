"""Desk writes. Each one requires the click that called it."""

from __future__ import annotations

from copy import deepcopy

from merger_arb.calc import recompute
from merger_arb.freshness import score_packet
from merger_arb.schema import sourced
from merger_arb.scanner.seed import build_seed, deal_id_for


class ActionError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _confirmed(body: dict | None) -> None:
    if not isinstance(body, dict) or body.get("confirm") is not True:
        raise ActionError(400, "Confirm the fields before anything is written to the desk.")


def _reject_sample(deal_id: str) -> None:
    if deal_id == "fixture-acme":
        raise ActionError(400, "The sample deal stays as it is.")


def add_to_desk(scanner, desk, candidate_id: str, body: dict | None) -> dict:
    _confirmed(body)
    candidate = scanner.get_candidate(candidate_id)
    if candidate is None:
        raise ActionError(404, "Candidate not found")
    if candidate.get("desk_deal_id"):
        deal_id = candidate["desk_deal_id"]
        _reject_sample(deal_id)
        return {"ok": True, "deal_id": deal_id, "path": f"/merger-arb/analysis/{deal_id}", "already": True}
    existing = {row.get("id") for row in desk.list_deals()}
    deal_id = deal_id_for(candidate, existing)
    _reject_sample(deal_id)
    packet, deal = build_seed(candidate, deal_id=deal_id)
    desk.upsert_deal(deal)
    desk.save_version(packet)
    scanner.set_desk_deal(candidate_id, deal_id)
    scanner.add_seed(candidate_id, packet)
    return {"ok": True, "deal_id": deal_id, "path": f"/merger-arb/analysis/{deal_id}", "already": False}


def ignore_candidate(scanner, candidate_id: str, body: dict | None) -> dict:
    candidate = scanner.get_candidate(candidate_id)
    if candidate is None:
        raise ActionError(404, "Candidate not found")
    reason = str((body or {}).get("reason") or "")[:200]
    scanner.ignore_key(candidate.get("deal_key") or "", reason)
    return {"ok": True, "deal_key": candidate.get("deal_key") or ""}


def _set_field(packet: dict, section: str, name: str, field_id: str, value, alert: dict) -> None:
    block = packet.setdefault("sections", {}).setdefault(section, {})
    block[name] = sourced(
        field_id,
        value,
        source={
            "type": "sec_filing" if "sec" in (alert.get("source_name") or "") else "news",
            "name": alert.get("source_name") or alert.get("alert_type") or "Scanner alert",
            "url": alert.get("source_url") or "",
            "locator": alert.get("alert_type") or "",
        },
        pulled_at=alert.get("pulled_at") or "",
        as_of=alert.get("pulled_at") or "",
        freshness_class="event",
        confidence="confirmed" if alert.get("certainty") == "confirmed" else "reported",
        notes=alert.get("evidence") or "",
    )


def apply_alert(scanner, desk, alert_id: str, body: dict | None) -> dict:
    _confirmed(body)
    alert = scanner.get_alert(alert_id)
    if alert is None:
        raise ActionError(404, "Alert not found")
    deal_id = alert.get("desk_deal_id") or ""
    _reject_sample(deal_id)
    deal = desk.get_deal(deal_id)
    latest = desk.latest(deal_id) if deal else None
    if deal is None or latest is None:
        raise ActionError(404, "There is no packet to update yet.")
    before_version = (latest.get("packet_meta") or {}).get("version")
    packet = deepcopy(latest)
    meta = packet.setdefault("packet_meta", {})
    meta["parent_version"] = before_version
    meta["version"] = None
    meta["stage"] = "scanner_apply"
    meta["model"] = "scanner"
    details = alert.get("details") or {}
    kind = alert.get("alert_type")
    if kind == "AMENDED":
        after = ((details.get("diff") or {}).get("cash_per_share") or {}).get("after") or details.get("cash_per_share")
        if after not in (None, ""):
            try:
                amount = float(after)
            except (TypeError, ValueError):
                amount = after
            _set_field(packet, "structure", "cash_per_share", "structure.cash_per_share", amount, alert)
    elif kind == "VOTE_DATE" and details.get("vote_date"):
        _set_field(packet, "votes", "meeting_date", "votes.meeting_date", details["vote_date"], alert)
    elif kind == "COMPLETED":
        _set_field(packet, "overview", "status", "overview.status", "completed", alert)
        deal = dict(deal)
        deal["status"] = "completed"
        desk.upsert_deal(deal)
    elif kind == "TERMINATED":
        _set_field(packet, "overview", "status", "overview.status", "terminated", alert)
        deal = dict(deal)
        deal["status"] = "terminated"
        desk.upsert_deal(deal)
    elif kind == "HSR_ET":
        _set_field(packet, "regulatory", "hsr", "regulatory.hsr", "early_termination_granted", alert)
    recompute(packet)
    score_packet(packet)
    saved = desk.save_version(packet)
    new_version = (saved.get("packet_meta") or {}).get("version")
    if new_version == before_version:
        raise ActionError(500, "Apply did not save a new version.")
    scanner.mark_applied(alert_id)
    return {"ok": True, "deal_id": deal_id, "version": new_version, "path": f"/merger-arb/analysis/{deal_id}"}
