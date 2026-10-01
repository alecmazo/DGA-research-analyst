"""Daily form index parser. Used for gap fill and when search JSON changes shape."""

from __future__ import annotations

import re
from datetime import timedelta

from merger_arb.scanner.classify import classify_filing, needs_corroboration
from merger_arb.scanner.models import FetchResult, SourceRecord
from merger_arb.scanner.resolve import pad_cik
from merger_arb.scanner.sources.sec_common import seen_filter

# SEC form.idx columns: Form Type 12, Company Name 62, CIK 12, Date Filed 12, then the path.
# Form types such as "SC TO-I" contain a space, so this is not a whitespace-split row.
_FORM_W, _NAME_W, _CIK_W, _DATE_W = 12, 62, 12, 12
_DATE_AT = _FORM_W + _NAME_W + _CIK_W
_FILE_AT = _DATE_AT + _DATE_W
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_KEEP = {
    "8-K", "425", "PREM14A", "PREM14C", "DEFM14A", "DEFM14C", "DEFA14A",
    "S-4", "F-4", "SC TO-T", "SC 14D9", "SC TO-I", "SC 13E3", "25-NSE",
}


def index_url(day) -> str:
    quarter = (day.month - 1) // 3 + 1
    stamp = day.strftime("%Y%m%d")
    return (
        f"https://www.sec.gov/Archives/edgar/daily-index/{day.year}/QTR{quarter}/form.{stamp}.idx"
    )


def parse_form_index(text: str, *, pulled_at: str, allow_form_15: bool = False) -> list[SourceRecord]:
    records = []
    for line in (text or "").splitlines():
        if len(line) < _FILE_AT:
            continue
        form = line[0:_FORM_W].strip().upper()
        company = line[_FORM_W:_FORM_W + _NAME_W].strip()
        cik_raw = line[_FORM_W + _NAME_W:_DATE_AT].strip()
        filed = line[_DATE_AT:_FILE_AT].strip()
        path = line[_FILE_AT:].strip()
        if not form or not cik_raw.isdigit() or not _DATE.fullmatch(filed) or not path:
            continue
        root = form.split("/")[0]
        if root not in _KEEP and not (allow_form_15 and root in {"15", "15-12G", "15-15D"}):
            continue
        cik = pad_cik(cik_raw)
        url = "https://www.sec.gov/Archives/" + path.lstrip("/")
        event = classify_filing(form, [], "", allow_form_15=allow_form_15) or ""
        if root == "8-K":
            event = ""
        records.append(SourceRecord(
            source="sec_index",
            external_id=path,
            url=url,
            form=form,
            cik=cik,
            title=company,
            published_at=filed,
            pulled_at=pulled_at,
            raw_excerpt=company,
            event_type=event,
            needs_corroboration=needs_corroboration(form),
            display_names=[company] if company else [],
        ))
    return records


class SecIndexSource:
    name = "sec_index"
    label = "SEC index"
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
            day = ctx.today
            for _ in range(3):
                if day.weekday() < 5:
                    urls.append(index_url(day))
                day = day - timedelta(days=1)
        records = []
        for url in urls:
            try:
                body = ctx.get(url)
            except Exception as exc:
                return FetchResult(records=records, cursor=cursor, error=str(exc)[:300])
            if not body:
                continue
            text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else str(body)
            records.extend(parse_form_index(
                text, pulled_at=ctx.now.isoformat(), allow_form_15=self.config.enable_form_15,
            ))
        fresh, new_cursor = seen_filter(records, cursor or {})
        return FetchResult(records=fresh, cursor=new_cursor)
