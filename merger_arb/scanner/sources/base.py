"""Source protocol. fetch receives a context and does not choose the HTTP stack itself."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from merger_arb.scanner.models import FetchResult


@dataclass
class FetchContext:
    get: callable
    now: datetime
    since: date
    today: date
    full: bool
    desk_deals: list = field(default_factory=list)
    ticker_map: dict = field(default_factory=dict)
    extra_urls: list = field(default_factory=list)

    def read(self, url: str) -> bytes | None:
        try:
            body = self.get(url)
        except Exception:
            raise
        return body
