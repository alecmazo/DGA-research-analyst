"""Status alerts for deals already on the desk. Nothing here edits a packet."""

from __future__ import annotations

from merger_arb.scanner.extract import extract_terms
from merger_arb.scanner.models import SourceRecord
from merger_arb.scanner.resolve import names_match, pad_cik


def _items(record: SourceRecord) -> set[str]:
    out = set()
    for item in record.items or []:
        for part in str(item).split(","):
            if part.strip():
                out.add(part.strip())
    return out


def _matches(record: SourceRecord, deal: dict) -> bool:
    target = pad_cik(deal.get("target_cik") or "")
    acquirer = pad_cik(deal.get("acquirer_cik") or "")
    if record.cik and (record.cik == target or (acquirer and record.cik == acquirer)):
        if record.form == "25-NSE" and record.cik != target:
            return False
        return True
    tickers = {item.upper() for item in (record.tickers or [])}
    wanted = {str(deal.get("target_ticker") or "").upper(), str(deal.get("acquirer_ticker") or "").upper()}
    wanted.discard("")
    if tickers & wanted:
        return True
    if record.source == "ftc_et":
        acquired = (record.extra or {}).get("acquired_party") or ""
        return names_match(acquired, deal.get("target_name") or "")
    return False


def _cash_from(record: SourceRecord) -> str:
    text = record.text or record.raw_excerpt or ""
    if not text:
        return ""
    rows = extract_terms(text, source_name=record.source, source_url=record.url, pulled_at=record.pulled_at)
    cash = [row for row in rows if row.field_name == "cash_per_share"]
    if not cash:
        return ""
    return str(cash[-1].value)


def _vote_from(record: SourceRecord) -> str:
    text = record.text or record.raw_excerpt or ""
    if not text:
        return ""
    rows = extract_terms(text, source_name=record.source, source_url=record.url, pulled_at=record.pulled_at)
    votes = [row for row in rows if row.field_name == "vote_date"]
    return str(votes[-1].value) if votes else ""


def detect_alerts(deal: dict, records: list[SourceRecord], *, stored_cash: str = "", stored_vote: str = "") -> list[dict]:
    """One alert per type. 25-NSE alone does not confirm a close."""
    matched = [row for row in records if _matches(row, deal)]
    if not matched:
        return []
    alerts = []

    def add(kind: str, certainty: str, record: SourceRecord, details: dict) -> None:
        alerts.append({
            "desk_deal_id": deal.get("id") or "",
            "alert_type": kind,
            "certainty": certainty,
            "source_url": record.url,
            "source_name": record.source,
            "pulled_at": record.pulled_at,
            "evidence": (record.raw_excerpt or record.title or record.text or "")[:300],
            "details": details,
        })

    closes_8k = [
        row for row in matched
        if (row.form or "").upper().startswith("8-K") and "2.01" in _items(row)
    ]
    nasdaq_close = [
        row for row in matched
        if row.source == "nasdaq_eca" and "merger closed" in (row.title or "").lower()
    ]
    bare_25 = [
        row for row in matched
        if (row.form or "").upper().startswith("25-NSE")
    ]
    news_close = [
        row for row in matched
        if row.event_type == "COMPLETED" and row.source not in {"sec_efts", "sec_index", "sec_submissions", "nasdaq_eca"}
        and not (row.form or "").upper().startswith("8-K")
    ]
    if closes_8k:
        add("COMPLETED", "confirmed", closes_8k[0], {
            "form": closes_8k[0].form,
            "items": closes_8k[0].items,
            "corroborated_by_25nse": bool(bare_25),
        })
    elif nasdaq_close:
        add("COMPLETED", "confirmed", nasdaq_close[0], {"title": nasdaq_close[0].title, "corroborated_by_25nse": bool(bare_25)})
    elif news_close:
        add("COMPLETED", "reported", news_close[0], {"title": news_close[0].title})

    terminated = [
        row for row in matched
        if row.event_type == "TERMINATED" and (row.form or "").upper().startswith("8-K")
    ]
    news_dead = [
        row for row in matched
        if row.event_type == "TERMINATED" and not (row.form or "").upper().startswith("8-K")
    ]
    if terminated:
        add("TERMINATED", "confirmed", terminated[0], {"form": terminated[0].form, "items": terminated[0].items})
    elif news_dead:
        add("TERMINATED", "reported", news_dead[0], {"title": news_dead[0].title})

    amended = [row for row in matched if row.event_type == "AMENDED"]
    if amended:
        new_cash = _cash_from(amended[0])
        details = {"form": amended[0].form, "title": amended[0].title}
        if stored_cash and new_cash and stored_cash != new_cash:
            details["diff"] = {"cash_per_share": {"before": stored_cash, "after": new_cash}}
        elif new_cash:
            details["cash_per_share"] = new_cash
        add("AMENDED", "confirmed" if (amended[0].form or "").upper().startswith("8-K") else "reported", amended[0], details)

    votes = [row for row in matched if row.event_type == "VOTE_SCHEDULED" or (row.form or "").upper().startswith("DEFM14")]
    for row in votes:
        vote = _vote_from(row)
        if vote and vote != (stored_vote or ""):
            add("VOTE_DATE", "confirmed", row, {"vote_date": vote, "before": stored_vote or ""})
            break

    results = [row for row in matched if row.event_type == "VOTE_RESULT" or "5.07" in _items(row)]
    if results:
        add("VOTE_RESULT", "confirmed", results[0], {"form": results[0].form, "items": results[0].items})

    hsr = [row for row in matched if row.event_type == "HSR_ET" or row.source == "ftc_et"]
    if hsr:
        add("HSR_ET", "confirmed", hsr[0], {"transaction": hsr[0].external_id, "title": hsr[0].title})
    return alerts
