"""Annual/quarter financial series helpers (pure query + de-dupe).

Extracted from api/server.py so chart/dashboard code stays testable without
loading the full FastAPI app.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

# Late-bound DB access from server
_fund_conn_fn: Callable | None = None
_RealDictCursor_cls = None

# One dashboard read is SELECT *. The sheet and DCF ask again for annual
# and quarter while that request is still the only worker. Keep the slices
# for a few seconds so those follow-up reads are free. Refresh waits 25s.
_FIN_ROWS_CACHE: dict[tuple[str, str], tuple[float, list]] = {}
_FIN_ROWS_TTL_S = 20
_FIN_ROWS_CACHE_MAX = 48
_FIN_ROWS_LOCK = threading.Lock()


def configure(*, fund_conn, RealDictCursor) -> None:
    global _fund_conn_fn, _RealDictCursor_cls
    _fund_conn_fn = fund_conn
    _RealDictCursor_cls = RealDictCursor


def _fin_rows_cache_get(ticker: str, period_type: str) -> list | None:
    key = ((ticker or "").upper(), period_type or "all")
    now = time.time()
    with _FIN_ROWS_LOCK:
        hit = _FIN_ROWS_CACHE.get(key)
        if not hit:
            return None
        ts, rows = hit
        if now - ts > _FIN_ROWS_TTL_S:
            _FIN_ROWS_CACHE.pop(key, None)
            return None
        return list(rows)


def _fin_rows_cache_put(ticker: str, period_type: str, rows: list) -> None:
    key = ((ticker or "").upper(), period_type or "all")
    now = time.time()
    with _FIN_ROWS_LOCK:
        _FIN_ROWS_CACHE[key] = (now, list(rows))
        if len(_FIN_ROWS_CACHE) <= _FIN_ROWS_CACHE_MAX:
            return
        oldest = sorted(_FIN_ROWS_CACHE.items(), key=lambda kv: kv[1][0])
        for old_key, _hit in oldest:
            if len(_FIN_ROWS_CACHE) <= _FIN_ROWS_CACHE_MAX:
                break
            if old_key == key:
                continue
            _FIN_ROWS_CACHE.pop(old_key, None)


def _fin_rows_cache_drop(ticker: str) -> None:
    """Forget one name after a store write so a refresh is not stuck 20s."""
    tk = (ticker or "").upper()
    with _FIN_ROWS_LOCK:
        for pt in ("all", "annual", "quarter"):
            _FIN_ROWS_CACHE.pop((tk, pt), None)


def _fin_rows_for_ticker(ticker: str, period_type: str = "all") -> list:
    """Time series for one ticker, newest first.

    Annual series is de-duplicated: some SEC extracts stored interim period_ends
    (Mar/Jun/Sep) as period_type=annual with empty metrics alongside the real
    year-end 10-K row — that produced double FY labels on charts (AMZN ticket).

    A full ``all`` read also stores the annual and quarter slices. The sheet
    and the DCF calculator ask for those a moment later on the same worker.
    """
    tk = (ticker or "").upper()
    pt = period_type or "all"
    cached = _fin_rows_cache_get(tk, pt)
    if cached is not None:
        return cached
    where = "WHERE ticker=%s"
    params: list[Any] = [tk]
    if pt in ("annual", "quarter"):
        where += " AND period_type=%s"
        params.append(pt)
    if _fund_conn_fn is None or _RealDictCursor_cls is None:
        raise RuntimeError("financials_series.configure() not called")
    with _fund_conn_fn() as conn, conn.cursor(cursor_factory=_RealDictCursor_cls) as cur:
        cur.execute(f"SELECT * FROM company_financials {where} "
                    f"ORDER BY period_end DESC", params)
        rows = cur.fetchall() or []
    if pt == "annual":
        rows = _fin_dedupe_annual_rows(rows)
    _fin_rows_cache_put(tk, pt, rows)
    if pt == "all":
        annual = _fin_dedupe_annual_rows(
            [r for r in rows if (r.get("period_type") or "") == "annual"]
        )
        quarter = [r for r in rows if (r.get("period_type") or "") == "quarter"]
        _fin_rows_cache_put(tk, "annual", annual)
        _fin_rows_cache_put(tk, "quarter", quarter)
    return list(rows)


def _fin_dedupe_annual_rows(rows: list) -> list:
    """One annual row per fiscal year (newest-first order preserved).

    Preference within a year key:
      1. Has revenue (real 10-K totals)
      2. Year-end-ish period_end (12-31 or month-end with most complete metrics)
      3. Later period_end
    Drop empty interim stubs that share the same FY label.
    """
    if not rows:
        return []
    from datetime import date as _date

    def _end(r):
        pe = r.get("period_end")
        if pe is None:
            return None
        if hasattr(pe, "year"):
            return pe
        try:
            return _date.fromisoformat(str(pe)[:10])
        except Exception:
            return None

    def _year_key(r):
        fy = r.get("fy")
        if fy is not None:
            try:
                return int(fy)
            except (TypeError, ValueError):
                pass
        pe = _end(r)
        return pe.year if pe else None

    def _metric_score(r) -> int:
        """How complete is this annual row (higher = better)."""
        keys = ("revenue", "net_income", "operating_income", "ebitda",
                "operating_cash_flow", "free_cash_flow", "total_assets",
                "stockholders_equity", "diluted_eps", "shares_outstanding")
        n = 0
        for k in keys:
            v = r.get(k)
            if v is not None:
                try:
                    if float(v) == float(v):  # not NaN
                        n += 1
                except (TypeError, ValueError):
                    n += 1
        return n

    def _rank(r) -> tuple:
        pe = _end(r)
        rev = r.get("revenue")
        has_rev = 1 if rev is not None else 0
        # Prefer Dec 31 (calendar FY) / last calendar month when scores equal
        ye = 0
        if pe is not None:
            ye = 2 if (pe.month == 12 and pe.day >= 28) else (1 if pe.month == 12 else 0)
        score = _metric_score(r)
        # period_end as sortable: later is better among equal quality
        pe_ord = pe.toordinal() if pe is not None else 0
        return (has_rev, score, ye, pe_ord)

    best: dict = {}
    for r in rows:
        yk = _year_key(r)
        if yk is None:
            # Keep orphan rows under unique key so we don't drop them silently
            yk = ("raw", id(r))
        prev = best.get(yk)
        if prev is None or _rank(r) > _rank(prev):
            best[yk] = r

    # Drop interim stubs that won a year only because they were the sole row
    # (e.g. AMZN 2026-03-31 tagged annual with BS/CF but no revenue / not YE).
    kept = []
    for yk, r in best.items():
        pe = _end(r)
        is_ye = pe is not None and pe.month == 12 and pe.day >= 28
        if r.get("revenue") is None and not is_ye:
            continue
        if _metric_score(r) == 0 and r.get("revenue") is None:
            continue
        kept.append(r)

    # Newest first
    def _sort_key(r):
        pe = _end(r)
        return pe.toordinal() if pe is not None else 0

    kept.sort(key=_sort_key, reverse=True)
    return kept

