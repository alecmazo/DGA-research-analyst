"""Per-CIK submissions JSON. One call per desk deal, used for status changes."""

from __future__ import annotations

import json

from merger_arb.scanner.classify import classify_filing, needs_corroboration
from merger_arb.scanner.models import FetchResult, SourceRecord
from merger_arb.scanner.resolve import document_url, pad_cik


def submissions_url(cik: str) -> str:
    return f"https://data.sec.gov/submissions/CIK{pad_cik(cik)}.json"


def parse_submissions(payload: dict, *, pulled_at: str, allow_form_15: bool = False) -> list[SourceRecord]:
    filings = (payload or {}).get("filings") if isinstance(payload, dict) else None
    recent = (filings or {}).get("recent") if isinstance(filings, dict) else None
    if not isinstance(recent, dict):
        return []
    accessions = recent.get("accessionNumber") or []
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    items = recent.get("items") or []
    docs = recent.get("primaryDocument") or []
    cik = pad_cik((payload or {}).get("cik") or "")
    records = []
    for index, accession in enumerate(accessions):
        form = str(forms[index] if index < len(forms) else "")
        item_raw = items[index] if index < len(items) else ""
        if isinstance(item_raw, str):
            item_list = [part.strip() for part in item_raw.split(",") if part.strip()]
        else:
            item_list = [str(part) for part in (item_raw or [])]
        filename = str(docs[index] if index < len(docs) else "")
        filed = str(dates[index] if index < len(dates) else "")[:10]
        event = classify_filing(form, item_list, "", allow_form_15=allow_form_15) or ""
        url = document_url(cik, str(accession), filename) if cik and accession and filename else ""
        records.append(SourceRecord(
            source="sec_submissions",
            external_id=str(accession),
            url=url,
            form=form,
            cik=cik,
            title=form,
            published_at=filed,
            pulled_at=pulled_at,
            event_type=event,
            items=item_list,
            needs_corroboration=needs_corroboration(form),
            extra={"name": str((payload or {}).get("name") or "")},
        ))
    return records


class SecSubmissionsSource:
    name = "sec_submissions"
    label = "SEC submissions"
    tier = 1

    def __init__(self, config, urls=None):
        self.config = config
        self.urls = urls

    def enabled(self) -> bool:
        return bool(self.config.sec_ok)

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        if not self.enabled():
            return FetchResult(cursor=cursor, detail="SEC user agent is not set")
        urls = list(self.urls or [])
        if not urls:
            for deal in ctx.desk_deals or []:
                if deal.get("id") == "fixture-acme" or deal.get("sample"):
                    continue
                cik = deal.get("target_cik") or ""
                if cik:
                    urls.append(submissions_url(cik))
        cursor = dict(cursor or {})
        per_cik = dict(cursor.get("last_accession") or {})
        records = []
        for url in urls:
            try:
                body = ctx.get(url)
            except Exception as exc:
                return FetchResult(records=records, cursor=cursor, error=str(exc)[:300])
            if not body:
                continue
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                return FetchResult(records=records, cursor=cursor, error="submissions JSON could not be read")
            parsed = parse_submissions(
                payload, pulled_at=ctx.now.isoformat(), allow_form_15=self.config.enable_form_15,
            )
            cik = pad_cik(payload.get("cik") or "")
            last = per_cik.get(cik) or ""
            fresh = [row for row in parsed if not last or row.external_id > last]
            if parsed:
                per_cik[cik] = max(row.external_id for row in parsed)
            records.extend(fresh if last else parsed[:40])
        cursor["last_accession"] = per_cik
        return FetchResult(records=records, cursor=cursor)
