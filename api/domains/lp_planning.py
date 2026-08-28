"""GP-only LP household planning snapshot.

Accounts → Planning. Linked to a Settings LP. Mixes live managed-account NAV
and LP-fund stake with editable household assets, liabilities, income, and
annual expenses so the GP can see how much P&L the books need to generate.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["lp-planning"])

_KV_PREFIX = "lp.planning:"
_SECTIONS = ("current", "long_term", "liability", "income")
_SOURCES = ("manual", "managed", "fund")


class _Bag:
    pass


B = _Bag()


def mount(ns: dict) -> None:
    for key in (
        "app",
        "_fund_conn",
        "_RealDictCursor",
        "_PSYCOPG2_OK",
        "psycopg2",
        "_claims_or_401",
        "_kv_get",
        "_kv_put",
        "_bulk_fund_market_nav",
    ):
        if key in ns:
            setattr(B, key, ns[key])
    ns["app"].include_router(router)


def _gp_only(request: Request) -> dict:
    claims = B._claims_or_401(request)
    if claims.get("role") not in ("gp", "admin"):
        raise HTTPException(status_code=403, detail="GP role required")
    return claims


def _f(v, default=None):
    if v is None or v == "":
        return default
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    if n != n or n in (float("inf"), float("-inf")):  # NaN / Inf
        return default
    return n


def _s(v, limit=240) -> str:
    return str(v or "").strip()[:limit]


def _kv_key(lp_id: str) -> str:
    return _KV_PREFIX + str(lp_id)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _blank_row(section: str, label: str, **extra) -> dict:
    investable = extra.get("include_in_investments")
    if investable is None:
        investable = section == "current"
    return {
        "id": extra.get("id") or _new_id(),
        "section": section if section in _SECTIONS else "current",
        "label": label,
        "amount": extra.get("amount"),
        "yield_pct": extra.get("yield_pct"),
        "pnl_actual": extra.get("pnl_actual"),
        "notes": extra.get("notes") or "",
        "include_in_investments": bool(investable),
        "source": extra.get("source") or "manual",
        "link_id": extra.get("link_id"),
        "hidden": bool(extra.get("hidden", False)),
        "amount_override": extra.get("amount_override"),
    }


def _default_manual_rows() -> list[dict]:
    return [
        _blank_row("current", "Cash / checking", include_in_investments=False),
        _blank_row("current", "Notes receivable"),
        _blank_row("long_term", "Real estate (FMV)", include_in_investments=False),
        _blank_row("liability", "Mortgage / property debt"),
        _blank_row("income", "Social Security (annual)"),
    ]


def _sanitize_row(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    section = _s(raw.get("section"), 32).lower() or "current"
    if section not in _SECTIONS:
        section = "current"
    source = _s(raw.get("source"), 16).lower() or "manual"
    if source not in _SOURCES:
        source = "manual"
    rid = _s(raw.get("id"), 40) or _new_id()
    return {
        "id": rid,
        "section": section,
        "label": _s(raw.get("label"), 160),
        "amount": _f(raw.get("amount")),
        "yield_pct": _f(raw.get("yield_pct")),
        "pnl_actual": _f(raw.get("pnl_actual")),
        "notes": _s(raw.get("notes"), 400),
        "include_in_investments": bool(raw.get("include_in_investments", section == "current")),
        "source": source,
        "link_id": _s(raw.get("link_id"), 80) or None,
        "hidden": bool(raw.get("hidden", False)),
        "amount_override": _f(raw.get("amount_override")),
    }


def _load_saved(lp_id: str) -> dict | None:
    raw = B._kv_get(_kv_key(lp_id))
    if not raw or not isinstance(raw, dict):
        return None
    rows = []
    for r in (raw.get("rows") or []):
        clean = _sanitize_row(r)
        if clean:
            rows.append(clean)
    return {
        "title": _s(raw.get("title"), 160),
        "as_of": _s(raw.get("as_of"), 32),
        "notes": _s(raw.get("notes"), 4000),
        "annual_expenses": _f(raw.get("annual_expenses"), 0.0) or 0.0,
        "rows": rows[:200],
        "updated_at": raw.get("updated_at"),
    }


def _auth_mod():
    import auth_v2 as m
    return m


def _lp_user(lp_id: str) -> dict:
    user = _auth_mod().find_user_by_lp_id(lp_id)
    if not user:
        raise HTTPException(status_code=404, detail="LP not found")
    if user.get("role") not in ("lp", "gp", "admin"):
        raise HTTPException(status_code=404, detail="LP not found")
    return user


def _pnl_from_ytd(nav, ytd_pct, beg, deps, wdrs):
    nav = _f(nav)
    beg = _f(beg)
    if nav is not None and beg is not None:
        return round(nav - beg - (_f(deps, 0) or 0) + (_f(wdrs, 0) or 0), 2)
    ytd = _f(ytd_pct)
    if nav is not None and ytd is not None:
        r = ytd / 100.0
        if r > -0.999:
            return round(nav * r / (1.0 + r), 2)
    return None


def _live_books(user: dict) -> dict:
    """Resolve this LP's managed NAVs and fund stakes."""
    out = {"managed": [], "funds": [], "warnings": []}
    if not getattr(B, "_PSYCOPG2_OK", False) or not os.environ.get("DATABASE_URL"):
        out["warnings"].append("database unavailable")
        return out

    acct_names = [str(x) for x in (user.get("managed_account_ids") or []) if x]
    memberships = user.get("fund_memberships") or {}
    if not isinstance(memberships, dict):
        memberships = {}
    fund_names = [str(k) for k in memberships.keys() if k]

    try:
        with B._fund_conn() as conn, conn.cursor(cursor_factory=B._RealDictCursor) as cur:
            acct_rows = []
            if acct_names:
                cur.execute(
                    """
                    SELECT id, name, short_name
                      FROM funds
                     WHERE fund_type = 'managed_account'
                       AND LOWER(name) = ANY(%s)
                     ORDER BY name
                    """,
                    ([n.lower() for n in acct_names],),
                )
                acct_rows = [dict(r) for r in cur.fetchall()]

            fund_rows = []
            if fund_names:
                cur.execute(
                    """
                    SELECT id, name, short_name
                      FROM funds
                     WHERE fund_type = 'lp_fund'
                       AND LOWER(name) = ANY(%s)
                     ORDER BY name
                    """,
                    ([n.lower() for n in fund_names],),
                )
                fund_rows = [dict(r) for r in cur.fetchall()]

            all_fids = [str(r["id"]) for r in acct_rows] + [str(r["id"]) for r in fund_rows]
            mkt = {}
            if all_fids:
                try:
                    mkt = B._bulk_fund_market_nav(cur, all_fids) or {}
                except Exception:
                    conn.rollback()

            snaps = {}
            if all_fids:
                try:
                    cur.execute(
                        """
                        SELECT DISTINCT ON (fund_id) fund_id::text, net_nav, as_of_date
                          FROM nav_snapshots
                         WHERE fund_id::text = ANY(%s)
                         ORDER BY fund_id, as_of_date DESC
                        """,
                        (all_fids,),
                    )
                    for r in cur.fetchall():
                        snaps[str(r["fund_id"])] = dict(r)
                except Exception:
                    conn.rollback()

            ytd_by = {}
            acct_fids = [str(r["id"]) for r in acct_rows]
            if acct_fids:
                try:
                    cur.execute(
                        """
                        SELECT fund_id::text, nav, ytd_pct, result_json, updated_at
                          FROM managed_account_ytd_cache
                         WHERE fund_id::text = ANY(%s)
                        """,
                        (acct_fids,),
                    )
                    for r in cur.fetchall():
                        ytd_by[str(r["fund_id"])] = dict(r)
                except Exception:
                    conn.rollback()

            for a in acct_rows:
                fid = str(a["id"])
                snap = snaps.get(fid) or {}
                ytd = ytd_by.get(fid) or {}
                market = _f(mkt.get(fid), 0) or 0.0
                snap_nav = _f(snap.get("net_nav"))
                cache_nav = _f(ytd.get("nav"))
                nav = market if market > 0 else (snap_nav if snap_nav is not None else cache_nav)

                beg = deps = wdrs = None
                ytd_pct = _f(ytd.get("ytd_pct"))
                if ytd.get("result_json"):
                    try:
                        rj = ytd["result_json"]
                        if isinstance(rj, str):
                            rj = json.loads(rj)
                        beg = _f(rj.get("ytd_beg_balance") or rj.get("begin_value"))
                        deps = _f(rj.get("ytd_total_deposits"), 0)
                        wdrs = _f(rj.get("ytd_total_withdrawals"), 0)
                        md = _f(rj.get("md_return_pct"))
                        if ytd_pct is None and md is not None:
                            ytd_pct = md
                    except Exception:
                        pass

                as_of = None
                if market <= 0 and snap.get("as_of_date"):
                    d = snap["as_of_date"]
                    as_of = d.isoformat() if hasattr(d, "isoformat") else str(d)

                out["managed"].append({
                    "fund_id": fid,
                    "name": a.get("name") or "",
                    "short_name": a.get("short_name") or "",
                    "nav": nav,
                    "ytd_pct": ytd_pct,
                    "pnl_ytd": _pnl_from_ytd(nav, ytd_pct, beg, deps, wdrs),
                    "as_of": as_of,
                    "live": market > 0,
                })

            fund_fids = [str(r["id"]) for r in fund_rows]
            total_committed = {}
            if fund_fids:
                try:
                    cur.execute(
                        """
                        SELECT l.fund_id::text,
                               COALESCE(SUM(c.commitment_amount), 0) AS total_committed
                          FROM commitments c
                          JOIN lps l ON l.id = c.lp_id
                         WHERE l.fund_id::text = ANY(%s) AND c.superseded_by IS NULL
                         GROUP BY l.fund_id
                        """,
                        (fund_fids,),
                    )
                    for r in cur.fetchall():
                        total_committed[str(r["fund_id"])] = float(r["total_committed"] or 0)
                except Exception:
                    conn.rollback()

            annual = {}
            if fund_fids:
                try:
                    cur.execute(
                        """
                        SELECT DISTINCT ON (fund_id) fund_id::text, gp_equity_end, end_nav
                          FROM fund_annual_snapshots
                         WHERE fund_id::text = ANY(%s)
                         ORDER BY fund_id, year DESC
                        """,
                        (fund_fids,),
                    )
                    for r in cur.fetchall():
                        annual[str(r["fund_id"])] = dict(r)
                except Exception:
                    conn.rollback()

            user_name = (user.get("name") or "").strip()
            for f in fund_rows:
                fid = str(f["id"])
                fname = f.get("name") or ""
                alias = (
                    memberships.get(fname)
                    or memberships.get(fname.upper())
                    or memberships.get(fname.lower())
                    or user_name
                    or ""
                )
                alias = str(alias).strip()
                commitment = 0.0
                legal = alias
                if alias:
                    try:
                        cur.execute(
                            """
                            SELECT l.legal_name,
                                   COALESCE(c.commitment, 0) AS commitment
                              FROM lps l
                              LEFT JOIN (
                                  SELECT lp_id, SUM(commitment_amount) AS commitment
                                    FROM commitments
                                   WHERE superseded_by IS NULL
                                   GROUP BY lp_id
                              ) c ON c.lp_id = l.id
                             WHERE l.fund_id::text = %s
                               AND LOWER(TRIM(l.legal_name)) = %s
                             LIMIT 1
                            """,
                            (fid, alias.lower()),
                        )
                        row = cur.fetchone()
                        if row:
                            commitment = float(row["commitment"] or 0)
                            legal = row["legal_name"] or alias
                    except Exception:
                        conn.rollback()

                snap = snaps.get(fid) or {}
                market = _f(mkt.get(fid), 0) or 0.0
                snap_nav = _f(snap.get("net_nav"))
                using_live = market > 0
                effective = market if using_live else snap_nav
                gp_carry = 0.0
                last = annual.get(fid)
                if last and effective:
                    last_end = float(last.get("end_nav") or 0)
                    last_gp = float(last.get("gp_equity_end") or 0)
                    if last_end > 0:
                        gp_carry = (last_gp / last_end) * effective
                lp_nav = max(0.0, (effective or 0) - gp_carry)
                tot = total_committed.get(fid, 0.0)
                stake = None
                if lp_nav > 0 and tot > 0 and commitment > 0:
                    stake = round(commitment / tot * lp_nav, 2)
                elif effective and tot <= 0 and commitment > 0:
                    stake = round(float(effective), 2)

                as_of = None
                if not using_live and snap.get("as_of_date"):
                    d = snap["as_of_date"]
                    as_of = d.isoformat() if hasattr(d, "isoformat") else str(d)

                out["funds"].append({
                    "fund_id": fid,
                    "name": fname,
                    "short_name": f.get("short_name") or "",
                    "lp_alias": legal,
                    "commitment": commitment,
                    "total_committed": tot,
                    "fund_nav": effective,
                    "stake_value": stake,
                    "as_of": as_of,
                    "live": using_live,
                })
    except HTTPException:
        raise
    except Exception as exc:
        out["warnings"].append(str(exc)[:200])
    return out


def _row_amount(r: dict) -> float:
    if r.get("hidden"):
        return 0.0
    ov = _f(r.get("amount_override"))
    if ov is not None:
        return ov
    live = _f(r.get("live_amount"))
    if r.get("source") in ("managed", "fund") and live is not None:
        return live
    return _f(r.get("amount"), 0.0) or 0.0


def _row_pnl_est(r: dict) -> float | None:
    if r.get("section") == "income":
        return _row_amount(r)
    y = _f(r.get("yield_pct"))
    if y is None:
        return None
    return round(_row_amount(r) * y / 100.0, 2)


def _row_pnl_act(r: dict) -> float | None:
    if r.get("section") == "income":
        return _row_amount(r)
    if r.get("source") in ("managed", "fund"):
        return _f(r.get("pnl_actual_live"))
    return _f(r.get("pnl_actual"))


def _compute(rows: list[dict], expenses: float) -> dict:
    assets = liabilities = investable = income = 0.0
    inv_est = inv_act = 0.0
    has_inv_act = False
    has_inv_est = False
    vis = [r for r in rows if not r.get("hidden")]
    for r in vis:
        amt = _row_amount(r)
        sec = r.get("section")
        if sec == "liability":
            liabilities += amt
            continue
        if sec == "income":
            income += amt
            continue
        assets += amt
        if r.get("include_in_investments"):
            investable += amt
        est = _row_pnl_est(r)
        if est is not None:
            inv_est += est
            has_inv_est = True
        act = _row_pnl_act(r)
        if act is not None:
            inv_act += act
            has_inv_act = True

    expenses = _f(expenses, 0.0) or 0.0
    required = max(0.0, expenses - income)
    inv_mark = inv_act if has_inv_act else inv_est
    total_yield = inv_mark + income
    surplus = total_yield - expenses
    gap = required - inv_mark

    def pct(part, whole):
        if not whole:
            return None
        return round(part / whole * 100.0, 2)

    annotated = []
    for r in rows:
        amt = _row_amount(r)
        sec = r.get("section")
        is_asset = sec in ("current", "long_term")
        item = dict(r)
        item["effective_amount"] = round(amt, 2)
        item["pct_total"] = pct(amt, assets) if is_asset or sec == "liability" else None
        item["pct_invest"] = (
            pct(amt, investable)
            if is_asset and r.get("include_in_investments") and not r.get("hidden")
            else None
        )
        item["pnl_estimate"] = _row_pnl_est(r)
        item["pnl_actual_effective"] = _row_pnl_act(r)
        annotated.append(item)

    return {
        "total_assets": round(assets, 2),
        "total_liabilities": round(liabilities, 2),
        "net_worth": round(assets - liabilities, 2),
        "investable": round(investable, 2),
        "other_income": round(income, 2),
        "pnl_estimate": round(inv_est, 2) if has_inv_est else None,
        "pnl_actual": round(inv_act, 2) if has_inv_act else None,
        "annual_expenses": round(expenses, 2),
        "required_generation": round(required, 2),
        "total_yield": round(total_yield, 2),
        "surplus": round(surplus, 2),
        "gap": round(gap, 2),
        "covered": gap <= 0.01 if expenses else None,
        "rows": annotated,
    }


def _merge(saved: dict | None, live: dict, user: dict) -> dict:
    name = user.get("name") or "LP"
    today = datetime.now(timezone.utc).date().isoformat()
    if saved:
        title = saved.get("title") or f"{name} — planning snapshot"
        as_of = saved.get("as_of") or today
        notes = saved.get("notes") or ""
        expenses = _f(saved.get("annual_expenses"), 0.0) or 0.0
        rows = list(saved.get("rows") or [])
        seeded = False
    else:
        title = f"{name} — planning snapshot"
        as_of = today
        notes = ""
        expenses = 0.0
        rows = _default_manual_rows()
        seeded = True

    by_link: dict[tuple, dict] = {}
    for r in rows:
        if r.get("source") in ("managed", "fund") and r.get("link_id"):
            by_link[(r["source"], str(r["link_id"]))] = r

    new_live: list[dict] = []

    def _attach_managed(acct: dict) -> dict:
        row_live = {
            "live_amount": acct.get("nav"),
            "pnl_actual_live": acct.get("pnl_ytd"),
            "live_as_of": acct.get("as_of"),
            "ytd_pct": acct.get("ytd_pct"),
            "live": bool(acct.get("live")),
        }
        return row_live

    for acct in live.get("managed") or []:
        fid = str(acct.get("fund_id") or "")
        if not fid:
            continue
        key = ("managed", fid)
        existing = by_link.get(key)
        extra = _attach_managed(acct)
        if existing:
            existing.update(extra)
            if not existing.get("label"):
                existing["label"] = acct.get("name") or existing["label"]
        else:
            row = _blank_row(
                "current",
                acct.get("name") or "Managed account",
                source="managed",
                link_id=fid,
                include_in_investments=True,
            )
            row.update(extra)
            row["notes"] = "Linked SMA"
            new_live.append(row)
            by_link[key] = row

    for fund in live.get("funds") or []:
        fid = str(fund.get("fund_id") or "")
        if not fid:
            continue
        key = ("fund", fid)
        label = fund.get("name") or "LP fund"
        extra = {
            "live_amount": fund.get("stake_value"),
            "live_as_of": fund.get("as_of"),
            "live": bool(fund.get("live")),
            "commitment": fund.get("commitment"),
        }
        existing = by_link.get(key)
        if existing:
            existing.update(extra)
            if not existing.get("label"):
                existing["label"] = label
        else:
            row = _blank_row(
                "current",
                label,
                source="fund",
                link_id=fid,
                include_in_investments=True,
            )
            row.update(extra)
            alias = fund.get("lp_alias")
            row["notes"] = f"LP stake{(' · ' + alias) if alias else ''}"
            new_live.append(row)
            by_link[key] = row

    rows = new_live + rows
    live_keys = {("managed", str(a.get("fund_id"))) for a in (live.get("managed") or [])}
    live_keys |= {("fund", str(f.get("fund_id"))) for f in (live.get("funds") or [])}
    kept = []
    for r in rows:
        src = r.get("source")
        lid = r.get("link_id")
        if src in ("managed", "fund") and lid and (src, str(lid)) not in live_keys:
            r["stale"] = True
        kept.append(r)

    return {
        "title": title,
        "as_of": as_of,
        "notes": notes,
        "annual_expenses": expenses,
        "updated_at": (saved or {}).get("updated_at"),
        "seeded": seeded,
        "rows": kept,
    }


def _public_lp(user: dict) -> dict:
    fm = user.get("fund_memberships") or {}
    ma = user.get("managed_account_ids") or []
    return {
        "lp_id": user.get("lp_id"),
        "name": user.get("name") or "",
        "email": user.get("email") or "",
        "role": user.get("role") or "lp",
        "fund_memberships": fm if isinstance(fm, dict) else {},
        "managed_account_ids": list(ma) if isinstance(ma, list) else [],
    }


def _saved_ids() -> set[str]:
    ids: set[str] = set()
    if not getattr(B, "_PSYCOPG2_OK", False) or not os.environ.get("DATABASE_URL"):
        return ids
    try:
        with B._fund_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT k FROM kv_store WHERE k LIKE %s", (_KV_PREFIX + "%",))
            plen = len(_KV_PREFIX)
            for (k,) in cur.fetchall():
                if isinstance(k, str) and k.startswith(_KV_PREFIX):
                    ids.add(k[plen:])
    except Exception:
        pass
    return ids


@router.get("/api/v2/gp/lp-planning")
def planning_roster(request: Request):
    """GP-only: Settings LPs plus whether a planning snapshot exists."""
    claims = _gp_only(request)
    users = _auth_mod().list_users()
    if claims.get("demo_mode"):
        users = [u for u in users if u.get("demo_mode")]
    saved = _saved_ids()
    lps = []
    for u in users:
        if (u.get("role") or "lp") != "lp":
            continue
        fm = u.get("fund_memberships") or {}
        ma = u.get("managed_account_ids") or []
        lps.append({
            "lp_id": u.get("lp_id"),
            "name": u.get("name") or "",
            "email": u.get("email") or "",
            "fund_count": len(fm) if isinstance(fm, dict) else 0,
            "acct_count": len(ma) if isinstance(ma, list) else 0,
            "has_snapshot": u.get("lp_id") in saved,
        })
    lps.sort(key=lambda x: (x["name"] or "").lower())
    return {"lps": lps}


@router.get("/api/v2/gp/lp-planning/{lp_id}")
def planning_get(lp_id: str, request: Request):
    """GP-only: merged snapshot + live linked books + computed P&L gap."""
    _gp_only(request)
    lp_id = (lp_id or "").strip()
    if not lp_id:
        raise HTTPException(status_code=400, detail="lp_id required")
    user = _lp_user(lp_id)
    saved = _load_saved(lp_id)
    live = _live_books(user)
    snap = _merge(saved, live, user)
    computed = _compute(snap["rows"], snap["annual_expenses"])
    snap["rows"] = computed.pop("rows")
    return {
        "lp": _public_lp(user),
        "snapshot": snap,
        "live": live,
        "computed": computed,
        "has_snapshot": saved is not None,
    }


class PlanningRowIn(BaseModel):
    id: str = ""
    section: str = "current"
    label: str = ""
    amount: float | None = None
    yield_pct: float | None = None
    pnl_actual: float | None = None
    notes: str = ""
    include_in_investments: bool = True
    source: str = "manual"
    link_id: str | None = None
    hidden: bool = False
    amount_override: float | None = None


class PlanningPut(BaseModel):
    title: str = ""
    as_of: str = ""
    notes: str = ""
    annual_expenses: float | None = 0
    rows: list[PlanningRowIn] = Field(default_factory=list)


@router.put("/api/v2/gp/lp-planning/{lp_id}")
def planning_put(lp_id: str, request: Request, body: PlanningPut):
    """GP-only: persist editable household lines for this LP."""
    claims = _gp_only(request)
    if claims.get("demo_mode"):
        raise HTTPException(status_code=403, detail="Write operations disabled in demo mode")
    lp_id = (lp_id or "").strip()
    if not lp_id:
        raise HTTPException(status_code=400, detail="lp_id required")
    user = _lp_user(lp_id)
    rows = []
    for raw in (body.rows or [])[:200]:
        clean = _sanitize_row(raw.model_dump())
        if clean:
            rows.append(clean)
    payload = {
        "title": _s(body.title, 160) or f"{user.get('name') or 'LP'} — planning snapshot",
        "as_of": _s(body.as_of, 32),
        "notes": _s(body.notes, 4000),
        "annual_expenses": _f(body.annual_expenses, 0.0) or 0.0,
        "rows": rows,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    ok = B._kv_put(_kv_key(lp_id), payload)
    if not ok:
        raise HTTPException(status_code=500, detail="Could not save planning snapshot")
    live = _live_books(user)
    snap = _merge(payload, live, user)
    computed = _compute(snap["rows"], snap["annual_expenses"])
    snap["rows"] = computed.pop("rows")
    return {
        "ok": True,
        "lp": _public_lp(user),
        "snapshot": snap,
        "live": live,
        "computed": computed,
        "has_snapshot": True,
    }
