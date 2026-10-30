"""Live readers. Nothing in this module runs at import, and tests do not call it.

Prices try the stored history, then yfinance, then Stooq. EDGAR uses the
merger-arb search URL and the SEC user agent already required by the desk.
There is no S&P 1500 file in the repo, so the weekly book is holdings,
watchlists, saved reports, and the extra tickers in settings. A 5-year
valuation is left blank when the store has no history for it. The first
13F parse is a baseline and writes no cards.
"""

from __future__ import annotations

import json
import os
import time
from datetime import date, timedelta
from urllib.request import Request, urlopen

from ideas_cards.catalog import ETF_MATCH, PRICE_ETFS
from ideas_cards.pipeline import cards_for_bundle, polish_cards
from ideas_cards.scanners import session_return

UNIVERSE_CAP = 400


class StageError(Exception):
    pass


def grok_call_cost(prompt_tokens, completion_tokens, rates, *, search: bool = False,
                   search_fee: float = 0.025) -> float:
    """Dollar cost from explicit per-million rates. Search adds one flat fee."""
    inp, outp = rates
    cost = (float(prompt_tokens) / 1_000_000.0) * float(inp)
    cost += (float(completion_tokens) / 1_000_000.0) * float(outp)
    if search:
        cost += float(search_fee)
    return round(cost, 6)


def matching_etfs(sector: str, industry: str) -> list[str]:
    blob = f"{sector or ''} {industry or ''}".lower()
    hits = []
    for etf, needles in ETF_MATCH.items():
        if any(needle in blob for needle in needles):
            hits.append(etf)
    return hits


def constituent_metrics(ticker, name, price, diluted_eps, total_debt, equity, pe_5y=None) -> dict:
    pe = None
    try:
        if price is not None and diluted_eps is not None and float(diluted_eps) > 0:
            pe = float(price) / float(diluted_eps)
    except (TypeError, ValueError):
        pe = None
    debt_to_equity = None
    try:
        if total_debt is not None and equity is not None and float(equity) > 0:
            debt_to_equity = float(total_debt) / float(equity)
    except (TypeError, ValueError):
        debt_to_equity = None
    return {
        "ticker": (ticker or "").upper(),
        "name": name or ticker or "",
        "pe": pe,
        "pe_5y": pe_5y,
        "debt_to_equity": debt_to_equity,
        "current_ratio": None,
    }


def weekly_universe(*groups, cap: int = UNIVERSE_CAP) -> list[str]:
    out = []
    seen = set()
    for group in groups:
        for raw in group or []:
            ticker = str(raw or "").strip().upper()
            if not ticker or ticker in seen or ticker in {"—", "-"}:
                continue
            seen.add(ticker)
            out.append(ticker)
            if len(out) >= cap:
                return out
    return out


def parse_stooq_csv(text: str) -> list[dict]:
    rows = []
    for line in (text or "").splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 5 or parts[0].lower() == "date":
            continue
        try:
            close = float(parts[4])
        except ValueError:
            continue
        if close <= 0:
            continue
        rows.append({"date": parts[0][:10], "close": close})
    return rows


def tickers_from_holdings(payload) -> list[str]:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return []
    if isinstance(payload, list):
        out = []
        for row in payload:
            out.extend(tickers_from_holdings(row))
        return out
    if not isinstance(payload, dict):
        return []
    out = []
    sym = payload.get("symbol") or payload.get("ticker") or payload.get("ticker_symbol")
    if sym and str(sym).strip() not in {"", "—", "-"}:
        out.append(str(sym))
    for key in ("holdings", "positions", "securities"):
        if isinstance(payload.get(key), list):
            out.extend(tickers_from_holdings(payload[key]))
    return out


def load_bars(symbol: str, *, db_fn=None, yf_fn=None, stooq_fn=None) -> list:
    rows: list = []
    for fn in (db_fn, yf_fn, stooq_fn):
        if fn is None or len(rows) >= 60:
            continue
        try:
            got = fn(symbol) or []
        except Exception:
            got = []
        if len(got) > len(rows):
            rows = got
    return rows


def _http(url: str, headers: dict, timeout: float = 12.0) -> bytes:
    request = Request(url, headers=headers)
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def _sec_headers() -> dict:
    from DGA_analyst import get_sec_user_agent
    ua = (get_sec_user_agent() or "").strip()
    if not ua:
        raise StageError("SEC user agent is not configured")
    return {"User-Agent": ua, "Accept": "application/json,text/xml,application/xml,text/html,*/*"}


def _db_bars(symbol: str) -> list:
    import api.server as server
    with server._fund_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT d, close FROM price_history
            WHERE upper(symbol) = %s AND d >= CURRENT_DATE - INTERVAL '420 days'
            ORDER BY d
            """,
            (symbol.upper(),),
        )
        rows = []
        for day, close in cur.fetchall():
            if close is None:
                continue
            stamp = day.isoformat() if hasattr(day, "isoformat") else str(day)[:10]
            rows.append({"date": stamp, "close": float(close)})
        return rows


def _yf_bars(symbol: str) -> list:
    from market_data import _yf_history
    return _yf_history(symbol, "2y", "1d") or []


def _stooq_bars(symbol: str) -> list:
    url = f"https://stooq.com/q/d/l/?s={symbol.lower()}.us&i=d"
    text = _http(url, {"User-Agent": "DGA-ideas/1.0"}, timeout=8).decode("utf-8", "replace")
    return parse_stooq_csv(text)


def _bars(symbol: str) -> list:
    return load_bars(symbol, db_fn=_db_bars, yf_fn=_yf_bars, stooq_fn=_stooq_bars)


def _fred_unemployment():
    key = (os.environ.get("FRED_API_KEY") or "").strip()
    if not key:
        return None
    url = (
        "https://api.stlouisfed.org/fred/series/observations"
        f"?series_id=UNRATE&api_key={key}&file_type=json&limit=1&sort_order=desc"
    )
    try:
        payload = json.loads(_http(url, {"User-Agent": "DGA-ideas/1.0"}).decode("utf-8", "replace"))
        value = ((payload.get("observations") or [{}])[0]).get("value")
        return float(value)
    except Exception:
        return None


def _constituents() -> dict:
    try:
        import api.server as server
        with server._fund_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT m.symbol, m.name, m.sector, m.industry,
                       f.diluted_eps, f.total_debt, f.stockholders_equity
                FROM security_meta m
                LEFT JOIN LATERAL (
                    SELECT diluted_eps, total_debt, stockholders_equity
                    FROM company_financials
                    WHERE ticker = m.symbol AND period_type = 'annual'
                    ORDER BY period_end DESC
                    LIMIT 1
                ) f ON true
            """)
            rows = cur.fetchall()
        symbols = [row[0] for row in rows if row and row[0]]
        try:
            quotes = server._db_quotes(symbols) or {}
        except Exception:
            quotes = {}
    except Exception:
        return {}
    books = {etf: [] for etf in PRICE_ETFS}
    for symbol, name, sector, industry, eps, debt, equity in rows:
        etfs = matching_etfs(sector or "", industry or "")
        if not etfs:
            continue
        price = (quotes.get((symbol or "").upper()) or {}).get("price")
        metrics = constituent_metrics(symbol, name, price, eps, debt, equity, pe_5y=None)
        for etf in etfs:
            if etf in books:
                books[etf].append(metrics)
    return books


def build_sector_bundle(settings: dict) -> dict:
    prices = {symbol: _bars(symbol) for symbol in ("SPY", *PRICE_ETFS)}
    if len(prices.get("SPY") or []) < 60:
        raise StageError("SPY history is shorter than 60 sessions")
    macro = {}
    unemployment = _fred_unemployment()
    if unemployment is not None:
        macro["unemployment"] = unemployment
    return {"prices": prices, "constituents": _constituents(), "macro": macro}


def _query_tickers(sql: str) -> list[str]:
    try:
        import api.server as server
        with server._fund_conn() as conn, conn.cursor() as cur:
            cur.execute(sql)
            return [row[0] for row in cur.fetchall() if row and row[0]]
    except Exception:
        return []


def _holding_groups() -> list[str]:
    out = []
    try:
        import api.server as server
        with server._fund_conn() as conn, conn.cursor() as cur:
            for table in ("snaptrade_accounts", "plaid_items"):
                try:
                    cur.execute(f"SELECT holdings_json FROM {table}")
                    for (payload,) in cur.fetchall():
                        out.extend(tickers_from_holdings(payload))
                except Exception:
                    conn.rollback()
    except Exception:
        return []
    return out


def _watchlist() -> list[str]:
    try:
        import api.server as server
        return list(server._all_watchlist_tickers() or [])
    except Exception:
        return []


def _shares(ticker: str):
    try:
        import api.server as server
        with server._fund_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT shares_outstanding FROM company_financials
                WHERE ticker = %s AND period_type = 'annual' AND shares_outstanding IS NOT NULL
                ORDER BY period_end DESC LIMIT 1
                """,
                (ticker.upper(),),
            )
            row = cur.fetchone()
        if not row or row[0] is None:
            return None
        return float(row[0])
    except Exception:
        return None


def _yf_cap(ticker: str) -> float:
    import yfinance as yf
    info = getattr(yf.Ticker(ticker), "fast_info", None)
    cap = getattr(info, "market_cap", None)
    if cap is None and isinstance(info, dict):
        cap = info.get("market_cap") or info.get("marketCap")
    return float(cap or 0)


def _cap(ticker: str, bars: list) -> float:
    price = None
    if bars:
        try:
            price = float(bars[-1].get("close"))
        except (TypeError, ValueError, AttributeError):
            price = None
    shares = _shares(ticker)
    if price and shares and shares > 0:
        return price * shares
    try:
        return _yf_cap(ticker)
    except Exception:
        return 0.0


def _headlines(ticker: str) -> tuple[list[str], list[str]]:
    try:
        from api.domains.yahoo_finance_news import fetch_yahoo_finance_news
        rows = fetch_yahoo_finance_news(ticker, limit=4) or []
    except Exception:
        return [], []
    titles = [str(row.get("title") or "") for row in rows if row.get("title")]
    urls = [str(row.get("link") or "") for row in rows if row.get("title")]
    return titles[:4], urls[:4]


def _sector_for(tickers: list[str]) -> dict[str, str]:
    if not tickers:
        return {}
    try:
        import api.server as server
        with server._fund_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT symbol, sector, industry FROM security_meta WHERE upper(symbol) = ANY(%s)",
                ([ticker.upper() for ticker in tickers],),
            )
            rows = cur.fetchall()
    except Exception:
        return {}
    out = {}
    for symbol, sector, industry in rows:
        etfs = matching_etfs(sector or "", industry or "")
        if etfs:
            out[(symbol or "").upper()] = etfs[0]
    return out


def build_weekly_bundle(settings: dict) -> dict:
    tickers = weekly_universe(
        _holding_groups(),
        _watchlist(),
        _query_tickers("SELECT DISTINCT ticker FROM analyst_reports"),
        settings.get("extra_tickers") or [],
    )
    etf_move = {}
    for etf in PRICE_ETFS:
        etf_move[etf] = session_return(_bars(etf), 5)
    names = []
    headline_budget = 12
    drop_min = float(settings.get("drop_min") or 0.15)
    sectors = _sector_for(tickers)
    for ticker in tickers:
        bars = _bars(ticker)
        move = session_return(bars, 5)
        if move is None or move > -abs(drop_min):
            continue
        cap = _cap(ticker, bars)
        headlines: list[str] = []
        urls: list[str] = []
        if headline_budget > 0:
            headlines, urls = _headlines(ticker)
            headline_budget -= 1
        etf = sectors.get(ticker)
        names.append({
            "ticker": ticker,
            "name": ticker,
            "bars": bars,
            "market_cap": cap,
            "sector_move": etf_move.get(etf) if etf else None,
            "estimate_revision": None,
            "headlines": headlines,
            "headline_urls": urls,
        })
    return {"names": names}


def _form4_trades(as_of, headers: dict, limit: int = 25) -> list[dict]:
    from ideas_cards.edgar import parse_form4_xml
    from merger_arb.scanner.resolve import document_url, pad_cik
    from merger_arb.scanner.sources.sec_common import loads, search_url
    start = as_of - timedelta(days=30)
    payload = loads(_http(search_url("4", start, as_of, ""), headers))
    hits = ((payload.get("hits") or {}).get("hits") or [])[:limit]
    trades = []
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        source = hit.get("_source") if isinstance(hit.get("_source"), dict) else {}
        adsh = str(source.get("adsh") or "")
        hit_id = str(hit.get("_id") or "")
        filename = hit_id.split(":", 1)[1] if ":" in hit_id else ""
        ciks = source.get("ciks") or []
        cik = pad_cik(ciks[0] if ciks else "")
        if not (cik and adsh and filename):
            continue
        doc = document_url(cik, adsh, filename)
        time.sleep(0.15)
        try:
            xml = _http(doc, headers).decode("utf-8", "replace")
        except Exception:
            continue
        for row in parse_form4_xml(xml):
            row["url"] = doc
            trades.append(row)
    return trades


def _fund_13f(fund: dict, headers: dict) -> list[dict]:
    from ideas_cards.edgar import parse_13f_infotable
    from merger_arb.scanner.resolve import pad_cik
    from merger_arb.scanner.sources.sec_common import loads
    padded = pad_cik(fund.get("cik"))
    if not padded:
        return []
    try:
        payload = loads(_http(f"https://data.sec.gov/submissions/CIK{padded}.json", headers))
        recent = (payload.get("filings") or {}).get("recent") or {}
        forms = recent.get("form") or []
        accessions = recent.get("accessionNumber") or []
        accession = ""
        for index, form in enumerate(forms):
            if str(form).upper().startswith("13F") and index < len(accessions):
                accession = accessions[index]
                break
        if not accession:
            return []
        time.sleep(0.15)
        acc = accession.replace("-", "")
        index_url = f"https://www.sec.gov/Archives/edgar/data/{int(padded)}/{acc}/index.json"
        listing = loads(_http(index_url, headers))
        filename = ""
        for item in (listing.get("directory") or {}).get("item") or []:
            name = str(item.get("name") or "")
            if "infotable" in name.lower() and name.lower().endswith(".xml"):
                filename = name
                break
        if not filename:
            return []
        time.sleep(0.15)
        xml_url = f"https://www.sec.gov/Archives/edgar/data/{int(padded)}/{acc}/{filename}"
        rows = parse_13f_infotable(_http(xml_url, headers).decode("utf-8", "replace"))
    except Exception:
        return []
    for row in rows:
        row["fund"] = fund.get("name") or ""
        row["cik"] = padded
        row["url"] = xml_url
    return rows


def build_insider_bundle(settings: dict, as_of) -> dict:
    headers = _sec_headers()
    try:
        trades = _form4_trades(as_of, headers)
    except StageError:
        raise
    except Exception as exc:
        raise StageError(f"Form 4 fetch failed: {exc}") from exc
    current = []
    for fund in settings.get("funds") or []:
        current.extend(_fund_13f(fund, headers))
    return {"trades": trades, "filings_current": current}


def _mention_series(theme: str, as_of, headers: dict) -> list[dict]:
    from ideas_cards.edgar import hit_count
    from merger_arb.scanner.sources.sec_common import loads, search_url
    end = as_of
    mid = as_of - timedelta(days=90)
    start = mid - timedelta(days=90)
    series = []
    for label, left, right in (("prior", start, mid), ("latest", mid, end)):
        total = 0
        ok = False
        for form in ("10-K", "10-Q"):
            try:
                payload = loads(_http(search_url(form, left, right, theme), headers))
                count = hit_count(payload)
                if count is not None:
                    total += count
                    ok = True
            except Exception:
                pass
            time.sleep(0.12)
        if ok:
            series.append({"quarter": label, "count": total})
    return series


def _patent_count(theme: str, year: int) -> int | None:
    """One PatentsView year total. None when the call fails or the shape has no count."""
    query = {"_and": [
        {"_gte": {"patent_date": f"{year}-01-01"}},
        {"_lte": {"patent_date": f"{year}-12-31"}},
        {"_text_any": {"patent_title": theme}},
    ]}
    url = (
        "https://api.patentsview.org/patents/query?q="
        + json.dumps(query)
        + "&f=" + json.dumps(["patent_number"])
        + "&o=" + json.dumps({"per_page": 1})
    )
    try:
        payload = json.loads(_http(url, {"User-Agent": "DGA-ideas/1.0"}, timeout=8).decode("utf-8", "replace"))
    except Exception:
        return None
    raw = payload.get("total_patent_count")
    if raw is None:
        raw = payload.get("count")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _patent_series(themes: list[str]) -> dict:
    """Growth only when both year counts come back. A rejected call leaves the theme empty."""
    year = date.today().year
    out = {}
    for theme in themes:
        latest = _patent_count(theme, year)
        prior = _patent_count(theme, year - 1)
        if latest is None or prior is None:
            continue
        out[theme] = [
            {"quarter": str(year - 1), "count": prior},
            {"quarter": str(year), "count": latest},
        ]
    return out


def _fda_rows(themes: list[str], as_of) -> list[dict]:
    rows = []
    for theme in themes:
        try:
            url = (
                "https://api.fda.gov/drug/drugsfda.json?search="
                + theme.replace(" ", "+")
                + "&limit=3"
            )
            payload = json.loads(_http(url, {"User-Agent": "DGA-ideas/1.0"}, timeout=8).decode("utf-8", "replace"))
        except Exception:
            continue
        for item in payload.get("results") or []:
            submissions = item.get("submissions") or []
            for sub in submissions[:1]:
                stamp = str(sub.get("submission_status_date") or "")
                if len(stamp) == 8 and stamp.isdigit():
                    stamp = f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:]}"
                if stamp:
                    rows.append({"theme": theme, "date": stamp[:10], "label": sub.get("submission_status") or "FDA"})
    return rows


def _exposed(themes: list[str]) -> list[dict]:
    try:
        import api.server as server
        with server._fund_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT symbol, name, sector, industry FROM security_meta")
            meta = cur.fetchall()
    except Exception:
        return []
    found = []
    for theme in themes:
        needle = theme.lower()
        count = 0
        for symbol, name, sector, industry in meta:
            blob = f"{name or ''} {sector or ''} {industry or ''}".lower()
            if needle and needle in blob:
                found.append({"theme": theme, "ticker": symbol, "name": name or symbol})
                count += 1
                if count >= 5:
                    break
    return found


def build_trend_bundle(settings: dict, as_of) -> dict:
    headers = _sec_headers()
    themes = list(settings.get("themes") or [])
    for extra in settings.get("discovered_themes") or []:
        if extra not in themes:
            themes.append(extra)
    mentions = {}
    for theme in themes:
        series = _mention_series(theme, as_of, headers)
        if series:
            mentions[theme] = series
    return {
        "mentions": mentions,
        "patents": _patent_series(themes),
        "fda": _fda_rows(themes, as_of),
        "search": {},
        "exposed": _exposed(themes),
    }


def _usable_line(text: str) -> str:
    line = (text or "").strip().splitlines()
    if not line:
        return ""
    first = line[0].strip()
    low = first.lower()
    if not first or len(first) > 280:
        return ""
    if low.startswith(("i'm sorry", "i am sorry", "i cannot", "i can't", "as an ai")):
        return ""
    return first


def apply_local(cards: list) -> list:
    """Bulk one-liners when a non-loopback local model answers. Otherwise leave the draft."""
    try:
        from api.domains.local_finance_llm import (
            check_local_health,
            complete_local,
            local_settings,
            production_blocks_loopback,
        )
        cfg = local_settings()
        if production_blocks_loopback(cfg.get("base_url") or ""):
            return cards
        if not cfg.get("enabled"):
            return cards
        if not (check_local_health() or {}).get("ok"):
            return cards
    except Exception:
        return cards
    out = []
    for card in cards:
        try:
            text = complete_local(
                "Rewrite this investment idea in one sentence. No preamble.",
                card.get("thesis") or "",
                max_tokens=120,
            )
        except Exception:
            text = ""
        line = _usable_line(text or "")
        if line:
            updated = dict(card)
            updated["thesis"] = line
            out.append(updated)
        else:
            out.append(card)
    return out


def grok_complete(card: dict, remaining: float, model: str, search: bool) -> tuple[str, float] | None:
    if remaining < 0.05 or not (os.environ.get("XAI_API_KEY") or "").strip():
        return None
    from DGA_analyst import call_grok
    bucket: dict = {}
    system = "You write one sentence, under 40 words, for an investment idea card. No preamble."
    user = (
        f"Title: {card.get('title')}\n"
        f"Thesis: {card.get('thesis')}\n"
        f"Question: {card.get('question')}\n"
        "Rewrite the thesis as one sentence."
    )
    text = call_grok(
        system,
        user,
        model=model or "grok-4",
        live_search=bool(search),
        usage_capture=bucket.update,
    )
    return _usable_line(text or ""), float(bucket.get("cost_usd") or 0)


def polish(cards: list, settings: dict, remaining: float):
    cards = apply_local(cards)
    model = (settings or {}).get("grok_model") or "grok-4"

    def complete(card, left):
        try:
            return grok_complete(card, left, model, search=card.get("type") in {"weekly", "trend"})
        except Exception:
            return None

    return polish_cards(cards, remaining_usd=remaining, complete_fn=complete, limit=3)


def loader(stage: str, settings: dict, as_of, store):
    if stage == "sector":
        bundle = build_sector_bundle(settings)
    elif stage == "weekly":
        bundle = build_weekly_bundle(settings)
    elif stage == "insider":
        bundle = build_insider_bundle(settings, as_of)
    elif stage == "trend":
        bundle = build_trend_bundle(settings, as_of)
    else:
        raise StageError(f"unknown stage {stage}")
    return cards_for_bundle(stage, bundle, settings, as_of, store=store if stage == "insider" else None)
