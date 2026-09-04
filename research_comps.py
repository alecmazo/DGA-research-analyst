"""Comparable companies from company_financials — last reported FY, not (E)/NTM.

Used by the IB Excel model, saved-report markdown, and the analyst prompt so
comps never invent estimated multiples when the Financials store has actuals.
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional


def _f(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:
        return None
    return x


def _millions(v: Optional[float]) -> Optional[float]:
    """DB dollars → $ millions. Share counts stay counts."""
    if v is None:
        return None
    if abs(v) >= 100_000:
        return v / 1_000_000.0
    return v


def _shares(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    if abs(v) >= 100_000:
        return v / 1_000_000.0
    return v


def _conn():
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        return None
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor  # noqa: F401
    except ImportError:
        return None
    try:
        conn = psycopg2.connect(
            url, connect_timeout=8, options="-c statement_timeout=12000"
        )
        conn.autocommit = True
        return conn
    except Exception as e:
        print(f"[research_comps] connect: {e!s:.160}", flush=True)
        return None


def _quotes(symbols: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    if not symbols:
        return out
    conn = _conn()
    if conn is not None:
        try:
            from psycopg2.extras import RealDictCursor
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT symbol, price FROM market_quotes WHERE symbol = ANY(%s)",
                    (symbols,),
                )
                for r in cur.fetchall() or []:
                    px = _f(r.get("price"))
                    if px:
                        out[(r.get("symbol") or "").upper()] = px
        except Exception as e:
            print(f"[research_comps] quotes: {e!s:.120}", flush=True)
        finally:
            try:
                conn.close()
            except Exception:
                pass
    missing = [s for s in symbols if s not in out]
    if missing:
        try:
            import market_data as md
            got = md.get_quotes(missing) or {}
            for s, q in got.items():
                px = _f((q or {}).get("price"))
                if px:
                    out[str(s).upper()] = px
        except Exception:
            pass
    return out


def _row(tkr: str, fin: dict, price: Optional[float], *, is_subject: bool, name: str = "") -> dict:
    sh = _shares(_f(fin.get("shares_outstanding")) or _f(fin.get("diluted_shares")))
    # shares() already converted large counts to millions
    shares_m = sh
    eps = _f(fin.get("diluted_eps"))
    ni = _millions(_f(fin.get("net_income")))
    if eps is None and ni is not None and shares_m:
        eps = ni / shares_m
    rev = _millions(_f(fin.get("revenue")))
    ebitda = _millions(_f(fin.get("ebitda")))
    fcf = _millions(_f(fin.get("free_cash_flow")))
    debt = _millions(
        _f(fin.get("total_debt"))
        or (
            (_f(fin.get("long_term_debt")) or 0)
            + (_f(fin.get("short_term_debt")) or 0)
            or None
        )
    )
    cash = _millions(
        (_f(fin.get("cash")) or 0) + (_f(fin.get("short_term_investments")) or 0)
    ) or 0.0
    mkt = (price * shares_m) if (price and shares_m) else None
    ev = (mkt + (debt or 0.0) - cash) if mkt is not None else None
    pe = (price / eps) if (price and eps and eps > 0) else None
    pe_nm = bool(eps is not None and eps <= 0 and price is not None)
    ev_eb = (ev / ebitda) if (ev is not None and ebitda and ebitda > 0) else None
    ev_sales = (ev / rev) if (ev is not None and rev and rev > 0) else None
    fcf_y = (fcf / mkt) if (fcf is not None and mkt and mkt > 0) else None
    nm = _f(fin.get("net_margin"))
    if nm is not None and abs(nm) <= 2:
        nm_pct = nm * 100.0
    elif nm is not None:
        nm_pct = nm
    elif ni is not None and rev not in (None, 0):
        nm_pct = ni / rev * 100.0
    else:
        nm_pct = None
    em = _f(fin.get("ebitda_margin"))
    if em is not None and abs(em) <= 2:
        ebitda_mgn = em * 100.0
    elif em is not None:
        ebitda_mgn = em
    elif ebitda is not None and rev not in (None, 0):
        ebitda_mgn = ebitda / rev * 100.0
    else:
        ebitda_mgn = None
    fy = fin.get("fy")
    try:
        fy_i = int(fy) if fy is not None else None
    except (TypeError, ValueError):
        fy_i = None
    return {
        "ticker": tkr,
        "name": name or fin.get("entity_name") or tkr,
        "is_subject": is_subject,
        "price": round(price, 2) if price is not None else None,
        "market_cap_m": round(mkt, 1) if mkt is not None else None,
        "ev_m": round(ev, 1) if ev is not None else None,
        "pe": round(pe, 1) if pe is not None else None,
        "pe_nm": pe_nm,
        "ev_ebitda": round(ev_eb, 1) if ev_eb is not None else None,
        "ev_sales": round(ev_sales, 1) if ev_sales is not None else None,
        "fcf_yield": round(fcf_y, 4) if fcf_y is not None else None,
        "net_margin_pct": round(nm_pct, 1) if nm_pct is not None else None,
        "ebitda_margin_pct": round(ebitda_mgn, 1) if ebitda_mgn is not None else None,
        "rev_yoy_pct": None,
        "revenue_m": round(rev, 1) if rev is not None else None,
        "fy": fy_i,
        "period_end": str(fin.get("period_end") or "")[:10],
        "_rev": rev,
    }


def load(ticker: str, limit: int = 8) -> dict[str, Any]:
    """Last-reported-FY comps from company_financials + live last price."""
    tk = (ticker or "").strip().upper()
    out: dict[str, Any] = {
        "ticker": tk, "sector": None, "industry": None, "note": None,
        "peers": [], "source": "company_financials",
    }
    if not tk:
        return out
    conn = _conn()
    if conn is None:
        return out
    try:
        from psycopg2.extras import RealDictCursor
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT symbol, name, sector, industry FROM security_meta WHERE symbol=%s",
                (tk,),
            )
            meta = cur.fetchone() or {}
            sector = (meta.get("sector") or "").strip() or None
            industry = (meta.get("industry") or "").strip() or None
            out["sector"] = sector
            out["industry"] = industry

            peers_meta = []
            if industry:
                cur.execute(
                    """SELECT symbol, name, sector, industry FROM security_meta
                        WHERE industry=%s AND symbol<>%s LIMIT 80""",
                    (industry, tk),
                )
                peers_meta.extend(cur.fetchall() or [])
            if sector:
                cur.execute(
                    """SELECT symbol, name, sector, industry FROM security_meta
                        WHERE sector=%s AND symbol<>%s LIMIT 120""",
                    (sector, tk),
                )
                seen = {(p.get("symbol") or "").upper() for p in peers_meta}
                for r in cur.fetchall() or []:
                    s = (r.get("symbol") or "").upper()
                    if s and s not in seen:
                        peers_meta.append(r)
                        seen.add(s)

            cand = list({(p.get("symbol") or "").upper()
                         for p in peers_meta if p.get("symbol")})
            try:
                from peer_comps import resolve_peer_tickers
                seed = resolve_peer_tickers(
                    tk, sector=sector, industry=industry, limit=16,
                )
                for p in seed.get("peers") or []:
                    if p not in cand:
                        cand.append(p)
            except Exception:
                pass
            cand = [tk] + [c for c in cand if c != tk]

            fin_map: dict[str, dict] = {}
            prior_rev: dict[str, Optional[float]] = {}
            if cand:
                cur.execute(
                    """
                    SELECT DISTINCT ON (ticker)
                           ticker, entity_name, revenue, net_income, ebitda,
                           operating_income, free_cash_flow, diluted_eps,
                           diluted_shares, shares_outstanding, total_debt,
                           long_term_debt, short_term_debt, cash,
                           short_term_investments, stockholders_equity,
                           net_margin, ebitda_margin, period_end, fy
                      FROM company_financials
                     WHERE ticker = ANY(%s) AND period_type='annual'
                     ORDER BY ticker, period_end DESC
                    """,
                    (cand,),
                )
                for r in cur.fetchall() or []:
                    fin_map[(r.get("ticker") or "").upper()] = dict(r)
                cur.execute(
                    """
                    SELECT ticker, revenue, period_end FROM company_financials
                     WHERE ticker = ANY(%s) AND period_type='annual'
                     ORDER BY ticker, period_end DESC
                    """,
                    (list(fin_map.keys()) or cand,),
                )
                seen_n: dict[str, int] = {}
                for r in cur.fetchall() or []:
                    t = (r.get("ticker") or "").upper()
                    seen_n[t] = seen_n.get(t, 0) + 1
                    if seen_n[t] == 2:
                        prior_rev[t] = _millions(_f(r.get("revenue")))
        name_by = {(p.get("symbol") or "").upper(): (p.get("name") or "")
                   for p in peers_meta}
        quotes = _quotes(list(fin_map.keys()) or [tk])
        subject_fin = fin_map.get(tk) or {}
        sub_row = _row(
            tk, subject_fin, quotes.get(tk),
            is_subject=True,
            name=name_by.get(tk) or (subject_fin.get("entity_name") or tk),
        )
        if sub_row["_rev"] and prior_rev.get(tk):
            pr = prior_rev[tk]
            if pr and pr > 0:
                sub_row["rev_yoy_pct"] = round((sub_row["_rev"] / pr - 1.0) * 100.0, 1)

        cand_meta = []
        for s in cand:
            fin = fin_map.get(s)
            mcap_d = None
            if fin:
                rr = _row(s, fin, quotes.get(s), is_subject=False)
                if rr.get("market_cap_m") is not None:
                    mcap_d = rr["market_cap_m"] * 1_000_000.0
            cand_meta.append({
                "symbol": s, "sector": sector, "industry": industry,
                "market_cap": mcap_d,
            })

        ordered: list[str] = []
        note = None
        try:
            from peer_comps import resolve_peer_tickers, format_peer_rationale
            resolved = resolve_peer_tickers(
                tk, sector=sector, industry=industry,
                subject_mcap=(sub_row.get("market_cap_m") or 0) * 1_000_000.0
                if sub_row.get("market_cap_m") else None,
                candidate_meta=cand_meta,
                limit=max(limit * 2, 12),
            )
            ordered = list(resolved.get("peers") or [])
            note = format_peer_rationale(resolved)
        except Exception as e:
            print(f"[research_comps] resolve: {e!s:.120}", flush=True)
            ordered = [c for c in cand if c != tk]

        rows = [sub_row] if subject_fin else []
        rank = {t: i for i, t in enumerate(ordered)}
        extras = []
        for t in ordered:
            fin = fin_map.get(t)
            if not fin:
                continue
            rr = _row(
                t, fin, quotes.get(t), is_subject=False,
                name=name_by.get(t) or (fin.get("entity_name") or t),
            )
            if rr["_rev"] and prior_rev.get(t):
                pr = prior_rev[t]
                if pr and pr > 0:
                    rr["rev_yoy_pct"] = round((rr["_rev"] / pr - 1.0) * 100.0, 1)
            extras.append(rr)
        extras.sort(key=lambda r: rank.get(r["ticker"], 999))
        rows.extend(extras[: max(0, limit)])
        for r in rows:
            r.pop("_rev", None)
        out["peers"] = rows
        out["note"] = (
            (note or "Same industry / business model + similar scale.")
            + " Figures are last reported fiscal year from company_financials "
            "and live last price — not NTM, not (E)."
        )
        return out
    except Exception as e:
        print(f"[research_comps] load {tk}: {e!s:.160}", flush=True)
        return out
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _fmt_px(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"${v:,.2f}" if v < 100 else f"${v:,.0f}"


def _fmt_mm(v: Optional[float]) -> str:
    if v is None:
        return "—"
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:,.1f}"


def _fmt_x(v: Optional[float], nm: bool = False) -> str:
    if v is None:
        return "n/m" if nm else "—"
    return f"{v:.1f}x"


def _fmt_pct(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"{v:+.1f}%" if abs(v) < 200 else f"{v:.0f}%"


def _fmt_yield(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"{v * 100:.1f}%"


def format_markdown_table(data: dict) -> str:
    """GFM comps table. Last reported FY + live price. No (E), no NTM."""
    peers = list((data or {}).get("peers") or [])
    if not peers:
        return ""
    note = (data or {}).get("note") or (
        "Last reported FY from company_financials; live last price. Not NTM / not (E)."
    )
    lines = [
        f"**Comparable companies (last reported FY + live last — company_financials)**",
        "",
        note,
        "",
        "| Ticker | Price | Mkt cap ($m) | EV ($m) | P/E | EV/EBITDA | EV/Sales | FCF yield | Rev YoY | FY |",
        "|--------|------:|-------------:|--------:|----:|----------:|---------:|----------:|--------:|:--:|",
    ]
    for p in peers:
        tk = p.get("ticker") or ""
        if p.get("is_subject"):
            tk = f"**{tk}**"
        fy = p.get("fy") or "—"
        lines.append(
            "| "
            + " | ".join([
                tk,
                _fmt_px(p.get("price")),
                _fmt_mm(p.get("market_cap_m")),
                _fmt_mm(p.get("ev_m")),
                _fmt_x(p.get("pe"), bool(p.get("pe_nm"))),
                _fmt_x(p.get("ev_ebitda")),
                _fmt_x(p.get("ev_sales")),
                _fmt_yield(p.get("fcf_yield")),
                _fmt_pct(p.get("rev_yoy_pct")),
                str(fy),
            ])
            + " |"
        )
    lines.append("")
    lines.append(
        "_Blanks are missing filings, not estimates. Do not fill with NTM or (E)._"
    )
    return "\n".join(lines)


_COMPS_HDR = re.compile(
    r"\|\s*(ticker|company)\b.*\|\s*(p/?e|ev/|fcf yield|market cap)",
    re.I,
)


def _is_comps_header(line: str) -> bool:
    if "|" not in line:
        return False
    h = line.lower()
    if "firm" in h and "rating" in h:
        return False
    if "method" in h and "weight" in h:
        return False
    has_name = "ticker" in h or "company" in h
    has_mult = any(
        x in h for x in ("p/e", "ev/ebitda", "ev/sales", "ev/rev", "fcf yield", "market cap")
    )
    return has_name and has_mult


def replace_in_report(md: str, ticker: str, data: dict | None = None) -> str:
    """Swap every comps table in a saved report for store actuals."""
    data = data if data is not None else load(ticker)
    if len(data.get("peers") or []) < 2:
        return md
    table = format_markdown_table(data)
    if not table:
        return md
    lines = (md or "").replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i, n = 0, len(lines)
    replaced = False
    while i < n:
        if _is_comps_header(lines[i]):
            j = i + 1
            while j < n and "|" in lines[j]:
                j += 1
            if not replaced:
                # drop a leftover "NTM" / "(E)" caption line immediately above
                if out and re.search(r"\bNTM\b|\(E\)|model estimate", out[-1], re.I):
                    out.pop()
                out.append(table)
                replaced = True
            i = j
            continue
        out.append(lines[i])
        i += 1
    if not replaced:
        # No comps table in the note — append under valuation if present.
        text = "\n".join(out)
        m = re.search(r"(^|\n)(#{1,3}\s+SECTION\s+7[^\n]*VALUATION[^\n]*\n)", text, re.I)
        if m:
            insert_at = m.end()
            return text[:insert_at] + "\n" + table + "\n" + text[insert_at:]
        return text + "\n\n" + table + "\n"
    return "\n".join(out)


def prompt_block(ticker: str, **_kwargs) -> str:
    """Analyst prompt: exact last-FY comps. Do not mark (E) when a figure exists."""
    data = load(ticker)
    table = format_markdown_table(data)
    if not table:
        return ""
    return (
        "## VERIFIED COMPS (company_financials — last reported FY + live last)\n\n"
        "Use these EXACT figures in Section 7B Comparable Companies. "
        "They are reported actuals (and live last price), **not NTM and not (E)**. "
        "If a cell is —, leave it blank. Do not invent a multiple. "
        "Do not label these rows as estimates.\n\n"
        + table
    )
