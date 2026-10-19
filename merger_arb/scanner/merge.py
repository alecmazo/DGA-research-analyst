"""Dedupe source records into candidates. Two bids for one target stay two rows."""

from __future__ import annotations

from merger_arb.scanner.dedupe import find_match, should_merge
from merger_arb.scanner.extract import extract_terms
from merger_arb.scanner.models import FieldValue, SourceRecord
from merger_arb.scanner.resolve import (
    TickerMap,
    deal_key,
    names_match,
    pad_cik,
    parse_display_name,
    parties_from_text,
    tickers_in_text,
)

_TARGET_FILER = {"DEFM14A", "DEFM14C", "PREM14A", "PREM14C", "SC 14D9", "DEFA14A"}
_ACQUIRER_FILER = {"SC TO-T", "S-4", "F-4", "425"}


def precedence(source_name: str, method: str) -> int:
    name = (source_name or "").lower()
    sec = "sec" in name
    news = any(token in name for token in ("news", "newswire", "yahoo", "globe", "google", "business"))
    if method == "manual":
        return 100
    if method == "structured" and sec:
        return 50
    if method == "regex" and sec:
        return 40
    if method == "llm_verified" and sec:
        return 30
    if method == "regex" and news:
        return 20
    if method == "llm_verified" and news:
        return 10
    if method == "structured":
        return 25
    if method == "regex":
        return 15
    if method == "llm_verified":
        return 8
    if method == "computed":
        return 5
    return 1


def _root(form: str) -> str:
    return (form or "").upper().split("/")[0]


def _source_label(record: SourceRecord) -> str:
    form = record.form or record.source
    if record.source.startswith("sec"):
        return f"SEC {form}".strip()
    if record.source == "ftc_et":
        return "FTC ET API"
    if record.source == "nasdaq_eca":
        return "Nasdaq corporate actions"
    if record.source == "prn":
        return "PR Newswire RSS"
    if record.source == "gnw":
        return "GlobeNewswire RSS"
    if record.source == "yahoo_rss":
        return "Yahoo Finance RSS"
    if record.source == "google_news":
        return "Google News RSS"
    if record.source == "businesswire":
        return "Business Wire RSS"
    if record.source == "fmp":
        return "FMP"
    return record.source


def _blank() -> dict:
    return {
        "target_cik": "",
        "target_ticker": "",
        "target_name": "",
        "acquirer_cik": "",
        "acquirer_ticker": "",
        "acquirer_name": "",
    }


def _fill_ticker(side: dict, ticker_map: TickerMap, which: str) -> None:
    name_key = f"{which}_name"
    ticker_key = f"{which}_ticker"
    cik_key = f"{which}_cik"
    if side[ticker_key]:
        known = ticker_map.get_ticker(side[ticker_key])
        if known:
            side[cik_key] = side[cik_key] or known["cik"]
            side[name_key] = side[name_key] or known["title"]
        return
    if side[name_key]:
        known = ticker_map.resolve_name(side[name_key])
        if known:
            side[ticker_key] = known["ticker"]
            side[cik_key] = side[cik_key] or known["cik"]
            side[name_key] = side[name_key] or known["title"]


def parties_for(record: SourceRecord, ticker_map: TickerMap) -> dict:
    side = _blank()
    filer = parse_display_name(record.display_names[0]) if record.display_names else {
        "title": "", "ticker": "", "cik": pad_cik(record.cik),
    }
    if not filer.get("cik"):
        filer["cik"] = pad_cik(record.cik)
    text = " ".join(part for part in (record.text, record.raw_excerpt, record.title) if part)
    named = parties_from_text(text)
    root = _root(record.form)
    if named.get("target_name") or named.get("acquirer_name"):
        side["target_name"] = named.get("target_name") or ""
        side["acquirer_name"] = named.get("acquirer_name") or ""
    if root in _TARGET_FILER or (root == "8-K" and not side["target_name"]):
        side["target_name"] = side["target_name"] or filer.get("title") or ""
        side["target_ticker"] = filer.get("ticker") or ""
        side["target_cik"] = filer.get("cik") or ""
    elif root in _ACQUIRER_FILER:
        side["acquirer_name"] = side["acquirer_name"] or filer.get("title") or ""
        side["acquirer_ticker"] = filer.get("ticker") or ""
        side["acquirer_cik"] = filer.get("cik") or ""
    elif filer.get("ticker") or filer.get("title"):
        if not side["target_ticker"] and not side["target_name"]:
            side["target_name"] = filer.get("title") or side["target_name"]
            side["target_ticker"] = filer.get("ticker") or ""
            side["target_cik"] = filer.get("cik") or side["target_cik"]
    hinted = list(record.tickers) + tickers_in_text(text)
    if hinted and not side["target_ticker"]:
        side["target_ticker"] = hinted[0]
    _fill_ticker(side, ticker_map, "target")
    _fill_ticker(side, ticker_map, "acquirer")
    if not side["target_cik"]:
        side["target_cik"] = pad_cik(record.cik) if root in _TARGET_FILER or root == "8-K" else ""
    return side


def _same_deal(left: dict, right: dict) -> bool:
    return should_merge(left, right)


def as_field_value(row) -> FieldValue:
    if isinstance(row, FieldValue):
        if not row.rank:
            row.rank = precedence(row.source_name, row.method)
        return row
    data = dict(row or {})
    field = FieldValue(
        field_name=data.get("field_name") or "",
        value=data.get("value"),
        raw=data.get("raw") or "",
        source_name=data.get("source_name") or "",
        source_url=data.get("source_url") or "",
        pulled_at=data.get("pulled_at") or "",
        method=data.get("method") or "",
        evidence=data.get("evidence") or "",
        is_current=bool(data.get("is_current", True)),
        conflict=bool(data.get("conflict")),
        rank=int(data.get("rank") or 0),
    )
    if not field.rank:
        field.rank = precedence(field.source_name, field.method)
    return field


def merge_field_lists(stored, incoming) -> list[FieldValue]:
    bucket = {"fields": [as_field_value(row) for row in stored or []]}
    _apply_fields(bucket, [as_field_value(row) for row in incoming or []])
    return bucket["fields"]


def _union_sources(stored: list, incoming: list) -> list:
    out = []
    seen = set()
    for row in list(stored or []) + list(incoming or []):
        if not isinstance(row, dict):
            continue
        token = row.get("external_id") or row.get("url") or row.get("name") or ""
        if token in seen:
            continue
        seen.add(token)
        out.append(dict(row))
    return out


def merge_candidate(stored: dict, incoming: dict) -> dict:
    """Union fields and sources, then recompute precedence. Never drop stored values."""
    out = dict(stored)
    incoming = dict(incoming or {})
    merged_fields = merge_field_lists(stored.get("fields") or [], incoming.get("fields") or [])
    out["fields"] = [row.to_dict() for row in merged_fields]
    out["sources"] = _union_sources(stored.get("sources") or [], incoming.get("sources") or [])
    fill = (
        "target_cik", "target_ticker", "target_name",
        "acquirer_cik", "acquirer_ticker", "acquirer_name",
        "announce_date", "expected_close", "vote_date", "hsr", "form", "filer_role",
    )
    for key in fill:
        if incoming.get(key) and not out.get(key):
            out[key] = incoming[key]
    if incoming.get("acquirer_cik") and not out.get("acquirer_cik"):
        out["acquirer_cik"] = incoming["acquirer_cik"]
    if incoming.get("acquirer_name") and not out.get("acquirer_name"):
        out["acquirer_name"] = incoming["acquirer_name"]
    sec = bool(stored.get("sec_evidence") or incoming.get("sec_evidence"))
    if not sec:
        sec = any(str((src.get("source") or src.get("name") or "")).lower().startswith("sec") for src in out["sources"])
    out["sec_evidence"] = sec
    news_names = set()
    for src in out["sources"]:
        token = str(src.get("source") or src.get("name") or "").lower()
        if any(part in token for part in ("prn", "gnw", "news", "yahoo", "globe", "newswire")):
            news_names.add(token)
    out["news_sources"] = len(news_names)
    out["deal_key"] = deal_key(
        out.get("target_cik") or "",
        out.get("target_ticker") or "",
        out.get("acquirer_name") or "",
    )
    out["id"] = stored.get("id") or incoming.get("id")
    out["first_seen_at"] = stored.get("first_seen_at") or incoming.get("first_seen_at")
    out["ignored"] = bool(stored.get("ignored") or incoming.get("ignored"))
    out["desk_deal_id"] = stored.get("desk_deal_id") or incoming.get("desk_deal_id") or ""
    out["on_desk"] = bool(stored.get("on_desk") or incoming.get("on_desk"))
    if stored.get("overrides") or incoming.get("overrides"):
        merged_over = dict(stored.get("overrides") or {})
        merged_over.update(incoming.get("overrides") or {})
        out["overrides"] = merged_over
    if stored.get("score_json") and (stored.get("score_json") or {}).get("overrides"):
        out["overrides"] = dict((stored.get("score_json") or {}).get("overrides") or {})
        out["overrides"].update(incoming.get("overrides") or {})
    out["hidden"] = bool(stored.get("hidden") and incoming.get("hidden", stored.get("hidden")))
    for key in (
        "last_seen_at", "current_price", "offer_value", "gross_spread", "gross_spread_pct",
        "annualized_pct", "confidence", "confidence_breakdown", "consideration_type",
        "offer_terms", "needs_manual_terms", "status", "acquirer_price", "spread_with_cvr_max",
        "annualized_assumption",
    ):
        if incoming.get(key) not in (None, ""):
            out[key] = incoming[key]
    if out.get("sec_evidence"):
        out["news_only"] = False
        if incoming.get("news_only") and stored.get("status"):
            out["status"] = stored.get("status") or incoming.get("status")
    else:
        out["news_only"] = bool(incoming.get("news_only", stored.get("news_only")))
    return out


def _apply_fields(bucket: dict, incoming: list[FieldValue]) -> None:
    current = bucket["fields"]
    for row in incoming:
        row.rank = precedence(row.source_name, row.method)
        same = [old for old in current if old.field_name == row.field_name]
        if not same:
            current.append(row)
            continue
        best = max(same, key=lambda item: item.rank)
        if row.rank > best.rank:
            for old in same:
                old.is_current = False
            row.is_current = True
            current.append(row)
        elif row.rank == best.rank and str(row.value) != str(best.value):
            row.conflict = True
            best.conflict = True
            row.is_current = True
            current.append(row)
        elif str(row.value) != str(best.value):
            row.is_current = False
            row.conflict = True
            best.conflict = True
            current.append(row)
        else:
            row.is_current = False
            current.append(row)


def _status_for(events: list[str], news_only: bool) -> str:
    if "TERMINATED" in events:
        return "TERMINATED"
    if "COMPLETED" in events:
        return "COMPLETED"
    if news_only:
        return "ANNOUNCED (news only)"
    if "AMENDED" in events:
        return "AMENDED"
    return "PENDING"


def _creates_candidate(record: SourceRecord) -> bool:
    if record.source in {"ftc_et", "nasdaq_eca"}:
        return False
    if not record.event_type:
        return False
    if record.event_type in {"HSR_ET"}:
        return False
    return record.event_type in {
        "NEW_DEAL", "PENDING_UPDATE", "VOTE_SCHEDULED", "AMENDED", "COMPLETED", "TERMINATED",
    }


def merge_records(records: list[SourceRecord], ticker_map: TickerMap, *, pulled_at: str) -> list[dict]:
    buckets: list[dict] = []
    for record in records:
        if not _creates_candidate(record):
            continue
        side = parties_for(record, ticker_map)
        newsish = record.source in {"prn", "gnw", "yahoo_rss", "google_news", "businesswire"}
        if newsish and not side["target_ticker"] and not side["target_cik"]:
            buckets.append({
                **side,
                "deal_key": f"unresolved|{record.external_id}",
                "hidden": True,
                "news_only": True,
                "ignored": False,
                "status": "unresolved",
                "sources": [],
                "fields": [],
                "records": [record],
                "events": [],
            })
            continue
        root = _root(record.form)
        if root in _ACQUIRER_FILER:
            side["filer_role"] = "acquirer"
            side["form"] = record.form
        elif record.form:
            side["form"] = record.form
        side["source"] = record.source
        side["sec_evidence"] = bool(record.source.startswith("sec"))
        side["news_sources"] = 1 if newsish else 0
        key = deal_key(side["target_cik"], side["target_ticker"], side["acquirer_name"])
        side["deal_key"] = key
        visible = [row for row in buckets if not row.get("hidden")]
        bucket = find_match(side, visible)
        if bucket is None:
            bucket = next((row for row in buckets if row.get("deal_key") == key or _same_deal(row, side)), None)
        if bucket is None:
            bucket = {
                **side,
                "deal_key": key,
                "hidden": False,
                "news_only": True,
                "ignored": False,
                "status": "PENDING",
                "sources": [],
                "fields": [],
                "records": [],
                "events": [],
            }
            buckets.append(bucket)
        else:
            skip_fill = {"news_sources", "sec_evidence", "fields", "sources", "records", "events"}
            for field_name in side:
                if field_name in skip_fill:
                    continue
                if side[field_name] and not bucket.get(field_name):
                    bucket[field_name] = side[field_name]
            if side.get("sec_evidence"):
                bucket["sec_evidence"] = True
            bucket["news_sources"] = int(bucket.get("news_sources") or 0) + int(side.get("news_sources") or 0)
            bucket["deal_key"] = deal_key(
                bucket.get("target_cik") or "",
                bucket.get("target_ticker") or "",
                bucket.get("acquirer_name") or "",
            )
        if not newsish and record.source.startswith("sec"):
            bucket["news_only"] = False
        bucket["records"].append(record)
        if record.event_type:
            bucket["events"].append(record.event_type)
        label = _source_label(record)
        text = record.text or record.raw_excerpt or ""
        if text:
            _apply_fields(bucket, extract_terms(
                text,
                source_name=label,
                source_url=record.url,
                pulled_at=record.pulled_at or pulled_at,
                file_date=record.published_at,
            ))
        elif record.published_at and not any(row.field_name == "announce_date" for row in bucket["fields"]):
            _apply_fields(bucket, [FieldValue(
                field_name="announce_date",
                value=record.published_at[:10],
                raw=record.published_at[:10],
                source_name=label,
                source_url=record.url,
                pulled_at=record.pulled_at or pulled_at,
                method="structured",
                evidence="efts file_date",
            )])
        bucket["sources"].append({
            "name": label,
            "url": record.url,
            "form": record.form,
            "items": list(record.items),
            "event_type": record.event_type,
            "external_id": record.external_id,
            "source": record.source,
        })
    for bucket in buckets:
        if bucket.get("hidden"):
            continue
        bucket["status"] = _status_for(bucket["events"], bool(bucket["news_only"]))
        bucket["announce_date"] = _current(bucket, "announce_date")
        bucket["expected_close"] = _current(bucket, "expected_close")
        bucket["vote_date"] = _current(bucket, "vote_date")
    _attach_signals(buckets, records, ticker_map)
    return buckets


def _current(bucket: dict, name: str) -> str:
    rows = [row for row in bucket["fields"] if row.field_name == name and row.is_current]
    if not rows:
        return ""
    return str(rows[-1].value or "")


def _attach_signals(buckets: list[dict], records: list[SourceRecord], ticker_map: TickerMap) -> None:
    visible = [row for row in buckets if not row.get("hidden")]
    for record in records:
        if record.source == "ftc_et":
            target = (record.extra or {}).get("acquired_party") or ""
            acquirer = (record.extra or {}).get("acquiring_party") or ""
            for bucket in visible:
                if names_match(target, bucket.get("target_name") or "") and (
                    not acquirer or not bucket.get("acquirer_name") or names_match(acquirer, bucket["acquirer_name"])
                ):
                    bucket["hsr"] = "early_termination_granted"
                    bucket["sources"].append({
                        "name": "FTC ET API",
                        "url": record.url,
                        "form": "",
                        "items": [],
                        "event_type": "HSR_ET",
                        "external_id": record.external_id,
                        "source": "ftc_et",
                    })
                    bucket["records"].append(record)
        if record.source == "nasdaq_eca":
            tickers = [item.upper() for item in record.tickers]
            for bucket in visible:
                if bucket.get("target_ticker") and bucket["target_ticker"].upper() in tickers:
                    bucket["sources"].append({
                        "name": "Nasdaq corporate actions",
                        "url": record.url,
                        "form": "",
                        "items": [],
                        "event_type": record.event_type,
                        "external_id": record.external_id,
                        "source": "nasdaq_eca",
                    })
                    bucket["records"].append(record)
                    if record.event_type == "COMPLETED" and "merger closed" in (record.title or "").lower():
                        bucket["events"].append("COMPLETED")
                        if bucket["status"] not in {"TERMINATED"}:
                            bucket["status"] = "COMPLETED"
    for bucket in visible:
        if bucket.get("news_only") and any(
            (src.get("source") or "").startswith("sec") for src in bucket["sources"]
        ):
            bucket["news_only"] = False
            if bucket["status"] == "ANNOUNCED (news only)":
                bucket["status"] = _status_for(bucket["events"], False)
