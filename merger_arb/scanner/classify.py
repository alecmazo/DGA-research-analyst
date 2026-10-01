"""Form, item, and headline to an event type. No network."""

from __future__ import annotations

import re

MERGER_PHRASES = (
    "agreement and plan of merger",
    "merger agreement",
    "business combination agreement",
)

_NEW = re.compile(
    r"definitive (merger )?agreement|to acquire|to be acquired|agrees? to (be )?acquire|"
    r"merger agreement|tender offer|take[- ]private|all[- ]cash (deal|transaction)|per share in cash",
    re.I,
)
_DONE = re.compile(
    r"complet(?:es|ed|ion of) (?:the |its )?(?:previously announced )?(?:acquisition|merger|combination)|"
    r"closes? acquisition|merger closed",
    re.I,
)
_DEAD = re.compile(
    r"terminat(?:e|es|ed|ion of) (?:the )?(?:merger|acquisition) agreement|walks? away",
    re.I,
)
_AMENDED = re.compile(
    r"revised|amended (?:merger )?agreement|increases? (?:offer|bid)|sweeten",
    re.I,
)
_AMEND_TEXT = re.compile(
    r"amendment no\.|amended and restated agreement and plan of merger",
    re.I,
)


def _root(form: str) -> str:
    text = (form or "").upper().strip()
    return text.split("/")[0].strip()


def _items(items: list[str] | None) -> set[str]:
    out: set[str] = set()
    for item in items or []:
        for part in str(item).replace(";", ",").split(","):
            part = part.strip()
            if part:
                out.add(part)
    return out


def _merger(text: str, query_has_merger: bool) -> bool:
    low = (text or "").lower()
    if query_has_merger:
        return True
    return any(phrase in low for phrase in MERGER_PHRASES)


def needs_corroboration(form: str) -> bool:
    root = _root(form)
    return root in {"25-NSE", "15", "15-12G", "15-15D"}


def classify_filing(
    form: str,
    items: list[str] | None,
    text: str,
    *,
    query_has_merger: bool = False,
    allow_form_15: bool = False,
) -> str | None:
    """Return an event type, or None when the filing is noise."""
    root = _root(form)
    found = _items(items)
    low = (text or "").lower()
    merger = _merger(text, query_has_merger)
    amended = bool(_AMEND_TEXT.search(text or "")) or "/A" in (form or "").upper()

    if root == "8-K":
        if "1.02" in found and ("merger" in low or merger):
            return "TERMINATED"
        if "2.01" in found:
            return "COMPLETED"
        if "5.07" in found:
            return "VOTE_RESULT"
        if "1.01" in found and merger:
            return "AMENDED" if amended else "NEW_DEAL"
        return None
    if root == "425":
        return "NEW_DEAL" if merger else "PENDING_UPDATE"
    if root in {"PREM14A", "PREM14C"}:
        return "AMENDED" if amended else "PENDING_UPDATE"
    if root in {"DEFM14A", "DEFM14C", "DEFA14A"}:
        if "special meeting" in low:
            return "VOTE_SCHEDULED"
        return "PENDING_UPDATE"
    if root in {"S-4", "F-4"}:
        return "AMENDED" if amended else "PENDING_UPDATE"
    if root in {"SC TO-T", "SC 14D9", "SC 13E3"}:
        return "AMENDED" if amended else "NEW_DEAL"
    if root == "SC TO-I":
        if "13e3" in low or "sc 13e3" in low or merger:
            return "NEW_DEAL"
        return None
    if root == "25-NSE":
        return "COMPLETED"
    if root in {"15", "15-12G", "15-15D"}:
        return "COMPLETED" if allow_form_15 else None
    if amended and root:
        return "AMENDED"
    return None


def classify_headline(text: str) -> str | None:
    blob = text or ""
    if not blob.strip():
        return None
    if _DEAD.search(blob):
        return "TERMINATED"
    if _DONE.search(blob):
        return "COMPLETED"
    if _AMENDED.search(blob):
        return "AMENDED"
    if _NEW.search(blob):
        return "NEW_DEAL"
    return None


def pair_issuer_tenders(records: list) -> None:
    """SC TO-I counts when the same CIK also has an SC 13E3 in the batch."""
    thirteen = set()
    for record in records:
        if _root(getattr(record, "form", "")) == "SC 13E3" and record.cik:
            thirteen.add(record.cik)
    for record in records:
        if _root(getattr(record, "form", "")) != "SC TO-I":
            continue
        if record.event_type:
            continue
        if record.cik and record.cik in thirteen:
            record.event_type = "NEW_DEAL"
