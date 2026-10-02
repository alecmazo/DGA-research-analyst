"""Regex terms from filing or press text. HTML is stripped first."""

from __future__ import annotations

import re
from decimal import Decimal

from merger_arb.scanner.models import FieldValue

_CASH = (
    re.compile(r"\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+per\s+share\s+in\s+cash", re.I),
    re.compile(
        r"(?:right to receive|for)\s+\$\s?(\d+(?:\.\d+)?)\s+(?:in cash\s+)?per\s+share",
        re.I,
    ),
)
_RATIO = re.compile(
    r"(\d+\.\d{2,6})\s+(?:shares|of a share)\s+of\s+([A-Z][\w.&,' -]+?)\s+common stock",
)
_CVR = re.compile(r"contingent value right", re.I)
_CVR_MAX = re.compile(r"up to\s+\$\s?(\d+(?:\.\d+)?)", re.I)
_COLLAR = re.compile(r"\bcollar\b", re.I)
_CLOSE = re.compile(
    r"expected to close (?:in|by|during) (?:the )?"
    r"(first|second|third|fourth|1st|2nd|3rd|4th) (quarter|half) of (\d{4})",
    re.I,
)
_CLOSE_YEAR = re.compile(r"expected to close in (\d{4})", re.I)
_CLOSE_PART = re.compile(r"(early|mid|late)[- ](\d{4})", re.I)
_OUTSIDE = re.compile(
    r"(?:Outside Date|End Date|Termination Date)[^.]{0,120}?(\w+ \d{1,2}, \d{4})",
    re.I,
)
_MEETING = re.compile(
    r"special meeting[^.]{0,200}?(?:will be held|to be held) on (?:\w+, )?(\w+ \d{1,2}, \d{4})",
    re.I,
)
_FEE = re.compile(
    r"termination fee[^.]{0,80}?\$\s?([\d.,]+)\s*(million|billion)?",
    re.I,
)
_REPORT_DATE = re.compile(r"Date of Report[:\s]+(\w+ \d{1,2}, \d{4})", re.I)
# "election of directors" plus a distant "cash or stock" is not a consideration election.
_ELECTION = re.compile(
    r"\b(?:elect to receive|may elect(?: to receive)?)\b[^.]{0,80}?\b(?:cash|stock)\b"
    r"|\bcash or stock election\b"
    r"|\belection of (?:cash|stock)\b",
    re.I,
)
_PRORATION = re.compile(r"proration", re.I)

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
_Q = {"first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3, "fourth": 4, "4th": 4}
_Q_END = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}


def plain_text(html: str) -> str:
    raw = html or ""
    if "<" not in raw:
        return re.sub(r"\s+", " ", raw).strip()
    try:
        from bs4 import BeautifulSoup
        text = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True)
    except Exception:
        text = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", text).strip()


def parse_long_date(text: str) -> str:
    match = re.search(r"([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})", text or "")
    if not match:
        return ""
    month = _MONTHS.get(match.group(1).lower())
    if not month:
        return ""
    return f"{int(match.group(3)):04d}-{month:02d}-{int(match.group(2)):02d}"


def _snip(text: str, match: re.Match) -> str:
    start = max(0, match.start() - 80)
    end = min(len(text), match.end() + 80)
    return text[start:end][:300]


def _field(name, value, raw, source_name, source_url, pulled_at, evidence) -> FieldValue:
    return FieldValue(
        field_name=name,
        value=value,
        raw=raw,
        source_name=source_name,
        source_url=source_url,
        pulled_at=pulled_at,
        method="regex",
        evidence=evidence,
    )


def _money(text: str) -> Decimal:
    # A sentence period can sit on the amount ("$5.00."). It is not part of the number.
    cleaned = (text or "").replace(",", "").strip().rstrip(".")
    return Decimal(cleaned)


def close_from_phrase(text: str) -> tuple[str, str, str]:
    """Return ISO date, assumption label, and the matched phrase."""
    match = _CLOSE.search(text or "")
    if match:
        word, kind, year = match.group(1).lower(), match.group(2).lower(), int(match.group(3))
        if kind == "half" and word in {"first", "1st"}:
            return f"{year}-06-30", f"first half {year} mapped to {year}-06-30", match.group(0)
        if kind == "half" and word in {"second", "2nd"}:
            return f"{year}-12-31", f"second half {year} mapped to {year}-12-31", match.group(0)
        quarter = _Q.get(word)
        if kind == "quarter" and quarter:
            month, day = _Q_END[quarter]
            iso = f"{year}-{month:02d}-{day:02d}"
            return iso, f"Q{quarter} {year} mapped to {iso}", match.group(0)
    year_only = _CLOSE_YEAR.search(text or "")
    if year_only:
        year = int(year_only.group(1))
        return f"{year}-12-31", f"{year} mapped to {year}-12-31 (year-end)", year_only.group(0)
    part = _CLOSE_PART.search(text or "")
    if part:
        year = int(part.group(2))
        when = part.group(1).lower()
        month_day = {"early": (3, 31), "mid": (6, 30), "late": (9, 30)}[when]
        iso = f"{year}-{month_day[0]:02d}-{month_day[1]:02d}"
        return iso, f"{when} {year} mapped to {iso}", part.group(0)
    return "", "", ""


def extract_terms(
    text: str,
    *,
    source_name: str,
    source_url: str,
    pulled_at: str,
    file_date: str = "",
) -> list[FieldValue]:
    body = plain_text(text)
    found: list[FieldValue] = []

    cash_values: list[Decimal] = []
    for pattern in _CASH:
        for match in pattern.finditer(body):
            amount = _money(match.group(1))
            cash_values.append(amount)
            found.append(_field(
                "cash_per_share", amount, match.group(0), source_name, source_url, pulled_at, _snip(body, match),
            ))
    if len(set(cash_values)) > 1:
        for row in found:
            if row.field_name == "cash_per_share":
                row.conflict = True

    for match in _RATIO.finditer(body):
        found.append(_field(
            "exchange_ratio",
            Decimal(match.group(1)),
            match.group(0),
            source_name,
            source_url,
            pulled_at,
            _snip(body, match),
        ))
        found.append(_field(
            "exchange_stock",
            match.group(2).strip(),
            match.group(0),
            source_name,
            source_url,
            pulled_at,
            _snip(body, match),
        ))

    cvr = _CVR.search(body)
    if cvr:
        window = body[cvr.start():cvr.start() + 180]
        cap = _CVR_MAX.search(window)
        found.append(_field(
            "cvr",
            _money(cap.group(1)) if cap else "contingent value right",
            cvr.group(0) if not cap else window[:120],
            source_name,
            source_url,
            pulled_at,
            window[:300],
        ))

    collar = _COLLAR.search(body)
    if collar:
        found.append(_field(
            "collar", "flagged", collar.group(0), source_name, source_url, pulled_at, _snip(body, collar),
        ))
    election = _ELECTION.search(body)
    if election:
        found.append(_field(
            "election", "flagged", election.group(0),
            source_name, source_url, pulled_at, _snip(body, election),
        ))
    pror = _PRORATION.search(body)
    if pror:
        found.append(_field(
            "proration", "flagged", pror.group(0), source_name, source_url, pulled_at, _snip(body, pror),
        ))

    iso_date, assumption, phrase = close_from_phrase(body)
    if iso_date:
        found.append(FieldValue(
            field_name="expected_close",
            value=iso_date,
            raw=phrase,
            source_name=source_name,
            source_url=source_url,
            pulled_at=pulled_at,
            method="regex",
            evidence=assumption,
        ))

    outside = _OUTSIDE.search(body)
    if outside:
        parsed = parse_long_date(outside.group(1))
        if parsed:
            found.append(_field(
                "outside_date", parsed, outside.group(0), source_name, source_url, pulled_at, _snip(body, outside),
            ))

    meeting = _MEETING.search(body)
    if meeting:
        parsed = parse_long_date(meeting.group(1))
        if parsed:
            found.append(_field(
                "vote_date", parsed, meeting.group(0), source_name, source_url, pulled_at, _snip(body, meeting),
            ))

    fee = _FEE.search(body)
    if fee:
        amount = _money(fee.group(1))
        unit = (fee.group(2) or "").lower()
        if unit == "million":
            amount *= Decimal(1_000_000)
        elif unit == "billion":
            amount *= Decimal(1_000_000_000)
        found.append(_field(
            "termination_fee", amount, fee.group(0), source_name, source_url, pulled_at, _snip(body, fee),
        ))

    report = _REPORT_DATE.search(body)
    if report:
        parsed = parse_long_date(report.group(1))
        if parsed:
            found.append(_field(
                "announce_date", parsed, report.group(0), source_name, source_url, pulled_at, _snip(body, report),
            ))
    elif file_date:
        found.append(FieldValue(
            field_name="announce_date",
            value=file_date[:10],
            raw=file_date[:10],
            source_name=source_name,
            source_url=source_url,
            pulled_at=pulled_at,
            method="structured",
            evidence="efts file_date",
        ))
    return found
