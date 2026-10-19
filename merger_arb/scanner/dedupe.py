"""Collapse duplicate deal rows. Local fixtures and localhost only.

Rules (plan §5.4):
1. Target identity is the 10-digit CIK, else the ticker.
2. Acquirer identity is the acquirer CIK, else a normalized name.
   A name that is only a role word (buyer, merger sub, parent) is unknown.
3. An unknown acquirer attaches to the single open deal for that target.
4. Two distinct acquirers stay two deals when each has SEC evidence
   or two news sources.
5. A filing whose filer CIK is an existing acquirer (425 / S-4 / F-4 / SC TO-T
   with ambiguous parties) attaches to that deal. It does not become a target.
"""

from __future__ import annotations

from merger_arb.scanner.resolve import is_generic_acquirer, normalize_acquirer, pad_cik

_ACQUIRER_FORMS = {"425", "S-4", "F-4", "SC TO-T"}


def target_cik(row: dict) -> str:
    return pad_cik(row.get("target_cik") or "")


def target_ticker(row: dict) -> str:
    return str(row.get("target_ticker") or "").upper().strip()


def acquirer_cik(row: dict) -> str:
    return pad_cik(row.get("acquirer_cik") or "")


def acquirer_name_key(row: dict) -> str:
    name = str(row.get("acquirer_name") or "")
    if is_generic_acquirer(name):
        return ""
    return normalize_acquirer(name)


def acquirer_identity(row: dict) -> str:
    cik = acquirer_cik(row)
    if cik:
        return f"cik:{cik}"
    return acquirer_name_key(row)


def _form(row: dict) -> str:
    return str(row.get("form") or "").upper().split("/")[0].strip()


def is_mirror_filing(row: dict) -> bool:
    if row.get("filer_role") == "acquirer":
        return True
    if row.get("mirror"):
        return True
    return _form(row) in _ACQUIRER_FORMS and not acquirer_identity(row) and bool(target_cik(row) or target_ticker(row))


def _sec(row: dict) -> bool:
    if row.get("sec_evidence"):
        return True
    source = str(row.get("source") or row.get("evidence_source") or "").lower()
    return source.startswith("sec") or "sec" in source


def _news_count(row: dict) -> int:
    try:
        return int(row.get("news_sources") or 0)
    except (TypeError, ValueError):
        return 0


def distinct_bidders(left: dict, right: dict) -> bool:
    a = acquirer_identity(left)
    b = acquirer_identity(right)
    if not a or not b or a == b:
        return False
    left_ok = _sec(left) or _news_count(left) >= 2
    right_ok = _sec(right) or _news_count(right) >= 2
    return left_ok and right_ok


def same_target(left: dict, right: dict) -> bool:
    lc, rc = target_cik(left), target_cik(right)
    lt, rt = target_ticker(left), target_ticker(right)
    if lc and rc and lc == rc:
        return True
    if lc and not rc and lt and rt and lt == rt:
        return True
    if rc and not lc and lt and rt and lt == rt:
        return True
    if not lc and not rc and lt and rt and lt == rt:
        return True
    if lc and rc and lc != rc:
        return False
    if lt and rt and lt == rt and (not lc or not rc or lc == rc):
        return True
    return False


def _mirror_of(candidate: dict, deal: dict) -> bool:
    """candidate's filer is deal's acquirer, so candidate is not a new target."""
    if not is_mirror_filing(candidate):
        return False
    filer = target_cik(candidate) or target_ticker(candidate)
    if not filer:
        return False
    if acquirer_cik(deal) and filer == acquirer_cik(deal):
        return True
    deal_ticker = str(deal.get("acquirer_ticker") or "").upper()
    if deal_ticker and filer == deal_ticker:
        return True
    return False


def should_merge(left: dict, right: dict) -> bool:
    if _mirror_of(left, right) or _mirror_of(right, left):
        return True
    if not same_target(left, right):
        return False
    if distinct_bidders(left, right):
        return False
    a = acquirer_identity(left)
    b = acquirer_identity(right)
    if not a or not b:
        return True
    return a == b


def _acquirer_token(row: dict) -> str:
    return acquirer_cik(row) or str(row.get("acquirer_ticker") or "").upper()


def find_match(incoming: dict, existing: list[dict]) -> dict | None:
    """Pick the stored deal this record belongs to, or None to create one.

    Unknown acquirers attach only when there is a single open deal for the
    target. Two named bidders stay two deals.
    """
    if not existing:
        return None
    key = str(incoming.get("deal_key") or "")
    if key:
        for row in existing:
            if str(row.get("deal_key") or "") == key:
                return row
    mirrors = [
        row for row in existing
        if _mirror_of(incoming, row) or _mirror_of(row, incoming)
    ]
    if not mirrors:
        incoming_acq = _acquirer_token(incoming)
        incoming_tgt = target_cik(incoming) or target_ticker(incoming)
        form_acquirer = is_mirror_filing(incoming) or _form(incoming) in _ACQUIRER_FORMS
        for row in existing:
            deal_acq = _acquirer_token(row)
            if not deal_acq:
                continue
            if form_acquirer and incoming_acq and incoming_acq == deal_acq:
                if not incoming_tgt or incoming_tgt == deal_acq:
                    mirrors.append(row)
                    continue
            if incoming_tgt == deal_acq and not acquirer_identity(incoming):
                mirrors.append(row)
    if mirrors:
        return mirrors[0]
    same = [row for row in existing if same_target(incoming, row)]
    if not same:
        return None
    inc_id = acquirer_identity(incoming)
    if not inc_id:
        if len(same) == 1:
            return same[0]
        return None
    named = [row for row in same if acquirer_identity(row) == inc_id]
    if named:
        return named[0]
    unknown = [row for row in same if not acquirer_identity(row)]
    if len(unknown) == 1:
        return unknown[0]
    return None


class _Union:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a: int, b: int) -> None:
        pa, pb = self.find(a), self.find(b)
        if pa != pb:
            self.parent[pb] = pa


def group_rows(rows: list[dict]) -> list[list[dict]]:
    if not rows:
        return []
    union = _Union(len(rows))
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            if should_merge(rows[i], rows[j]):
                union.union(i, j)
    buckets: dict[int, list[dict]] = {}
    for i, row in enumerate(rows):
        buckets.setdefault(union.find(i), []).append(row)
    return list(buckets.values())


def _canonical(group: list[dict]) -> dict:
    def rank(row: dict) -> tuple:
        mirror = 1 if is_mirror_filing(row) else 0
        has_cik = 0 if target_cik(row) else 1
        known = 0 if acquirer_identity(row) else 1
        sec = 0 if _sec(row) else 1
        return (mirror, has_cik, known, sec, str(row.get("deal_key") or ""))

    return sorted(group, key=rank)[0]


def collapse(rows: list[dict]) -> tuple[list[dict], dict]:
    """Return deduped rows and a report. A second call changes nothing."""
    before = len(rows)
    groups = group_rows(rows)
    kept: list[dict] = []
    collapsed = []
    aliases = []
    for group in groups:
        if len(group) == 1:
            kept.append(dict(group[0]))
            continue
        winner = dict(_canonical(group))
        winner_key = str(winner.get("deal_key") or winner.get("id") or "")
        members = []
        for row in group:
            key = str(row.get("deal_key") or row.get("id") or "")
            members.append(key)
            if key and key != winner_key:
                aliases.append({"alias_key": key, "deal_key": winner_key})
            if target_cik(row) and not target_cik(winner):
                winner["target_cik"] = target_cik(row)
            if target_ticker(row) and not target_ticker(winner):
                winner["target_ticker"] = target_ticker(row)
            if acquirer_cik(row) and not acquirer_cik(winner):
                winner["acquirer_cik"] = acquirer_cik(row)
            if acquirer_name_key(row) and not acquirer_name_key(winner):
                winner["acquirer_name"] = row.get("acquirer_name") or ""
            if is_mirror_filing(row):
                winner["acquirer_cik"] = winner.get("acquirer_cik") or target_cik(row)
                winner["acquirer_ticker"] = winner.get("acquirer_ticker") or target_ticker(row)
        if target_cik(winner):
            acq = acquirer_name_key(winner) or "unknown"
            winner["deal_key"] = f"{target_cik(winner)}|{acq}"
        kept.append(winner)
        collapsed.append({"into": winner.get("deal_key") or winner.get("id"), "members": members})
    report = {
        "before": before,
        "after": len(kept),
        "groups": len(groups),
        "collapsed": collapsed,
        "aliases": aliases,
        "unchanged": before == len(kept) and not collapsed,
    }
    return kept, report


def fixture_rows() -> list[dict]:
    """Example duplicates. Not live deals."""
    return [
        {
            "id": "unk",
            "deal_key": "0000123456|unknown",
            "target_cik": "0000123456",
            "target_ticker": "ACME",
            "acquirer_name": "",
            "source": "sec",
            "sec_evidence": True,
        },
        {
            "id": "known",
            "deal_key": "0000123456|buyer",
            "target_cik": "0000123456",
            "target_ticker": "ACME",
            "acquirer_name": "Buyer Holdings Corp.",
            "acquirer_cik": "0000888888",
            "source": "sec",
            "sec_evidence": True,
        },
        {
            "id": "ticker-only",
            "deal_key": "ZZZZ|other capital",
            "target_cik": "",
            "target_ticker": "ZZZZ",
            "acquirer_name": "Other Capital",
            "source": "sec",
            "sec_evidence": True,
        },
        {
            "id": "cik",
            "deal_key": "0000999999|other capital",
            "target_cik": "0000999999",
            "target_ticker": "ZZZZ",
            "acquirer_name": "Other Capital Inc.",
            "source": "sec",
            "sec_evidence": True,
        },
        {
            "id": "real-deal",
            "deal_key": "0000555555|alpha",
            "target_cik": "0000555555",
            "target_ticker": "TGT",
            "acquirer_name": "Alpha Inc",
            "acquirer_cik": "0000777777",
            "acquirer_ticker": "ALPH",
            "source": "sec",
            "sec_evidence": True,
        },
        {
            "id": "mirror-425",
            "deal_key": "0000777777|unknown",
            "target_cik": "0000777777",
            "target_ticker": "ALPH",
            "acquirer_name": "",
            "form": "425",
            "filer_role": "acquirer",
            "source": "sec",
            "sec_evidence": True,
            "mirror": True,
        },
        {
            "id": "bid-alpha",
            "deal_key": "0000666666|alpha",
            "target_cik": "0000666666",
            "target_ticker": "DUAL",
            "acquirer_name": "Alpha Inc",
            "acquirer_cik": "0000111111",
            "source": "sec",
            "sec_evidence": True,
        },
        {
            "id": "bid-beta",
            "deal_key": "0000666666|beta",
            "target_cik": "0000666666",
            "target_ticker": "DUAL",
            "acquirer_name": "Beta Inc",
            "acquirer_cik": "0000222222",
            "source": "sec",
            "sec_evidence": True,
        },
    ]
