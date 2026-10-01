"""Shared SEC helpers. The Atom cgi-bin feed is not used."""

from __future__ import annotations

import json
from datetime import date, timedelta
from urllib.parse import quote

from merger_arb.scanner.classify import classify_filing, needs_corroboration
from merger_arb.scanner.models import SourceRecord, iso
from merger_arb.scanner.resolve import document_url, pad_cik, tickers_in_text

NEW_FORMS = (
    ("8-K", '"Agreement and Plan of Merger"'),
    ("425", ""),
    ("PREM14A", ""),
    ("PREM14C", ""),
    ("DEFM14A", ""),
    ("DEFM14C", ""),
    ("DEFA14A", ""),
    ("S-4", ""),
    ("F-4", ""),
    ("SC TO-T", ""),
    ("SC 14D9", ""),
    ("SC TO-I", ""),
    ("SC 13E3", ""),
    ("25-NSE", ""),
)


def search_url(form: str, start: date, end: date, phrase: str = "", offset: int = 0) -> str:
    url = (
        "https://efts.sec.gov/LATEST/search-index"
        f"?forms={quote(form)}&dateRange=custom&startdt={start.isoformat()}&enddt={end.isoformat()}"
    )
    if phrase:
        url += "&q=" + quote(phrase)
    if offset:
        url += f"&from={offset}"
    return url


def window(today: date, *, full: bool, since: date, cursor: dict, lookback_days: int) -> tuple[date, date]:
    if full:
        start = since or (today - timedelta(days=lookback_days))
        return start, today
    last = str((cursor or {}).get("last_file_date") or "")[:10]
    if last:
        try:
            start = date.fromisoformat(last) - timedelta(days=1)
        except ValueError:
            start = today - timedelta(days=lookback_days)
    else:
        start = since or (today - timedelta(days=lookback_days))
    return start, today


def parse_efts(payload: dict, *, pulled_at: str, query_has_merger: bool = False, allow_form_15: bool = False):
    if not isinstance(payload, dict) or not isinstance(payload.get("hits"), dict):
        return [], "search JSON shape changed"
    hits = payload["hits"].get("hits")
    if not isinstance(hits, list):
        return [], "search JSON shape changed"
    records = []
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        source = hit.get("_source") if isinstance(hit.get("_source"), dict) else {}
        if not source:
            continue
        adsh = str(source.get("adsh") or "")
        hit_id = str(hit.get("_id") or "")
        filename = hit_id.split(":", 1)[1] if ":" in hit_id else ""
        ciks = source.get("ciks") or []
        cik = pad_cik(ciks[0] if ciks else "")
        form = str(source.get("form") or "")
        items = [str(item) for item in (source.get("items") or [])]
        names = [str(name) for name in (source.get("display_names") or [])]
        file_date = str(source.get("file_date") or "")[:10]
        url = document_url(cik, adsh, filename) if cik and adsh and filename else ""
        event = classify_filing(
            form, items, "", query_has_merger=query_has_merger, allow_form_15=allow_form_15,
        )
        external = adsh or hit_id
        if not external:
            continue
        records.append(SourceRecord(
            source="sec_efts",
            external_id=external,
            url=url,
            form=form,
            cik=cik,
            title=names[0] if names else form,
            published_at=file_date,
            pulled_at=pulled_at,
            raw_excerpt=names[0] if names else "",
            event_type=event or "",
            items=items,
            tickers=tickers_in_text(" ".join(names)),
            display_names=names,
            needs_corroboration=needs_corroboration(form),
            query_has_merger=query_has_merger,
            extra={"filename": filename, "adsh": adsh},
        ))
    return records, ""


def loads(body: bytes | str) -> dict:
    if isinstance(body, bytes):
        body = body.decode("utf-8", errors="replace")
    return json.loads(body)


def seen_filter(records: list[SourceRecord], cursor: dict) -> tuple[list[SourceRecord], dict]:
    seen = set(cursor.get("seen_ids") or [])
    fresh = [row for row in records if row.external_id not in seen]
    dates = [row.published_at for row in records if row.published_at]
    last = max(dates) if dates else str(cursor.get("last_file_date") or "")
    merged = list(seen)
    for row in records:
        if row.external_id not in seen:
            merged.append(row.external_id)
    return fresh, {
        "seen_ids": merged[-5000:],
        "last_file_date": last,
    }


def iso_now(now) -> str:
    return iso(now)
