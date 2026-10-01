"""Scanner records. A field stays a FieldValue until it is written onto a desk packet."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | str | None) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


@dataclass
class FieldValue:
    field_name: str
    value: Any
    raw: str
    source_name: str
    source_url: str
    pulled_at: str
    method: str
    evidence: str | None = None
    is_current: bool = True
    conflict: bool = False
    rank: int = 0

    def to_dict(self) -> dict:
        return {
            "field_name": self.field_name,
            "value": jsonable(self.value),
            "raw": self.raw or "",
            "source_name": self.source_name or "",
            "source_url": self.source_url or "",
            "pulled_at": self.pulled_at or "",
            "method": self.method or "",
            "evidence": (self.evidence or "")[:300],
            "is_current": bool(self.is_current),
            "conflict": bool(self.conflict),
            "rank": int(self.rank or 0),
        }


@dataclass
class SourceRecord:
    source: str
    external_id: str
    url: str = ""
    form: str = ""
    cik: str = ""
    title: str = ""
    published_at: str = ""
    pulled_at: str = ""
    raw_excerpt: str = ""
    event_type: str = ""
    items: list[str] = field(default_factory=list)
    tickers: list[str] = field(default_factory=list)
    display_names: list[str] = field(default_factory=list)
    text: str = ""
    needs_corroboration: bool = False
    query_has_merger: bool = False
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "external_id": self.external_id,
            "url": self.url,
            "form": self.form,
            "cik": self.cik,
            "title": self.title,
            "published_at": self.published_at,
            "pulled_at": self.pulled_at,
            "raw_excerpt": (self.raw_excerpt or "")[:2000],
            "event_type": self.event_type,
            "items": list(self.items),
            "tickers": list(self.tickers),
            "display_names": list(self.display_names),
            "text": self.text or "",
            "needs_corroboration": bool(self.needs_corroboration),
            "query_has_merger": bool(self.query_has_merger),
            "extra": jsonable(self.extra or {}),
        }


@dataclass
class FetchResult:
    records: list[SourceRecord] = field(default_factory=list)
    cursor: dict = field(default_factory=dict)
    error: str = ""
    detail: str = ""
    ticker_map: dict | None = None
