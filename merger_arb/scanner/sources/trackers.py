"""Tracker slot. No adapter is enabled."""

from __future__ import annotations

from typing import Protocol

from merger_arb.scanner.models import FetchResult


class TrackerSource(Protocol):
    name: str

    def enabled(self) -> bool:
        ...

    def fetch(self, cursor: dict, ctx) -> FetchResult:
        ...


def enabled_adapters(config) -> list:
    """Global toggle stays off. Shipping zero adapters is intentional."""
    if not getattr(config, "enable_trackers", False):
        return []
    return []
