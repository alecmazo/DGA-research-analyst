"""GP-only LP household planning snapshot.

Accounts → Planning. Linked to a Settings LP. Mixes live managed-account NAV
and LP-fund stake with editable household assets, liabilities, income, and
annual expenses so the GP can see how much P&L the books need to generate.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
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
        "_render_research_pdf",
        "_dga_logo_data_uri",
        "_send_email_with_pdf_attachment",
        "_valid_email_addr",
        "_content_disposition",
        "_snaptrade_refresh_tax_ytd",
        "_snaptrade_tax_ytd_for_funds",
    ):
        if key in ns:
            setattr(B, key, ns[key])
    ns["app"].include_router(router)


def _gp_only(request: Request) -> dict:
    claims = B._claims_or_401(request)
    if claims.get("role") not in ("gp", "admin"):
        raise HTTPException(status_code=403, detail="GP role required")
    return claims


def _lp_only(request: Request) -> dict:
    """Authenticated LP — never a GP looking up another book."""
    claims = B._claims_or_401(request)
    if claims.get("role") != "lp":
        raise HTTPException(status_code=403, detail="LP role required")
    return claims


def _caller_lp_id(claims: dict) -> str:
    lp_id = (claims.get("lp_id") or claims.get("sub") or "").strip()
    if not lp_id:
        raise HTTPException(status_code=400, detail="No LP identity on this session")
    return lp_id


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
        "capital_gains": extra.get("capital_gains"),
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
        "capital_gains": _f(raw.get("capital_gains")),
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


def _tokens(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (s or "").lower())


def _assignment_belongs_elsewhere(assigned: str, owner: dict, others: list[dict]) -> bool:
    """True when the assignment's first token is another user's given name.

    Stops "Alec Ind" on Dennis's Settings list from binding Alec's SMA. An
    assignment that starts with this owner's own name is kept.
    """
    toks = _tokens(assigned)
    if not toks:
        return False
    lead = toks[0]
    if len(lead) < 3:
        return False
    own = _tokens(owner.get("name") or "")
    if lead in own:
        return False
    oid = str(owner.get("lp_id") or "")
    for u in others:
        if str(u.get("lp_id") or "") == oid:
            continue
        given = (_tokens(u.get("name") or "") or [""])[0]
        if given == lead:
            return True
    return False


def _name_initials(name: str) -> str:
    return "".join(t[0] for t in _tokens(name) if t)[:4]


def _resolve_fund_lp(candidates: list[dict], alias: str, user_name: str,
                     claimed: set[str]) -> dict | None:
    """Map a Settings user onto a fund LP legal_name + commitment.

    Empty aliases (Viktoriya on Fund I/III) used to miss VK and leave the
    planning sheet at $0. Exact alias still wins; otherwise initials, then
    the unique unclaimed leftover LP in that fund.
    """
    if not candidates:
        return None
    alias_l = (alias or "").strip().lower()
    name_l = (user_name or "").strip().lower()
    claimed_l = {str(x).strip().lower() for x in (claimed or set()) if x}

    def one(hits):
        return hits[0] if len(hits) == 1 else None

    if alias_l:
        hits = [c for c in candidates
                if (c.get("legal_name") or "").strip().lower() == alias_l]
        if hits:
            return hits[0]
    if name_l:
        hits = [c for c in candidates
                if (c.get("legal_name") or "").strip().lower() == name_l]
        if hits:
            return hits[0]
    ini = _name_initials(user_name)
    if len(ini) >= 2:
        hit = one([c for c in candidates
                   if (c.get("legal_name") or "").strip().lower() == ini])
        if hit:
            return hit
    leftover = [
        c for c in candidates
        if (c.get("legal_name") or "").strip().lower() not in claimed_l
    ]
    if len(leftover) == 1:
        return leftover[0]
    toks = _tokens(user_name)
    if toks:
        first = toks[0][0]
        hit = one([
            c for c in leftover
            if (c.get("legal_name") or "").strip().lower()[:1] == first
        ])
        if hit:
            return hit
    return None


def _score_assigned_name(assigned: str, fund: dict) -> int:
    """Score how well a Settings assignment name matches a fund row.

    Settings historically stored nicknames that later diverged from funds.name
    (e.g. "Anatoly Ind" vs "Anat Defensive"). Exact name still wins; otherwise
    first-token stems and whole-token hits, never a generic substring steal.
    """
    a = (assigned or "").strip().lower()
    name = (fund.get("name") or "").strip().lower()
    short = (fund.get("short_name") or "").strip().lower()
    if not a:
        return 0
    if a == name:
        return 1000
    if short and a == short:
        return 900
    if len(a) >= 5 and len(name) >= 5 and (a.startswith(name) or name.startswith(a)):
        return 800
    at = _tokens(assigned)
    ft = _tokens(name) + _tokens(short)
    if not at or not ft:
        return 0
    score = 0
    a0, f0 = at[0], ft[0]
    if a0 == f0:
        score += 500 + min(len(a0), 12)
    elif min(len(a0), len(f0)) >= 3 and (a0.startswith(f0) or f0.startswith(a0)):
        score += 400 + min(len(a0), len(f0), 10)
    used = {f0} if score else set()
    for ta in at[1:]:
        for tb in ft:
            if tb in used:
                continue
            if ta == tb and len(ta) >= 2:
                score += 80
                used.add(tb)
                break
            if min(len(ta), len(tb)) >= 4 and (ta.startswith(tb) or tb.startswith(ta)):
                score += 40
                used.add(tb)
                break
    # Fund name is an exact token of the assignment ("Alec Ind" → "Ind")
    if name and name in at:
        score = max(score, 350)
    return score


def _pick_assigned_accounts(assigned: list[str], funds: list[dict]) -> tuple[list[dict], list[str]]:
    """Bind exact Settings names first, then fuzzy-match leftovers.

    Otherwise "Anatoly Ind" would steal "Anatoly IRA" via the shared first token
    and leave the real defensive SMA unmatched.
    """
    remaining = list(funds)
    picked: list[dict] = []

    def take(name: str, fund: dict) -> None:
        row = dict(fund)
        row["assigned_as"] = name
        picked.append(row)
        bid = str(fund.get("id"))
        remaining[:] = [f for f in remaining if str(f.get("id")) != bid]

    pending: list[str] = []
    for name in assigned:
        a = name.strip().lower()
        hit = next(
            (
                f
                for f in remaining
                if (f.get("name") or "").strip().lower() == a
                or (f.get("short_name") or "").strip().lower() == a
            ),
            None,
        )
        if hit:
            take(name, hit)
        else:
            pending.append(name)

    unmatched: list[str] = []
    for name in pending:
        scored = [(_score_assigned_name(name, f), f) for f in remaining]
        scored = [x for x in scored if x[0] >= 40]
        scored.sort(key=lambda x: -x[0])
        if not scored:
            unmatched.append(name)
            continue
        unique = len(scored) == 1 or scored[0][0] >= scored[1][0] + 30
        if unique and scored[0][0] >= 40:
            take(name, scored[0][1])
        else:
            unmatched.append(name)
    return picked, unmatched


_CASH_SYMS = {
    "SPAXX", "FDRXX", "SPRXX", "FZFXX", "FZDXX", "FDLXX", "VMFXX",
    "CASH", "USD", "FCASH",
}
_MM_YIELD_CACHE: dict = {"pct": None, "ts": 0.0}


def _is_cash_symbol(sym: str) -> bool:
    return (sym or "").rstrip("*").upper() in _CASH_SYMS


def _is_cash_label(label: str) -> bool:
    s = (label or "").lower()
    return any(k in s for k in ("cash", "checking", "money market", "mmf", "spaxx"))


_IRA_RE = re.compile(r"\b(ira|roth|401\s*\(?k\)?|sep)\b", re.I)


def _is_ira_name(*parts: str) -> bool:
    return bool(_IRA_RE.search(" ".join(p or "" for p in parts)))


def _mm_yield_pct() -> float:
    """13-week T-bill (^IRX) as the cash / money-market rate. Fallback 4.20%."""
    import time as _time
    now = _time.time()
    cached = _MM_YIELD_CACHE.get("pct")
    if cached is not None and now - float(_MM_YIELD_CACHE.get("ts") or 0) < 3600:
        return float(cached)
    pct = 4.20
    try:
        import yfinance as yf
        t = yf.Ticker("^IRX")
        v = None
        try:
            v = getattr(t.fast_info, "last_price", None)
        except Exception:
            v = None
        if v is None:
            info = getattr(t, "info", None) or {}
            v = info.get("regularMarketPrice") or info.get("previousClose")
        if v is not None and 0.5 < float(v) < 15:
            pct = round(float(v), 2)
    except Exception:
        pass
    _MM_YIELD_CACHE["pct"] = pct
    _MM_YIELD_CACHE["ts"] = now
    return pct


def _attr_income_and_gains(rj: dict) -> tuple[float, float]:
    """YTD dividend/interest cash and attribution capital gains (ignore ST/LT)."""
    income = 0.0
    gains = 0.0
    for a in rj.get("attribution") or []:
        if not isinstance(a, dict):
            continue
        tk = str(a.get("ticker") or "")
        div = _f(a.get("dividends_cash"), 0.0) or 0.0
        dg = _f(a.get("dollar_gain"), 0.0) or 0.0
        income += div
        if a.get("is_mm") or _is_cash_symbol(tk):
            if div <= 0 and dg:
                income += dg
        else:
            gains += dg
    return round(income, 2), round(gains, 2)


def _blended_yield(nav, cash_mv, div_ytd) -> float | None:
    """Equity trailing dividend yield (annualized) + cash at the MM rate, NAV-weighted."""
    nav = _f(nav, 0.0) or 0.0
    cash_mv = max(_f(cash_mv, 0.0) or 0.0, 0.0)
    if nav <= 0:
        return None
    doy = datetime.now(timezone.utc).timetuple().tm_yday
    frac = max(doy / 365.0, 0.15)
    equity = max(nav - cash_mv, 0.0)
    div_ytd = _f(div_ytd, 0.0) or 0.0
    eq_yield = (div_ytd / equity / frac * 100.0) if equity > 0 else 0.0
    mm = _mm_yield_pct()
    blended = (eq_yield / 100.0 * equity + mm / 100.0 * cash_mv) / nav * 100.0
    return round(blended, 2)


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
    out = {
        "managed": [],
        "funds": [],
        "unmatched_accounts": [],
        "warnings": [],
        "mm_yield_pct": _mm_yield_pct(),
    }
    if not getattr(B, "_PSYCOPG2_OK", False) or not os.environ.get("DATABASE_URL"):
        out["warnings"].append("database unavailable")
        return out

    acct_names = [str(x) for x in (user.get("managed_account_ids") or []) if x]
    try:
        roster = _auth_mod().list_users()
    except Exception:
        roster = []
    acct_names = [
        n for n in acct_names
        if not _assignment_belongs_elsewhere(n, user, roster)
    ]
    memberships = user.get("fund_memberships") or {}
    if not isinstance(memberships, dict):
        memberships = {}
    fund_names = [str(k) for k in memberships.keys() if k]
    is_gp = (user.get("role") or "").lower() in ("gp", "admin")

    try:
        with B._fund_conn() as conn, conn.cursor(cursor_factory=B._RealDictCursor) as cur:
            acct_rows = []
            unmatched_accts: list[str] = []
            if acct_names:
                cur.execute(
                    """
                    SELECT id, name, short_name
                      FROM funds
                     WHERE fund_type = 'managed_account'
                     ORDER BY name
                    """
                )
                acct_rows, unmatched_accts = _pick_assigned_accounts(
                    acct_names, [dict(r) for r in cur.fetchall()]
                )
                out["unmatched_accounts"] = unmatched_accts
                if unmatched_accts:
                    out["warnings"].append(
                        "Settings names with no SMA book: " + ", ".join(unmatched_accts)
                    )

            fund_rows = []
            if fund_names or is_gp:
                if fund_names and not is_gp:
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
                else:
                    # GP snapshot: every LP fund's GP equity, plus any named memberships.
                    cur.execute(
                        """
                        SELECT id, name, short_name
                          FROM funds
                         WHERE fund_type = 'lp_fund'
                         ORDER BY name
                        """
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

            cash_by_fid: dict = {}
            if acct_fids:
                try:
                    cur.execute(
                        """
                        SELECT tl.fund_id::text AS fid,
                               COALESCE(SUM(tl.quantity), 0) AS qty
                          FROM tax_lots tl
                          JOIN securities s ON s.id = tl.security_id
                         WHERE tl.fund_id::text = ANY(%s)
                           AND tl.closed_at IS NULL
                           AND (
                                LOWER(COALESCE(s.asset_class, '')) = 'cash'
                                OR UPPER(TRIM(TRAILING '*' FROM COALESCE(s.symbol, '')))
                                   = ANY(%s)
                           )
                         GROUP BY tl.fund_id
                        """,
                        (acct_fids, list(_CASH_SYMS)),
                    )
                    for r in cur.fetchall():
                        cash_by_fid[str(r["fid"])] = float(r["qty"] or 0)
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
                rj = None
                if ytd.get("result_json"):
                    try:
                        rj = ytd["result_json"]
                        if isinstance(rj, str):
                            rj = json.loads(rj)
                        if not isinstance(rj, dict):
                            rj = None
                        if rj:
                            beg = _f(rj.get("ytd_beg_balance") or rj.get("begin_value"))
                            deps = _f(rj.get("ytd_total_deposits"), 0)
                            wdrs = _f(rj.get("ytd_total_withdrawals"), 0)
                            md = _f(rj.get("md_return_pct"))
                            if ytd_pct is None and md is not None:
                                ytd_pct = md
                    except Exception:
                        rj = None

                as_of = None
                if market <= 0 and snap.get("as_of_date"):
                    d = snap["as_of_date"]
                    as_of = d.isoformat() if hasattr(d, "isoformat") else str(d)

                pnl = _pnl_from_ytd(nav, ytd_pct, beg, deps, wdrs)
                div_ytd = cap_gains = yield_live = None
                cash_mv = cash_by_fid.get(fid, 0.0)
                if rj:
                    ig = _f(rj.get("investment_gain"))
                    if ig is not None:
                        pnl = ig
                    div_ytd, cap_gains = _attr_income_and_gains(rj)
                    yield_live = _blended_yield(nav, cash_mv, div_ytd)

                assigned_as = a.get("assigned_as") or a.get("name") or ""
                book_name = a.get("name") or ""
                ira = _is_ira_name(book_name, a.get("short_name") or "", assigned_as)
                out["managed"].append({
                    "fund_id": fid,
                    "name": book_name,
                    "short_name": a.get("short_name") or "",
                    "assigned_as": assigned_as,
                    "nav": nav,
                    "ytd_pct": ytd_pct,
                    "pnl_ytd": pnl,
                    "dividends_ytd": div_ytd,
                    "capital_gains_live": None if ira else cap_gains,
                    "realized_na": ira,
                    "cash_mv": cash_mv,
                    "yield_pct_live": yield_live,
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
            lps_by_fid: dict[str, list[dict]] = {}
            if fund_fids:
                try:
                    cur.execute(
                        """
                        SELECT l.fund_id::text AS fid,
                               l.legal_name,
                               COALESCE(SUM(c.commitment_amount), 0) AS commitment
                          FROM lps l
                          LEFT JOIN commitments c
                            ON c.lp_id = l.id AND c.superseded_by IS NULL
                         WHERE l.fund_id::text = ANY(%s)
                           AND COALESCE(l.status, 'active') = 'active'
                         GROUP BY l.fund_id, l.legal_name
                        """,
                        (fund_fids,),
                    )
                    for r in cur.fetchall():
                        lps_by_fid.setdefault(str(r["fid"]), []).append({
                            "legal_name": r.get("legal_name") or "",
                            "commitment": float(r["commitment"] or 0),
                        })
                except Exception:
                    conn.rollback()

            claimed_by_fund: dict[str, set[str]] = {}
            oid = str(user.get("lp_id") or "")
            for u in roster:
                if str(u.get("lp_id") or "") == oid:
                    continue
                fm = u.get("fund_memberships") or {}
                if not isinstance(fm, dict):
                    continue
                for k, v in fm.items():
                    a = str(v or "").strip()
                    if a:
                        claimed_by_fund.setdefault(str(k).strip().lower(), set()).add(a.lower())

            for f in fund_rows:
                fid = str(f["id"])
                fname = f.get("name") or ""
                alias = str(
                    memberships.get(fname)
                    or memberships.get(fname.upper())
                    or memberships.get(fname.lower())
                    or ""
                ).strip()
                picked = _resolve_fund_lp(
                    lps_by_fid.get(fid) or [],
                    alias,
                    user_name,
                    claimed_by_fund.get(fname.strip().lower()) or set(),
                )
                commitment = float((picked or {}).get("commitment") or 0)
                legal = ((picked or {}).get("legal_name") or alias or user_name or "").strip()

                snap = snaps.get(fid) or {}
                market = _f(mkt.get(fid), 0) or 0.0
                snap_nav = _f(snap.get("net_nav"))
                using_live = market > 0
                effective = market if using_live else snap_nav
                gp_carry = 0.0
                last_gp = 0.0
                last = annual.get(fid)
                if last:
                    last_end = float(last.get("end_nav") or 0)
                    last_gp = float(last.get("gp_equity_end") or 0)
                    if last_end > 0 and effective:
                        gp_carry = (last_gp / last_end) * float(effective)
                    elif last_gp:
                        gp_carry = last_gp
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

                if is_gp and gp_carry:
                    gp_pnl = round(gp_carry - last_gp, 2) if last_gp else None
                    gp_ytd = None
                    if last_gp and last_gp > 0 and gp_pnl is not None:
                        gp_ytd = round(gp_pnl / last_gp * 100.0, 2)
                    out["funds"].append({
                        "fund_id": fid,
                        "name": fname,
                        "short_name": f.get("short_name") or "",
                        "lp_alias": "GP",
                        "commitment": 0.0,
                        "total_committed": tot,
                        "fund_nav": effective,
                        "stake_value": round(gp_carry, 2),
                        "stake_kind": "gp",
                        "pnl_ytd": gp_pnl,
                        "ytd_pct": gp_ytd,
                        "as_of": as_of,
                        "live": using_live,
                    })
                    if not (commitment > 0 and stake):
                        continue

                if not (stake or commitment):
                    continue
                out["funds"].append({
                    "fund_id": fid,
                    "name": fname,
                    "short_name": f.get("short_name") or "",
                    "lp_alias": legal,
                    "commitment": commitment,
                    "total_committed": tot,
                    "fund_nav": effective,
                    "stake_value": stake,
                    "stake_kind": "lp",
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


def _row_yield(r: dict) -> float | None:
    y = _f(r.get("yield_pct"))
    live = _f(r.get("yield_pct_live"))
    if _is_cash_label(r.get("label") or "") and live is not None:
        if y is None or y <= 1.0:
            return live
    if y is not None:
        return y
    return live


def _row_pnl_est(r: dict) -> float | None:
    if r.get("section") in ("long_term", "liability"):
        return None
    if r.get("section") == "income":
        return _row_amount(r)
    y = _row_yield(r)
    if y is None:
        return None
    return round(_row_amount(r) * y / 100.0, 2)


def _row_pnl_act(r: dict) -> float | None:
    if r.get("section") in ("long_term", "liability"):
        return None
    if r.get("section") == "income":
        return _row_amount(r)
    if r.get("source") in ("managed", "fund"):
        return _f(r.get("pnl_actual_live"))
    return _f(r.get("pnl_actual"))


def _row_ytd_perf(r: dict) -> float | None:
    if r.get("section") in ("long_term", "liability", "income"):
        return None
    if r.get("source") in ("managed", "fund"):
        return _f(r.get("pnl_actual_live"))
    return None


def _row_taxable(r: dict) -> float | None:
    if r.get("section") in ("liability", "long_term"):
        return None
    if r.get("section") == "income":
        return _row_amount(r)
    if r.get("realized_na") or _is_ira_name(r.get("label") or ""):
        return None
    ov = _f(r.get("capital_gains"))
    if ov is not None:
        return ov
    return _f(r.get("capital_gains_live"))


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
    pnl_est_total = (inv_est + income) if (has_inv_est or income) else None
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
        "pnl_estimate": round(pnl_est_total, 2) if pnl_est_total is not None else None,
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
            "yield_pct_live": acct.get("yield_pct_live"),
            "capital_gains_live": acct.get("capital_gains_live"),
            "realized_na": bool(acct.get("realized_na")),
            "dividends_ytd": acct.get("dividends_ytd"),
            "cash_mv": acct.get("cash_mv"),
        }
        return row_live

    for acct in live.get("managed") or []:
        fid = str(acct.get("fund_id") or "")
        if not fid:
            continue
        key = ("managed", fid)
        existing = by_link.get(key)
        extra = _attach_managed(acct)
        assigned = (acct.get("assigned_as") or "").strip()
        book = (acct.get("name") or "").strip()
        note = "Linked SMA"
        if assigned and book and assigned.lower() != book.lower():
            note = f"Linked SMA · Settings “{assigned}”"
        if existing:
            existing.update(extra)
            if not existing.get("label"):
                existing["label"] = book or existing["label"]
            if (existing.get("notes") or "") in ("", "Linked SMA"):
                existing["notes"] = note
        else:
            row = _blank_row(
                "current",
                book or assigned or "Managed account",
                source="managed",
                link_id=fid,
                include_in_investments=True,
            )
            row.update(extra)
            row["notes"] = note
            new_live.append(row)
            by_link[key] = row

    for fund in live.get("funds") or []:
        fid = str(fund.get("fund_id") or "")
        if not fid:
            continue
        kind = (fund.get("stake_kind") or "lp").lower()
        link = f"{fid}:gp" if kind == "gp" else fid
        key = ("fund", link)
        label = fund.get("name") or "LP fund"
        extra = {
            "live_amount": fund.get("stake_value"),
            "live_as_of": fund.get("as_of"),
            "live": bool(fund.get("live")),
            "commitment": fund.get("commitment"),
            "pnl_actual_live": fund.get("pnl_ytd"),
            "ytd_pct": fund.get("ytd_pct"),
        }
        existing = by_link.get(key)
        note = "GP stake" if kind == "gp" else (
            f"LP stake{(' · ' + fund.get('lp_alias')) if fund.get('lp_alias') else ''}"
        )
        if existing:
            existing.update(extra)
            if not existing.get("label"):
                existing["label"] = label
            if (existing.get("notes") or "") in ("", "Linked SMA", "LP stake", "GP stake") or (
                (existing.get("notes") or "").startswith("LP stake")
            ):
                existing["notes"] = note
        else:
            row = _blank_row(
                "current",
                label,
                source="fund",
                link_id=link,
                include_in_investments=True,
            )
            row.update(extra)
            row["notes"] = note
            new_live.append(row)
            by_link[key] = row

    for name in live.get("unmatched_accounts") or []:
        key = ("managed", "unmatched:" + name.lower())
        if key in by_link:
            by_link[key]["stale"] = True
            continue
        row = _blank_row(
            "current",
            name,
            source="managed",
            link_id="unmatched:" + name.lower(),
            include_in_investments=True,
        )
        row["stale"] = True
        row["notes"] = "Assigned in Settings — no matching SMA book"
        new_live.append(row)
        by_link[key] = row

    rows = new_live + rows
    live_keys = {("managed", str(a.get("fund_id"))) for a in (live.get("managed") or [])}
    live_keys |= {
        (
            "fund",
            f"{f.get('fund_id')}:gp" if (f.get("stake_kind") or "") == "gp"
            else str(f.get("fund_id")),
        )
        for f in (live.get("funds") or [])
        if f.get("fund_id")
    }
    live_keys |= {
        ("managed", "unmatched:" + str(n).lower())
        for n in (live.get("unmatched_accounts") or [])
    }
    kept = []
    for r in rows:
        src = r.get("source")
        lid = r.get("link_id")
        if src in ("managed", "fund") and lid and (src, str(lid)) not in live_keys:
            r["stale"] = True
        kept.append(r)

    mm = _f(live.get("mm_yield_pct")) or _mm_yield_pct()
    for r in kept:
        if r.get("source") == "manual" and _is_cash_label(r.get("label") or ""):
            r["yield_pct_live"] = mm

    return {
        "title": title,
        "as_of": as_of,
        "notes": notes,
        "annual_expenses": expenses,
        "updated_at": (saved or {}).get("updated_at"),
        "seeded": seeded,
        "mm_yield_pct": mm,
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
        role = (u.get("role") or "lp").lower()
        if role not in ("lp", "gp"):
            continue
        fm = u.get("fund_memberships") or {}
        ma = u.get("managed_account_ids") or []
        lps.append({
            "lp_id": u.get("lp_id"),
            "name": u.get("name") or "",
            "email": u.get("email") or "",
            "role": role,
            "fund_count": len(fm) if isinstance(fm, dict) else 0,
            "acct_count": len(ma) if isinstance(ma, list) else 0,
            "has_snapshot": u.get("lp_id") in saved,
        })
    lps.sort(key=lambda x: (x["name"] or "").lower())
    return {"lps": lps}


def _planning_payload(lp_id: str) -> dict:
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


def _planning_lp_pack(lp_id: str) -> dict:
    """Own-book payload for the LP portal: no GP strategy notes, no hidden lines."""
    pack = _planning_payload(lp_id)
    snap = dict(pack.get("snapshot") or {})
    snap["notes"] = ""
    snap["rows"] = [r for r in (snap.get("rows") or []) if not r.get("hidden")]
    pack["snapshot"] = snap
    pack.pop("live", None)
    return pack


@router.get("/api/v2/lp/planning")
def lp_planning_self(request: Request):
    """LP-only: this login's planning worksheet. Never another LP's."""
    claims = _lp_only(request)
    return _planning_lp_pack(_caller_lp_id(claims))


@router.get("/api/v2/lp/planning/pdf")
def lp_planning_self_pdf(request: Request):
    """LP-only: PDF of this login's planning worksheet."""
    claims = _lp_only(request)
    pack = _planning_lp_pack(_caller_lp_id(claims))
    try:
        pdf = _planning_pdf_bytes(pack)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF render failed: {e!s:.200}")
    fname = _planning_pdf_filename(pack["lp"], pack["snapshot"])
    try:
        disp_h = B._content_disposition("attachment", fname)
    except Exception:
        disp_h = f'attachment; filename="{fname}"'
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": disp_h},
    )


@router.get("/api/v2/gp/lp-planning/{lp_id}")
def planning_get(lp_id: str, request: Request):
    """GP-only: merged snapshot + live linked books + computed P&L gap."""
    _gp_only(request)
    lp_id = (lp_id or "").strip()
    if not lp_id:
        raise HTTPException(status_code=400, detail="lp_id required")
    return _planning_payload(lp_id)


@router.get("/api/v2/gp/lp-planning/{lp_id}/tax-ytd")
def planning_tax_ytd(lp_id: str, request: Request, year: int | None = None):
    """GP-only: SnapTrade activity tax-YTD for this LP's assigned SMAs.

    Not a 1099. Dividends, interest, fees, withholdings, sell proceeds, and
    line-level Fidelity activity for the calendar year. IRA books stay N/A
    for taxable income. Fund K-1s are not in SnapTrade.
    """
    _gp_only(request)
    lp_id = (lp_id or "").strip()
    if not lp_id:
        raise HTTPException(status_code=400, detail="lp_id required")
    yr = int(year) if year else datetime.now(timezone.utc).year
    if yr < 2000 or yr > 2100:
        raise HTTPException(status_code=400, detail="year out of range")
    user = _lp_user(lp_id)
    live = _live_books(user)
    managed = list(live.get("managed") or [])
    fund_ids = [str(a.get("fund_id")) for a in managed if a.get("fund_id")]
    loader = getattr(B, "_snaptrade_tax_ytd_for_funds", None)
    if not callable(loader):
        raise HTTPException(status_code=503, detail="Tax YTD rollup is not available")
    try:
        pack = loader(fund_ids, yr) or {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Tax YTD failed: {type(e).__name__}: {e!s:.200}",
        ) from e
    by_fid: dict[str, dict] = {}
    for acct in pack.get("accounts") or []:
        fid = str(acct.get("fund_id") or "")
        if fid:
            by_fid.setdefault(fid, []).append(acct)
    accounts = []
    for book in managed:
        fid = str(book.get("fund_id") or "")
        name = book.get("assigned_as") or book.get("name") or ""
        ira = bool(book.get("realized_na") or _is_ira_name(
            name, book.get("short_name") or "", book.get("name") or ""))
        snaps = by_fid.pop(fid, None) or []
        if not snaps:
            accounts.append({
                "fund_id": fid,
                "fund_name": book.get("name") or name,
                "assigned_as": name,
                "account_id": None,
                "account_name": name,
                "brokerage": None,
                "ira": ira,
                "realized_na": ira,
                "missing": True,
                "dividends": 0, "substitute_dividends": 0, "stock_dividends": 0,
                "interest": 0, "fees": 0, "tax_withheld": 0, "sell_proceeds": 0,
                "rei": 0, "return_of_capital": 0, "income_total": 0,
                "lines": [], "by_symbol": [], "by_month": [],
                "line_count": 0, "activity_count": 0,
            })
            continue
        for snap in snaps:
            item = dict(snap)
            item["fund_name"] = book.get("name") or name
            item["assigned_as"] = name
            item["ira"] = ira
            item["realized_na"] = ira
            item["missing"] = False
            if ira:
                item["taxable_income"] = None
            else:
                item["taxable_income"] = item.get("income_total") or 0
            accounts.append(item)
    # SnapTrade accounts assigned to this LP's funds but not in live books.
    for leftover in by_fid.values():
        for snap in leftover:
            item = dict(snap)
            nm = item.get("account_name") or ""
            ira = _is_ira_name(nm)
            item["fund_name"] = nm
            item["assigned_as"] = nm
            item["ira"] = ira
            item["realized_na"] = ira
            item["missing"] = False
            item["taxable_income"] = None if ira else (item.get("income_total") or 0)
            accounts.append(item)

    tot = dict(pack.get("totals") or {})
    taxable_income = 0.0
    has_taxable = False
    for a in accounts:
        if a.get("realized_na"):
            continue
        v = _f(a.get("income_total"), 0) or 0
        taxable_income += v
        has_taxable = True
    lp = _public_lp(user)
    return {
        "lp": lp,
        "year": yr,
        "as_of": pack.get("as_of"),
        "disclaimer": pack.get("disclaimer") or (
            "Not a 1099. Activity-derived calendar-year cash from SnapTrade."
        ),
        "totals": {
            **{k: tot.get(k) or 0 for k in (
                "dividends", "substitute_dividends", "stock_dividends",
                "interest", "fees", "tax_withheld", "sell_proceeds", "rei",
                "return_of_capital", "income_total", "activity_count",
                "line_count",
            )},
            "taxable_income": round(taxable_income, 2) if has_taxable else None,
        },
        "accounts": accounts,
        "unmatched_accounts": live.get("unmatched_accounts") or [],
    }


def _usd_txt(v) -> str:
    n = _f(v)
    if n is None:
        return "—"
    sign = "−" if n < 0 else ""
    return f"{sign}${abs(n):,.0f}"


def _pct_txt(v, ytd=False) -> str:
    n = _f(v)
    if n is None:
        return ""
    sign = "+" if n > 0 else ""
    body = f"{sign}{n:.2f}%"
    return f"{body} YTD" if ytd else body


def _pdf_wrap(text: str, width: int = 28) -> str:
    """Hard-wrap for xhtml2pdf so a cell cannot paint into its neighbor."""
    import html as _html
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if not raw:
        return ""
    cap = max(width * 2, width)
    if len(raw) > cap:
        raw = raw[: cap - 1] + "…"
    lines, cur = [], ""
    for w in raw.split(" "):
        trial = f"{cur} {w}".strip() if cur else w
        if len(trial) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return "<br/>".join(_html.escape(x) for x in lines)


def _pdf_td(inner: str, *, align: str = "right", width: int, extra: str = "",
            colspan: int = 1) -> str:
    span = f' colspan="{colspan}"' if colspan > 1 else ""
    return (
        f'<td{span} align="{align}" width="{width}" '
        f'style="text-align:{align};width:{width}pt;padding:1.5pt 5pt 1.5pt 6pt;'
        f'overflow:hidden;{extra}">{inner}</td>'
    )


def _planning_pdf_filename(lp: dict, snap: dict) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", (lp.get("name") or "LP").strip())[:40]
    as_of = re.sub(r"[^0-9-]", "", snap.get("as_of") or "")[:10]
    return f"DGA_Planning_{name}_{as_of or 'snapshot'}.pdf"


def _planning_pdf_html(pack: dict) -> str:
    import html as _html
    lp = pack.get("lp") or {}
    snap = pack.get("snapshot") or {}
    computed = pack.get("computed") or {}
    logo = ""
    try:
        logo = B._dga_logo_data_uri() or ""
    except Exception:
        logo = ""
    title = _html.escape(snap.get("title") or "Planning snapshot")
    lp_name = _html.escape(lp.get("name") or "")
    as_of = _html.escape(snap.get("as_of") or "")
    notes = _html.escape(snap.get("notes") or "")
    stamp = datetime.now(timezone.utc).strftime("%B %d, %Y")
    # Logo PNG is 240×68 (~3.53:1). xhtml2pdf stretches an <img> to the table
    # cell unless BOTH width and height are set at the native ratio, and the
    # cell itself is no wider than the image.
    img = (
        f'<img src="{logo}" width="88" height="25" alt="DGA Capital" />'
        if logo else
        '<span style="font-weight:bold;color:#0A1628;letter-spacing:1pt;">DGA CAPITAL</span>'
    )
    sections = (
        ("current", "Current assets"),
        ("long_term", "Long-term assets"),
        ("income", "Other annual income"),
        ("liability", "Liabilities"),
    )
    body_rows = []
    vis = [r for r in (snap.get("rows") or []) if not r.get("hidden")]
    tot_tax = 0.0
    has_tax = False
    tot_ytd = 0.0
    has_ytd = False
    for r in vis:
        t = _row_taxable(r)
        if t is not None:
            tot_tax += t
            has_tax = True
        y = _row_ytd_perf(r)
        if y is not None:
            tot_ytd += y
            has_ytd = True
    kpis = [
        ("Net worth", _usd_txt(computed.get("net_worth")),
         f"Assets {_usd_txt(computed.get('total_assets'))} − debt {_usd_txt(computed.get('total_liabilities'))}"),
        ("Investable", _usd_txt(computed.get("investable")), "Checked lines"),
        ("Required P&amp;L", _usd_txt(computed.get("required_generation")),
         f"Expenses {_usd_txt(computed.get('annual_expenses') or snap.get('annual_expenses'))}"),
        ("Taxable P&amp;L", _usd_txt(tot_tax) if has_tax else "—",
         f"YTD performance (unrealized) {_usd_txt(tot_ytd) if has_ytd else '—'}"),
        ("Gap vs expenses", _usd_txt(computed.get("surplus")),
         f"vs {_usd_txt(computed.get('annual_expenses') or snap.get('annual_expenses'))}"),
    ]
    kpi_cells = []
    for lab, val, hint in kpis:
        kpi_cells.append(
            f'<td style="border:1px solid #e2e8f0;padding:3pt 5pt;width:20%;">'
            f'<div style="font-size:5.5pt;color:#64748b;text-transform:uppercase;'
            f'letter-spacing:0.4pt;font-weight:bold;">{lab}</div>'
            f'<div style="font-size:8.5pt;font-weight:bold;color:#0A1628;margin-top:1pt;">{val}</div>'
            f'<div style="font-size:5.5pt;color:#94a3b8;margin-top:1pt;">{hint}</div>'
            f"</td>"
        )
    kpi_cells = "".join(kpi_cells)
    for key, label in sections:
        chunk = [r for r in vis if r.get("section") == key]
        if not chunk:
            continue
        sub = sum(_row_amount(r) for r in chunk)
        body_rows.append(
            f'<tr><td colspan="9" style="background-color:#E8F6FA;font-weight:bold;'
            f'font-size:6.5pt;letter-spacing:0.4pt;text-transform:uppercase;'
            f'color:#0A1628;padding:2pt 5pt;">{_html.escape(label)}'
            f' &nbsp; {_usd_txt(sub)}</td></tr>'
        )
        for r in chunk:
            amt = _row_amount(r)
            yld = _row_yield(r)
            est = _row_pnl_est(r)
            tax = _row_taxable(r)
            ytd = _row_ytd_perf(r)
            ira = bool(r.get("realized_na") or _is_ira_name(r.get("label") or ""))
            if r.get("section") in ("liability", "long_term"):
                tax_s = ""
            elif ira and r.get("section") != "income":
                tax_s = "N/A"
            else:
                tax_s = _usd_txt(tax) if tax is not None else ""
            ytd_s = ""
            if ytd is not None:
                ytd_s = _usd_txt(ytd)
                yp = _f(r.get("ytd_pct"))
                if yp is not None:
                    ytd_s += f" ({_pct_txt(yp)})"
            inv = "✓" if r.get("include_in_investments") and r.get("section") in ("current", "long_term") else ""
            pct = r.get("pct_total")
            pct_s = f"{pct:.1f}%" if _f(pct) is not None else ""
            yld_s = (
                f"{yld:g}%"
                if yld is not None and r.get("section") not in ("income", "long_term")
                else ""
            )
            est_s = _usd_txt(est) if est is not None else ""
            note = _pdf_wrap(r.get("notes") or "", 26)
            lab = _pdf_wrap(r.get("label") or "", 22)
            ytd_html = ytd_s.replace(" (", "<br/>(") if " (" in ytd_s else ytd_s
            body_rows.append(
                "<tr>"
                + _pdf_td(lab, align="left", width=128)
                + _pdf_td(inv, align="center", width=24)
                + _pdf_td(_usd_txt(amt), width=76)
                + _pdf_td(pct_s, width=40)
                + _pdf_td(yld_s, width=40)
                + _pdf_td(est_s, width=68)
                + _pdf_td(tax_s, width=76)
                + _pdf_td(note, width=168)
                + _pdf_td(ytd_html, width=120)
                + "</tr>"
            )
    tot_note = _pdf_wrap("(Income ytd)" if _f(computed.get("other_income")) else "", 26)
    body_rows.append(
        '<tr style="font-weight:bold;background-color:#F8FAFC;">'
        + _pdf_td("Equity / net worth", align="left", width=152, extra="font-weight:bold;",
                  colspan=2)
        + _pdf_td(_usd_txt(computed.get("net_worth")), width=76, extra="font-weight:bold;")
        + _pdf_td("", width=40)
        + _pdf_td("", width=40)
        + _pdf_td(_usd_txt(computed.get("pnl_estimate")), width=68, extra="font-weight:bold;")
        + _pdf_td(_usd_txt(tot_tax) if has_tax else "—", width=76, extra="font-weight:bold;")
        + _pdf_td(tot_note, width=168, extra="font-weight:bold;")
        + _pdf_td(_usd_txt(tot_ytd) if has_ytd else "—", width=120, extra="font-weight:bold;")
        + "</tr>"
    )
    notes_cut = notes[:280] + ("…" if len(notes) > 280 else "")
    notes_html = (
        f'<div style="margin-top:6pt;font-size:7pt;color:#334155;">'
        f'<div style="font-weight:bold;color:#64748b;font-size:6pt;letter-spacing:0.4pt;'
        f'text-transform:uppercase;margin-bottom:1pt;">Strategy notes</div>'
        f'{notes_cut.replace(chr(10), "<br/>")}</div>'
        if notes else ""
    )
    css = """
      @font-face { font-family: "InterPdf"; src: url(Inter-Regular.ttf); }
      @font-face { font-family: "InterPdf"; src: url(Inter-Bold.ttf); font-weight: bold; }
      @page { size: landscape letter; margin: 0.28in; }
      body { font-family: "InterPdf", Helvetica, Arial; font-size: 7pt; color: #334155; }
      table.sheet { width: 740pt; border-collapse: collapse; table-layout: fixed; }
      table.sheet th {
        font-size: 5.5pt; letter-spacing: 0.3pt; text-transform: uppercase;
        color: #64748b; border-bottom: 0.6pt solid #cbd5e1;
        padding: 2pt 5pt 2pt 6pt; overflow: hidden;
      }
      table.sheet td { border-bottom: 0.3pt solid #e2e8f0; font-size: 7pt; overflow: hidden; }
    """
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{css}</style></head><body>"
        '<table style="width:100%;border:none;margin-bottom:4pt;"><tr>'
        f'<td style="border:none;width:96pt;vertical-align:middle;">{img}'
        f'<div style="font-size:6pt;color:#5BB8D4;font-weight:bold;letter-spacing:0.6pt;'
        f'text-transform:uppercase;margin-top:1pt;">Planning snapshot</div></td>'
        f'<td style="border:none;text-align:right;vertical-align:middle;">'
        f'<div style="font-size:10pt;font-weight:bold;color:#0A1628;">{title}</div>'
        f'<div style="font-size:7pt;color:#64748b;">{lp_name}'
        f'{" · as of " + as_of if as_of else ""} · {stamp}</div></td>'
        "</tr></table>"
        f'<table style="width:100%;border-collapse:collapse;margin-bottom:5pt;"><tr>{kpi_cells}</tr></table>'
        '<table class="sheet">'
        "<colgroup>"
        '<col width="128" /><col width="24" /><col width="76" />'
        '<col width="40" /><col width="40" /><col width="68" />'
        '<col width="76" /><col width="168" /><col width="120" />'
        "</colgroup>"
        "<thead><tr>"
        "<th align='left' style='text-align:left;width:128pt;'>Line</th>"
        "<th align='center' style='text-align:center;width:24pt;'>Inv</th>"
        "<th align='right' style='text-align:right;width:76pt;'>Amount</th>"
        "<th align='right' style='text-align:right;width:40pt;'>% Tot</th>"
        "<th align='right' style='text-align:right;width:40pt;'>Yld %</th>"
        "<th align='right' style='text-align:right;width:68pt;'>P&amp;L est</th>"
        "<th align='right' style='text-align:right;width:76pt;'>P&amp;L actual</th>"
        "<th align='right' style='text-align:right;width:168pt;'>Notes</th>"
        "<th align='right' style='text-align:right;width:120pt;'>YTD<br/>(unrealized)</th>"
        "</tr></thead><tbody>"
        + "".join(body_rows)
        + "</tbody></table>"
        + notes_html
        + '<div style="margin-top:5pt;font-size:6pt;color:#94a3b8;">'
        "DGA Capital · Confidential — for the intended recipient only. "
        "Not investment advice. P&amp;L actual is the taxable realized event; "
        "YTD performance is mark-to-market plus dividends (unrealized).</div>"
        "</body></html>"
    )


def _planning_pdf_bytes(pack: dict) -> bytes:
    html_doc = _planning_pdf_html(pack)
    try:
        return B._render_research_pdf(html_doc)
    except Exception:
        from xhtml2pdf import pisa
        import io as _io
        out = _io.BytesIO()
        result = pisa.CreatePDF(src=html_doc, dest=out, encoding="utf-8")
        if result.err or not out.getvalue():
            raise RuntimeError("PDF render failed")
        return out.getvalue()


@router.get("/api/v2/gp/lp-planning/{lp_id}/pdf")
def planning_pdf(lp_id: str, request: Request):
    """GP-only: landscape PDF of the household planning snapshot."""
    _gp_only(request)
    lp_id = (lp_id or "").strip()
    if not lp_id:
        raise HTTPException(status_code=400, detail="lp_id required")
    pack = _planning_payload(lp_id)
    try:
        pdf = _planning_pdf_bytes(pack)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF render failed: {e!s:.200}")
    fname = _planning_pdf_filename(pack["lp"], pack["snapshot"])
    try:
        disp_h = B._content_disposition("attachment", fname)
    except Exception:
        disp_h = f'attachment; filename="{fname}"'
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": disp_h},
    )


class PlanningEmailIn(BaseModel):
    to: str
    subject: str = ""


@router.post("/api/v2/gp/lp-planning/{lp_id}/email")
def planning_email(lp_id: str, request: Request, body: PlanningEmailIn):
    """GP-only: email the planning snapshot PDF. Recipient is required (no auto-send)."""
    claims = _gp_only(request)
    if claims.get("demo_mode"):
        raise HTTPException(status_code=403, detail="Write operations disabled in demo mode")
    lp_id = (lp_id or "").strip()
    if not lp_id:
        raise HTTPException(status_code=400, detail="lp_id required")
    to_addr = (body.to or "").strip()
    valid = True
    try:
        valid = bool(B._valid_email_addr(to_addr))
    except Exception:
        valid = "@" in to_addr and "." in to_addr.split("@")[-1]
    if not valid:
        raise HTTPException(status_code=400, detail="A valid recipient email is required.")
    pack = _planning_payload(lp_id)
    try:
        pdf = _planning_pdf_bytes(pack)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF render failed: {e!s:.200}")
    lp = pack["lp"]
    snap = pack["snapshot"]
    fname = _planning_pdf_filename(lp, snap)
    name = lp.get("name") or "client"
    import html as _html
    doc = _html.escape(snap.get("title") or "planning snapshot")
    subject = (body.subject or f"DGA Capital — {snap.get('title') or 'Planning snapshot'}").strip()
    email_html = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
        'color:#0A1628;max-width:560px;">'
        '<div style="background:#0A1628;padding:16px 18px;border-radius:8px 8px 0 0;">'
        '<div style="color:#fff;font-weight:800;font-size:15px;letter-spacing:0.6px;">DGA CAPITAL</div>'
        '<div style="color:#5BB8D4;font-size:11px;font-weight:700;letter-spacing:0.8px;'
        'text-transform:uppercase;margin-top:3px;">Planning snapshot</div>'
        '</div>'
        '<div style="border:1px solid #e2e8f0;border-top:3px solid #5BB8D4;'
        'padding:16px 18px;border-radius:0 0 8px 8px;">'
        f'<p style="margin:0 0 12px;font-size:14px;line-height:1.5;">'
        f'Please find the attached <strong>{doc}</strong> for '
        f'{_html.escape(name)}.</p>'
        '<p style="color:#94a3b8;font-size:11px;margin:0;line-height:1.45;">'
        'DGA Capital · Confidential — for the intended recipient only. '
        'Not investment advice.</p></div></div>'
    )
    try:
        res = B._send_email_with_pdf_attachment(to_addr, subject, email_html, pdf, fname)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Email send failed: {e!s:.200}")
    if not res or not res.get("ok"):
        raise HTTPException(status_code=502, detail=(res or {}).get("error") or "Email send failed")
    return {"ok": True, "sent_to": to_addr, "transport": res.get("transport")}


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
    capital_gains: float | None = None


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
