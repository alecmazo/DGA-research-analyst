"""GuruFocus My Portfolios snapshot served on Builder → Gurufocus."""

from __future__ import annotations

import json
import re
from datetime import date
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).resolve().parent.parent / "data" / "gurufocus_watchlists.json"


@lru_cache(maxsize=1)
def _payload() -> dict:
    if not _DATA.exists():
        return {"synced_at": None, "source": "gurufocus.com", "lists": []}
    return json.loads(_DATA.read_text())


def parse_tickers(raw) -> list[str]:
    """Split 'NVDA, AMD RKLB' into unique uppercase tickers."""
    if isinstance(raw, (list, tuple)):
        text = " ".join(str(x) for x in raw)
    else:
        text = str(raw or "")
    out, seen = [], set()
    for tok in re.split(r"[\s,;]+", text.upper()):
        tk = re.sub(r"[^A-Z0-9.\-]", "", tok)
        if not tk or tk in seen or len(tk) > 12:
            continue
        seen.add(tk)
        out.append(tk)
    return out


def list_summaries(extra_counts: dict | None = None) -> dict:
    extra_counts = extra_counts or {}
    p = _payload()
    lists = p.get("lists") or []
    extra_total = sum(int(v or 0) for v in extra_counts.values())
    n_stocks = sum(int(x.get("stock_count") or 0) for x in lists) + extra_total
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
        lid = str(x.get("id"))
        summaries.append(
            {
                "id": lid,
                "name": x.get("name"),
                "created_on": x.get("created_on"),
                "stock_count": int(x.get("stock_count") or 0) + int(extra_counts.get(lid) or 0),
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


def _merge_stocks(base: list, extra: list) -> list:
    seen = {(r.get("symbol") or "").upper() for r in base if r.get("symbol")}
    out = list(base)
    for r in extra or []:
        sym = (r.get("symbol") or "").upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(r)
    return out


def get_list(list_id: str, extra_stocks: list | None = None,
             extra_by_list: dict | None = None) -> dict:
    p = _payload()
    lists = p.get("lists") or []
    lid = (list_id or "").strip()
    extra_stocks = extra_stocks or []
    if lid in ("", "overview", "all"):
        rows = []
        for x in lists:
            rows.extend(x.get("stocks") or [])
        if extra_by_list:
            for more in extra_by_list.values():
                rows.extend(more or [])
        else:
            rows.extend(extra_stocks)
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
            stocks = _merge_stocks(list(x.get("stocks") or []), extra_stocks)
            stocks.sort(
                key=lambda r: (
                    (r.get("date_first_added") or "9999"),
                    (r.get("symbol") or ""),
                )
            )
            return {
                "ok": True,
                "synced_at": p.get("synced_at"),
                "list": {
                    **x,
                    "is_overview": False,
                    "stocks": stocks,
                    "stock_count": len(stocks),
                },
            }
    return {"ok": False, "error": "list not found"}


def list_name(list_id: str) -> str | None:
    lid = str(list_id or "").strip()
    for x in (_payload().get("lists") or []):
        if str(x.get("id")) == lid:
            return x.get("name")
    return None


def snapshot_symbols(list_id: str) -> set[str]:
    lid = str(list_id or "").strip()
    for x in (_payload().get("lists") or []):
        if str(x.get("id")) == lid:
            return {(s.get("symbol") or "").upper() for s in (x.get("stocks") or []) if s.get("symbol")}
    return set()


def stock_row(symbol: str, list_name_: str | None, quote: dict | None,
              today: str | None = None) -> dict:
    q = quote or {}
    px = q.get("price")
    try:
        px = float(px) if px is not None else None
    except (TypeError, ValueError):
        px = None
    pct = q.get("pct_change")
    try:
        pct = float(pct) if pct is not None else None
    except (TypeError, ValueError):
        pct = None
    day = today or date.today().isoformat()
    return {
        "symbol": symbol,
        "company": (q.get("name") or q.get("company") or "")[:120],
        "price": px,
        "day_pct": pct,
        "date_first_added": day,
        "cost_per_share": px,
        "pct_since_first": 0.0 if px is not None else None,
        "rel_spy": None,
        "div_earned": None,
        "ann_gain": None,
        "fair_value": None,
        "note": None,
        "list_name": list_name_,
        "local": True,
    }
