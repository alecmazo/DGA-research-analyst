"""Form 4, 13F, and EDGAR hit counts. Search URLs come from the merger-arb scanner."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date, timedelta

from merger_arb.scanner.sources.sec_common import search_url


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def _value_under(parent, tag: str) -> str:
    for el in parent.iter():
        if _local(el.tag) != tag:
            continue
        for child in el.iter():
            if child is el:
                continue
            if _local(child.tag) == "value" and child.text and child.text.strip():
                return child.text.strip()
        if el.text and el.text.strip():
            return el.text.strip()
    return ""


def _first(root, tag: str) -> str:
    for el in root.iter():
        if _local(el.tag) == tag and el.text and el.text.strip():
            return el.text.strip()
    return ""


def hit_count(payload: dict) -> int | None:
    """EDGAR full-text `hits.total`. None when the shape is not the search index."""
    if not isinstance(payload, dict):
        return None
    hits = payload.get("hits")
    if not isinstance(hits, dict):
        return None
    total = hits.get("total")
    if isinstance(total, dict):
        try:
            return int(total.get("value") or 0)
        except (TypeError, ValueError):
            return None
    if isinstance(total, int):
        return total
    return None


def edgar_search_link(phrase: str, as_of: date, form: str = "10-K") -> str:
    start = as_of - timedelta(days=120)
    return search_url(form, start, as_of, phrase)


def parse_form4_xml(text: str) -> list[dict]:
    """Open-market (code P) acquisitions from one ownership document."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    ticker = _first(root, "issuerTradingSymbol").upper()
    owner = _first(root, "rptOwnerName")
    title = _first(root, "officerTitle")
    role = title
    if not role:
        for el in root.iter():
            if _local(el.tag) == "isDirector" and (el.text or "").strip() in {"1", "true", "True"}:
                role = "Director"
                break
    filed = _first(root, "periodOfReport")[:10]
    trades = []
    for el in root.iter():
        if _local(el.tag) != "nonDerivativeTransaction":
            continue
        code = _value_under(el, "transactionCode").upper()
        if code != "P":
            continue
        acquired = _value_under(el, "transactionAcquiredDisposedCode").upper()
        if acquired and acquired != "A":
            continue
        try:
            shares = float(_value_under(el, "transactionShares") or 0)
            price = float(_value_under(el, "transactionPricePerShare") or 0)
        except ValueError:
            continue
        day = _value_under(el, "transactionDate")[:10] or filed
        trades.append({
            "ticker": ticker,
            "insider": owner,
            "role": role,
            "code": "P",
            "date": day,
            "shares": shares,
            "price": price,
            "value": shares * price,
        })
    return trades


def parse_13f_infotable(text: str) -> list[dict]:
    """Information-table rows. SEC `value` is thousands of dollars."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    rows = []
    for el in root.iter():
        if _local(el.tag) not in {"infoTable", "infotable"}:
            continue
        issuer = ""
        cusip = ""
        value = shares = None
        for child in el.iter():
            name = _local(child.tag)
            raw = (child.text or "").strip()
            if name == "nameOfIssuer" and raw and not issuer:
                issuer = raw
            elif name == "cusip" and raw and not cusip:
                cusip = raw
            elif name == "value" and raw and value is None:
                try:
                    value = float(raw) * 1000.0
                except ValueError:
                    value = None
            elif name == "sshPrnamt" and raw and shares is None:
                try:
                    shares = float(raw)
                except ValueError:
                    shares = None
        if issuer or cusip:
            rows.append({
                "issuer": issuer,
                "cusip": cusip,
                "value": value or 0,
                "shares": shares or 0,
            })
    return rows
