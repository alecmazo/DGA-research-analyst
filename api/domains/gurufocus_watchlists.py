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


def _hidden_pair_set(hidden_tickers) -> set:
    out = set()
    for item in hidden_tickers or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            out.add((str(item[0]), str(item[1]).upper()))
        elif isinstance(item, dict):
            out.add((str(item.get("list_id") or ""), str(item.get("ticker") or "").upper()))
    return {(a, b) for a, b in out if a and b}


def _apply_edits(row: dict, list_id: str, edits: dict) -> dict:
    ed = (edits or {}).get((str(list_id), (row.get("symbol") or "").upper()))
    if not ed:
        return row
    out = dict(row)
    if "note" in ed and ed["note"] is not None:
        out["note"] = ed["note"]
    if "fair_value" in ed:
        out["fair_value"] = ed["fair_value"]
    return out


def _stamp(stocks: list, list_id: str, list_name_: str | None,
           hidden_tk: set, edits: dict) -> list:
    out = []
    seen = set()
    lid = str(list_id)
    for s in stocks or []:
        sym = (s.get("symbol") or "").upper()
        if not sym or sym in seen or (lid, sym) in hidden_tk:
            continue
        seen.add(sym)
        row = {**s, "symbol": sym, "list_id": lid, "list_name": list_name_ or s.get("list_name")}
        out.append(_apply_edits(row, lid, edits))
    return out


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


def snapshot_lists() -> list:
    return list(_payload().get("lists") or [])


def list_summaries(desk: dict | None = None) -> dict:
    """desk: extra_by_list, hidden_list_ids, hidden_tickers, edits, local_lists."""
    desk = desk or {}
    hidden_ids = {str(x) for x in (desk.get("hidden_list_ids") or [])}
    hidden_tk = _hidden_pair_set(desk.get("hidden_tickers"))
    extras = desk.get("extra_by_list") or {}
    edits = desk.get("edits") or {}
    local_lists = desk.get("local_lists") or []
    p = _payload()
    lists = []
    for x in p.get("lists") or []:
        lid = str(x.get("id"))
        if lid in hidden_ids:
            continue
        stocks = _stamp(
            _merge_stocks(list(x.get("stocks") or []), extras.get(lid) or []),
            lid, x.get("name"), hidden_tk, edits,
        )
        lists.append({
            "id": lid,
            "name": x.get("name"),
            "created_on": x.get("created_on"),
            "stock_count": len(stocks),
            "is_overview": False,
            "is_local": False,
        })
    for loc in local_lists:
        lid = str(loc.get("id") or "")
        if not lid or lid in hidden_ids:
            continue
        stocks = _stamp(extras.get(lid) or [], lid, loc.get("name"), hidden_tk, edits)
        lists.append({
            "id": lid,
            "name": loc.get("name"),
            "created_on": loc.get("created_on"),
            "stock_count": len(stocks),
            "is_overview": False,
            "is_local": True,
        })
    lists.sort(key=lambda x: ((x.get("created_on") or "9999"), (x.get("name") or "").lower()))
    n_stocks = sum(int(x.get("stock_count") or 0) for x in lists)
    summaries = [{
        "id": "overview",
        "name": "Overview",
        "created_on": None,
        "stock_count": n_stocks,
        "is_overview": True,
        "is_local": False,
    }] + lists
    return {
        "ok": True,
        "synced_at": p.get("synced_at"),
        "source": p.get("source") or "gurufocus.com",
        "list_count": len(lists),
        "stock_count": n_stocks,
        "lists": summaries,
    }


def get_list(list_id: str, desk: dict | None = None) -> dict:
    desk = desk or {}
    hidden_ids = {str(x) for x in (desk.get("hidden_list_ids") or [])}
    hidden_tk = _hidden_pair_set(desk.get("hidden_tickers"))
    extras = desk.get("extra_by_list") or {}
    edits = desk.get("edits") or {}
    local_lists = {str(x.get("id")): x for x in (desk.get("local_lists") or [])}
    p = _payload()
    lid = (list_id or "").strip()
    snap = {str(x.get("id")): x for x in (p.get("lists") or [])}

    def _one(src: dict, extra: list, is_local: bool) -> dict:
        oid = str(src.get("id"))
        stocks = _stamp(
            _merge_stocks(list(src.get("stocks") or []), extra),
            oid, src.get("name"), hidden_tk, edits,
        )
        stocks.sort(key=lambda r: ((r.get("date_first_added") or "9999"), (r.get("symbol") or "")))
        return {
            "id": oid,
            "name": src.get("name"),
            "created_on": src.get("created_on"),
            "stock_count": len(stocks),
            "is_overview": False,
            "is_local": is_local,
            "stocks": stocks,
        }

    if lid in ("", "overview", "all"):
        rows = []
        for x in p.get("lists") or []:
            sid = str(x.get("id"))
            if sid in hidden_ids:
                continue
            rows.extend(_stamp(
                _merge_stocks(list(x.get("stocks") or []), extras.get(sid) or []),
                sid, x.get("name"), hidden_tk, edits,
            ))
        for loc in (desk.get("local_lists") or []):
            sid = str(loc.get("id") or "")
            if not sid or sid in hidden_ids:
                continue
            rows.extend(_stamp(extras.get(sid) or [], sid, loc.get("name"), hidden_tk, edits))
        rows.sort(key=lambda r: (
            (r.get("list_name") or ""),
            (r.get("date_first_added") or "9999"),
            (r.get("symbol") or ""),
        ))
        return {
            "ok": True,
            "synced_at": p.get("synced_at"),
            "list": {
                "id": "overview",
                "name": "Overview",
                "created_on": None,
                "stock_count": len(rows),
                "is_overview": True,
                "is_local": False,
                "stocks": rows,
            },
        }

    if lid in hidden_ids:
        return {"ok": False, "error": "list not found"}
    if lid in snap:
        return {
            "ok": True,
            "synced_at": p.get("synced_at"),
            "list": _one(snap[lid], extras.get(lid) or [], False),
        }
    if lid in local_lists:
        loc = local_lists[lid]
        shell = {"id": lid, "name": loc.get("name"), "created_on": loc.get("created_on"), "stocks": []}
        return {
            "ok": True,
            "synced_at": p.get("synced_at"),
            "list": _one(shell, extras.get(lid) or [], True),
        }
    return {"ok": False, "error": "list not found"}


def list_name(list_id: str, local_lists: list | None = None) -> str | None:
    lid = str(list_id or "").strip()
    for x in (_payload().get("lists") or []):
        if str(x.get("id")) == lid:
            return x.get("name")
    for x in local_lists or []:
        if str(x.get("id")) == lid:
            return x.get("name")
    return None


def snapshot_symbols(list_id: str) -> set[str]:
    lid = str(list_id or "").strip()
    for x in (_payload().get("lists") or []):
        if str(x.get("id")) == lid:
            return {(s.get("symbol") or "").upper() for s in (x.get("stocks") or []) if s.get("symbol")}
    return set()


def is_snapshot_list(list_id: str) -> bool:
    lid = str(list_id or "").strip()
    return any(str(x.get("id")) == lid for x in (_payload().get("lists") or []))


def stock_row(symbol: str, list_name_: str | None, quote: dict | None,
              today: str | None = None, list_id: str | None = None) -> dict:
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
        "list_id": list_id,
        "list_name": list_name_,
        "local": True,
    }
