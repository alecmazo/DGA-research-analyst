"""GuruFocus My Portfolios snapshot served on Builder → Gurufocus."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).resolve().parent.parent / "data" / "gurufocus_watchlists.json"


@lru_cache(maxsize=1)
def _payload() -> dict:
    if not _DATA.exists():
        return {"synced_at": None, "source": "gurufocus.com", "lists": []}
    return json.loads(_DATA.read_text())


def list_summaries() -> dict:
    p = _payload()
    lists = p.get("lists") or []
    n_stocks = sum(int(x.get("stock_count") or 0) for x in lists)
    summaries = [
        {
            "id": "overview",
            "name": "Overview",
            "created_on": None,
            "stock_count": n_stocks,
            "is_overview": True,
        }
    ]
    rest = sorted(
        lists,
        key=lambda x: ((x.get("created_on") or "9999"), (x.get("name") or "").lower()),
    )
    for x in rest:
        summaries.append(
            {
                "id": str(x.get("id")),
                "name": x.get("name"),
                "created_on": x.get("created_on"),
                "stock_count": int(x.get("stock_count") or 0),
                "is_overview": False,
            }
        )
    return {
        "ok": True,
        "synced_at": p.get("synced_at"),
        "source": p.get("source") or "gurufocus.com",
        "list_count": len(lists),
        "stock_count": n_stocks,
        "lists": summaries,
    }


def get_list(list_id: str) -> dict:
    p = _payload()
    lists = p.get("lists") or []
    lid = (list_id or "").strip()
    if lid in ("", "overview", "all"):
        rows = []
        for x in lists:
            rows.extend(x.get("stocks") or [])
        rows.sort(
            key=lambda r: (
                (r.get("list_name") or ""),
                (r.get("date_first_added") or "9999"),
                (r.get("symbol") or ""),
            )
        )
        return {
            "ok": True,
            "synced_at": p.get("synced_at"),
            "list": {
                "id": "overview",
                "name": "Overview",
                "created_on": None,
                "stock_count": len(rows),
                "is_overview": True,
                "stocks": rows,
            },
        }
    for x in lists:
        if str(x.get("id")) == lid:
            return {
                "ok": True,
                "synced_at": p.get("synced_at"),
                "list": {**x, "is_overview": False},
            }
    return {"ok": False, "error": "list not found"}
