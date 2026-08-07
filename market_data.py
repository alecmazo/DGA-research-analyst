"""
market_data.py — Free market-data layer for DGA Capital (no Tradier).

Primary sources (no paid brokerage account required):
  • Yahoo Finance v8 chart API — quotes, daily history, intraday (free, no key)
  • yfinance library — option chains / expirations fallback (free, no key)
  • Tiingo (optional) — if TIINGO_API_KEY is set in Railway env

Tradier was removed: free/sandbox accounts are no longer practical. Call sites
that checked tradier_available() still work — it always returns False.

Normalized shapes
-----------------
quote:  {price, prev_close, pct_change, source}
option row: {strike, option_type('call'|'put'), bid, ask, last, iv, delta,
             open_interest, volume, source}
"""

from __future__ import annotations

import os


# ── Legacy Tradier stubs (disabled — always unavailable) ─────────────────────
def _tradier_cfg():
    return "", ""


def tradier_available() -> bool:
    """Always False — Tradier is not used. Kept so older call sites stay safe."""
    return False


def _tradier_get(path: str, params: dict):
    return None


def _as_list(x):
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def _f(v):
    try:
        v = float(v)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _i(v):
    try:
        v = float(v)
        return int(v) if v == v else 0
    except (TypeError, ValueError):
        return 0


def tradier_quotes(symbols: list) -> dict | None:
    """Disabled — use get_quotes()."""
    return None


def tradier_expirations(symbol: str) -> list | None:
    return None


def _norm_tradier_option(o: dict) -> dict:
    return {}


def tradier_chain(symbol: str, expiration: str) -> list | None:
    return None


# ── Yahoo chart quotes (free primary) ────────────────────────────────────────
def _daily_closes_from_chart(res0: dict) -> list[float]:
    """Non-null daily closes from a v8 chart result, oldest → newest."""
    return [c for _, c in _daily_bars_from_chart(res0)]


def _daily_bars_from_chart(res0: dict) -> list[tuple[str, float]]:
    """[(YYYY-MM-DD ET session date, close), ...] oldest → newest, nulls dropped.

    If Yahoo omits timestamps, still return bars with synthetic dates so
    prior-close logic can use the close series (date string may be empty).
    """
    from datetime import datetime, timezone
    try:
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
    except Exception:
        et = timezone.utc
    ts = res0.get("timestamp") or []
    closes = ((res0.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    out: list[tuple[str, float]] = []
    if ts:
        for t, c in zip(ts, closes):
            px = _f(c)
            if px is None or t is None:
                continue
            try:
                d = datetime.fromtimestamp(int(t), tz=timezone.utc).astimezone(et).date()
                out.append((d.isoformat(), float(px)))
            except Exception:
                continue
    if not out:
        # Timestamp-less fallback — preserve non-null close order
        for c in closes:
            px = _f(c)
            if px is not None:
                out.append(("", float(px)))
    return out


# Short-lived caches so batch watchlist quotes do not re-hit Nasdaq/spark
# for every symbol on every request (watchlist was ~90s for 40 names).
_NDQ_BARS_CACHE: dict = {}
_NDQ_BARS_TTL = 300.0  # seconds
_SPARK_BARS_CACHE: dict = {}
_SPARK_BARS_TTL = 120.0


def _yf_prior_close(symbol: str) -> float | None:
    """Last completed session close via yfinance history (fills Yahoo chart gaps)."""
    try:
        import yfinance as yf  # type: ignore
        hist = yf.Ticker(symbol).history(period="10d", auto_adjust=True)
        if hist is None or len(hist) < 1:
            return None
        # history is timezone-aware; drop today if present so we get prior session
        today_iso = _us_now_et().date().isoformat()
        closes = []
        for idx, row in hist.iterrows():
            try:
                d = idx.date().isoformat() if hasattr(idx, "date") else str(idx)[:10]
            except Exception:
                d = str(idx)[:10]
            c = _f(row.get("Close"))
            if c is None:
                continue
            if d < today_iso:
                closes.append((d, float(c)))
        if closes:
            return float(closes[-1][1])
        # Fallback: second-to-last row if last row is today
        if len(hist) >= 2:
            return float(hist["Close"].iloc[-2])
    except Exception as e:
        print(f"[market_data] yf prior close {symbol}: {e!s:.100}", flush=True)
    return None


def _spark_bars(symbol: str) -> list[tuple[str, float]]:
    """Yahoo spark endpoint — often more complete than chart on cloud IPs."""
    import time as _time
    import requests
    from datetime import datetime, timezone
    try:
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
    except Exception:
        et = timezone.utc
    sym = (symbol or "").strip().upper()
    if not sym:
        return []
    now = _time.time()
    hit = _SPARK_BARS_CACHE.get(sym)
    if hit and (now - hit[0]) < _SPARK_BARS_TTL:
        return list(hit[1])
    out: list[tuple[str, float]] = []
    for host in ("query1", "query2"):
        try:
            r = requests.get(
                f"https://{host}.finance.yahoo.com/v8/finance/spark",
                params={"symbols": sym, "range": "1mo", "interval": "1d"},
                timeout=4,
                headers={"User-Agent": "Mozilla/5.0 DGACapital/1.0"},
            )
            if r.status_code != 200:
                continue
            data = r.json()
            # Formats: {spark:{result:[{response:[chartResult]}]}} or {SYM:{timestamp,close}}
            spark_res = ((data.get("spark") or {}).get("result")) or []
            ts, cl = [], []
            if spark_res:
                resp0 = (spark_res[0].get("response") or [None])[0] or {}
                if isinstance(resp0, dict) and resp0.get("timestamp"):
                    ts = resp0.get("timestamp") or []
                    cl = ((resp0.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
                else:
                    # flat map under symbol
                    flat = data.get(sym) or spark_res[0]
                    ts = (flat or {}).get("timestamp") or []
                    cl = (flat or {}).get("close") or []
            else:
                flat = data.get(sym) or {}
                ts = flat.get("timestamp") or []
                cl = flat.get("close") or []
            for t, c in zip(ts, cl):
                px = _f(c)
                if px is None or t is None:
                    continue
                try:
                    d = datetime.fromtimestamp(int(t), tz=timezone.utc).astimezone(et).date()
                    out.append((d.isoformat(), float(px)))
                except Exception:
                    continue
            if out:
                _SPARK_BARS_CACHE[sym] = (now, list(out))
                return out
        except Exception as e:
            print(f"[market_data] spark {sym} {host}: {e!s:.100}", flush=True)
    _SPARK_BARS_CACHE[sym] = (now, [])
    return out



def _nasdaq_daily_bars(symbol: str) -> list[tuple[str, float]]:
    """Nasdaq.com historical closes — reliable when Yahoo cloud chart skips a session.

    Free public JSON (no key). Used to fill missing prior-session bars for day-%.
    Cached briefly so a 40-ticker watchlist does not issue 40 serial Nasdaq calls
    on every hard refresh.
    """
    import time as _time
    import requests
    from datetime import timedelta
    sym = (symbol or "").strip().upper()
    if not sym:
        return []
    now = _time.time()
    hit = _NDQ_BARS_CACHE.get(sym)
    if hit and (now - hit[0]) < _NDQ_BARS_TTL:
        return list(hit[1])
    try:
        end = _us_now_et().date()
        start = end - timedelta(days=40)
        r = requests.get(
            f"https://api.nasdaq.com/api/quote/{sym}/historical",
            params={
                "assetclass": "stocks",
                "fromdate": start.isoformat(),
                "todate": end.isoformat(),
                "limit": 40,
            },
            timeout=5,
            headers={
                "User-Agent": "Mozilla/5.0 DGACapital/1.0",
                "Accept": "application/json,text/plain,*/*",
                "Origin": "https://www.nasdaq.com",
                "Referer": f"https://www.nasdaq.com/market-activity/stocks/{sym.lower()}/historical",
            },
        )
        if r.status_code != 200:
            return []
        rows = (((r.json() or {}).get("data") or {}).get("tradesTable") or {}).get("rows") or []
        out: list[tuple[str, float]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            ds = str(row.get("date") or "").strip()
            cs = str(row.get("close") or "").replace("$", "").replace(",", "").strip()
            if not ds or not cs:
                continue
            try:
                # MM/DD/YYYY → ISO
                mm, dd, yy = ds.split("/")
                iso = f"{int(yy):04d}-{int(mm):02d}-{int(dd):02d}"
                px = float(cs)
                out.append((iso, px))
            except Exception:
                continue
        out.sort(key=lambda x: x[0])
        _NDQ_BARS_CACHE[sym] = (now, list(out))
        return out
    except Exception as e:
        print(f"[market_data] nasdaq bars {sym}: {e!s:.100}", flush=True)
        _NDQ_BARS_CACHE[sym] = (now, [])
        return []


def _expected_prior_session_iso() -> str:
    """Most recent weekday before today (ET). Holidays may still miss; bars fill truth."""
    from datetime import timedelta
    d = _us_now_et().date() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def _merge_bar_series(*series: list) -> list[tuple[str, float]]:
    by_d: dict[str, float] = {}
    for ser in series:
        if not ser:
            continue
        for d, c in ser:
            if d and c is not None:
                by_d[str(d)] = float(c)
    return sorted(by_d.items(), key=lambda x: x[0])


def _session_prior_close(bars: list[tuple[str, float]], live_px, rth_open: bool,
                         symbol: str = "") -> float | None:
    """Prior US session close from daily bars — never trust Yahoo meta alone.

    Rule: most recent daily bar with date *strictly before* today (ET).

    Cloud Yahoo chart/spark often skip a session (prod: 2026-07-23 then
    2026-07-27 — Friday missing). If the latest pre-today bar is older than
    the expected prior weekday, fill from yfinance then Nasdaq historical so
    day-% matches the real last session close (e.g. Fri 313.03 not Thu 319.69).
    """
    from datetime import date
    today_iso = _us_now_et().date().isoformat()
    expected = _expected_prior_session_iso()
    dated = [(d, c) for d, c in (bars or []) if d]
    prior_bars = [(d, c) for d, c in dated if d < today_iso]

    def _from_prior(prior):
        if not prior:
            return None
        return float(prior[-1][1])

    if prior_bars:
        last_prior_date, last_prior_close = prior_bars[-1]
        if last_prior_date >= expected or not symbol:
            return float(last_prior_close)
        # Missing expected session — Nasdaq first (fast/reliable on cloud),
        # then yfinance. Caller usually already merged; this is a safety net.
        ndq = _nasdaq_daily_bars(symbol)
        if ndq:
            ndq_prior = [(d, c) for d, c in ndq if d and d < today_iso]
            if ndq_prior and ndq_prior[-1][0] > last_prior_date:
                return float(ndq_prior[-1][1])
        yf_prev = _yf_prior_close(symbol)
        if yf_prev is not None:
            return float(yf_prev)
        return float(last_prior_close)

    if len(dated) >= 2 and dated[-1][0] >= today_iso:
        return float(dated[-2][1])
    closes = [c for _, c in (bars or [])]
    if len(closes) >= 2:
        return float(closes[-2])
    if symbol:
        ndq = _nasdaq_daily_bars(symbol)
        p = _from_prior([(d, c) for d, c in ndq if d and d < today_iso])
        if p is not None:
            return p
        return _yf_prior_close(symbol)
    return None


def _us_now_et():
    from datetime import datetime, timezone
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        return datetime.now(timezone.utc)


def _us_rth_open(meta: dict | None = None) -> bool:
    """True only during regular US equity session (09:30–16:00 ET weekdays).

    Yahoo marketState is preferred when present; otherwise clock-based.
    Weekends / holidays / pre / post → False so we pin last session close.
    """
    state = str((meta or {}).get("marketState") or "").upper()
    if state == "REGULAR":
        return True
    if state in ("PRE", "PREPRE", "POST", "POSTPOST", "CLOSED", "HOLIDAY"):
        return False
    now = _us_now_et()
    if now.weekday() >= 5:  # Sat/Sun
        return False
    mins = now.hour * 60 + now.minute
    return (9 * 60 + 30) <= mins < (16 * 60)


def _last_completed_us_session_date() -> str:
    """Most recent *completed* US equity session calendar date (ET, YYYY-MM-DD).

    Weekends → Friday. Weekday before the close → prior weekday. After 16:00 ET
    on a weekday → today. Holidays are treated as weekdays (rare miss; Yahoo
    bars remain the ground truth for the actual price).
    """
    from datetime import timedelta
    now = _us_now_et()
    d = now.date()
    if now.weekday() >= 5:  # weekend → Friday
        d = d - timedelta(days=now.weekday() - 4)
    elif (now.hour * 60 + now.minute) < (16 * 60):
        # Before the close: last completed is prior weekday
        d = d - timedelta(days=1)
        while d.weekday() >= 5:
            d = d - timedelta(days=1)
    return d.isoformat()


def _yahoo_chart_quote(symbol: str) -> dict | None:
    """One symbol via Yahoo v8 chart — session-aware last price + prior close.

    Yahoo's chart meta often omits previousClose / regularMarketChangePercent
    (2026+). chartPreviousClose is NOT the prior session — it is the close at
    the start of the chart window and inflates day % (e.g. C −4% vs real +0.3%).

    Weekend / market-closed path (SUP_20260726): prefer the **last completed
    daily bar** as the displayed price (Friday's official close), never a stale
    intraday cache, post/pre print that disagrees with that bar, or a blind
    second-to-last bar used as "prev" while the last trade is already Monday.
    """
    import requests
    sym = (symbol or "").strip().upper()
    if not sym:
        return None
    for host in ("query1", "query2"):
        try:
            # Use explicit period1/period2 (not range=10d). Some cloud IPs get a
            # sparse range response that skips a session (prod skipped Fri
            # 2026-07-24 → prior close became Thu 319.69). period1/2 returns
            # the full daily series including the missing Friday.
            import time as _time
            p2 = int(_time.time()) + 3600
            p1 = p2 - 25 * 86400
            r = requests.get(
                f"https://{host}.finance.yahoo.com/v8/finance/chart/{sym}",
                params={
                    "period1": p1,
                    "period2": p2,
                    "interval": "1d",
                    "includePrePost": "false",
                },
                timeout=6,
                headers={"User-Agent": "Mozilla/5.0 DGACapital/1.0"},
            )
            if r.status_code != 200:
                continue
            res0 = (((r.json().get("chart") or {}).get("result")) or [None])[0]
            if not res0:
                continue
            meta = res0.get("meta") or {}
            bars = _daily_bars_from_chart(res0)
            # Gap-fill only when the expected prior weekday is missing.
            # Always calling spark+nasdaq made a 40-ticker watchlist take ~90s
            # and the GP UI looked empty (browser timeout).
            spark: list = []
            spark_n = 0
            today_iso = _us_now_et().date().isoformat()
            expected = _expected_prior_session_iso()
            prior_dates = {d for d, _ in bars if d and d < today_iso}
            if expected not in prior_dates:
                spark = _spark_bars(sym)
                spark_n = len(spark) if spark else 0
                if spark:
                    bars = _merge_bar_series(bars, spark)
                    prior_dates = {d for d, _ in bars if d and d < today_iso}
            if expected not in prior_dates:
                ndq = _nasdaq_daily_bars(sym)
                if ndq:
                    bars = _merge_bar_series(bars, ndq)
            closes = [c for _, c in bars]
            rth_open = _us_rth_open(meta)
            last_sess = _last_completed_us_session_date()

            live_px = _f(meta.get("regularMarketPrice")
                         or meta.get("postMarketPrice")
                         or meta.get("preMarketPrice"))
            bar_last = closes[-1] if closes else None
            bar_last_date = bars[-1][0] if bars else None
            bar_prev = closes[-2] if len(closes) >= 2 else None

            # ── Price ────────────────────────────────────────────────────
            # RTH open → live last trade. Otherwise pin last completed session
            # close (daily bar). If bars are fresher than a weird meta print,
            # trust the bar for closed markets (weekend accuracy).
            price_source = "live"
            as_of = bar_last_date
            if rth_open and live_px is not None:
                px = live_px
                price_source = "live"
                # as_of = today's session while RTH is open
                as_of = _us_now_et().date().isoformat()
            else:
                # Market closed (weekend / holiday / pre / post): official close
                if bar_last is not None:
                    px = bar_last
                    price_source = "session_close"
                    as_of = bar_last_date
                    # If bar is older than last completed session, still use it
                    # (holiday) but keep as_of honest.
                else:
                    px = live_px
                    price_source = "meta_fallback"
                    as_of = last_sess
                # If meta live print drifts from last bar while closed, bar wins
                if (px is not None and bar_last is not None
                        and abs(float(px) - float(bar_last)) > max(0.02, 0.002 * abs(bar_last))):
                    # Prefer bar when closed — it's the official daily close
                    if not rth_open:
                        px = bar_last
                        price_source = "session_close"
                        as_of = bar_last_date

            if px is None:
                continue

            # ── Prior session close — BARS ONLY (meta previousClose is toxic) ─
            # SUP_20260727: Yahoo meta previousClose was Thursday (319.69) while
            # Friday close was 313.03 → day-% used a multi-session base.
            # Never use meta previousClose / regularMarketChangePercent.
            #
            # Morning / pre-market / weekend: when we PIN price to the last
            # completed session close, prior MUST be the bar before THAT session.
            # Using "last bar before calendar today" made prev == price → 0% on
            # every name until the open (finicky morning watchlist).
            prev = None
            if not rth_open and price_source == "session_close":
                sess_d = str(as_of or bar_last_date or "")[:10]
                if sess_d and bars:
                    prior_to_sess = [
                        (d, c) for d, c in bars if d and d < sess_d
                    ]
                    if prior_to_sess:
                        prev = float(prior_to_sess[-1][1])
                    # Gap-fill if the bar immediately before sess looks too old
                    expected_before = None
                    try:
                        from datetime import date as _date, timedelta as _td
                        sd = _date.fromisoformat(sess_d)
                        d = sd - _td(days=1)
                        while d.weekday() >= 5:
                            d -= _td(days=1)
                        expected_before = d.isoformat()
                    except Exception:
                        expected_before = None
                    if (expected_before and prior_to_sess
                            and prior_to_sess[-1][0] < expected_before):
                        ndq = _nasdaq_daily_bars(sym)
                        if ndq:
                            filled = [
                                (d, c) for d, c in ndq
                                if d and d < sess_d
                            ]
                            if filled and filled[-1][0] > prior_to_sess[-1][0]:
                                prev = float(filled[-1][1])
                        if prev is not None and prior_to_sess and abs(
                                float(prev) - float(prior_to_sess[-1][1])) < 1e-9:
                            yf_p = _yf_prior_close(sym)
                            # Only if yfinance disagrees with the pinned close
                            if (yf_p is not None and px is not None
                                    and abs(float(yf_p) - float(px)) > 1e-4):
                                prev = float(yf_p)
            if prev is None:
                # RTH open path (and any closed-market fallback): last bar
                # strictly before *calendar today* ET.
                prev = _session_prior_close(
                    bars, live_px if rth_open else px, rth_open, symbol=sym)
            if prev is None:
                prev = _yf_prior_close(sym)
            # Hard guard: closed market must never emit last==prior (fake 0%).
            if (not rth_open and prev is not None and px is not None
                    and abs(float(prev) - float(px)) < 1e-9):
                prev = None

            pct = None
            if prev not in (None, 0):
                pct = (float(px) - float(prev)) / float(prev) * 100.0

            row = {
                "price": float(px),
                "prev_close": float(prev) if prev is not None else None,
                "pct_change": pct,
                "source": "yahoo-chart",
                "price_source": price_source,
                "as_of": as_of,
            }
            if os.environ.get("MARKET_DATA_DEBUG", "").strip() in ("1", "true", "yes"):
                row.update({
                    "debug_bars_tail": bars[-5:] if bars else [],
                    "debug_today": _us_now_et().isoformat(),
                    "debug_rth": rth_open,
                    "debug_spark_n": spark_n,
                    "debug_spark_tail": (spark[-5:] if spark else []),
                    "debug_expected_prior": expected,
                })
            return row
        except Exception as e:
            print(f"[market_data] yahoo quote {sym} {host}: {e!s:.100}", flush=True)
    return None


def _tiingo_quotes(symbols: list) -> dict:
    """Optional Tiingo IEX batch (free tier with TIINGO_API_KEY)."""
    key = (os.environ.get("TIINGO_API_KEY") or "").strip()
    if not key or not symbols:
        return {}
    out = {}
    try:
        import requests
        # Tiingo allows comma-separated tickers
        r = requests.get(
            "https://api.tiingo.com/iex",
            params={"tickers": ",".join(symbols), "token": key},
            timeout=10,
            headers={"Content-Type": "application/json"},
        )
        if r.status_code != 200:
            return {}
        rows = r.json()
        if isinstance(rows, dict):
            rows = [rows]
        for it in rows or []:
            sym = (it.get("ticker") or "").upper()
            if not sym:
                continue
            px = _f(it.get("tngoLast") or it.get("last") or it.get("close"))
            prev = _f(it.get("prevClose") or it.get("previousClose"))
            pct = None
            if px is not None and prev not in (None, 0):
                pct = (px - prev) / prev * 100.0
            if px is not None:
                out[sym] = {
                    "price": px,
                    "prev_close": prev,
                    "pct_change": pct,
                    "source": "tiingo",
                }
    except Exception as e:
        print(f"[market_data] tiingo quotes failed: {e!s:.120}", flush=True)
    return out


def _yf_quotes(symbols: list) -> dict:
    """Yahoo chart per-symbol (same as primary; kept for get_quotes fill)."""
    out = {}
    for sym in symbols or []:
        q = _yahoo_chart_quote(sym)
        if q:
            out[sym.upper()] = q
    return out


def _norm_yf_option(row, opt_type: str) -> dict:
    g = lambda k: row.get(k) if hasattr(row, "get") else getattr(row, k, None)
    return {
        "strike": _f(g("strike")),
        "option_type": opt_type,
        "bid": _f(g("bid")) or 0.0,
        "ask": _f(g("ask")) or 0.0,
        "last": _f(g("lastPrice")),
        "iv": _f(g("impliedVolatility")),
        "delta": None,
        "open_interest": _i(g("openInterest")),
        "volume": _i(g("volume")),
        "source": "yfinance",
    }


def _yf_chain(symbol: str, expiration: str) -> list | None:
    try:
        import yfinance as yf
        ch = yf.Ticker(symbol).option_chain(expiration)
        rows = []
        for _, r in ch.calls.iterrows():
            rows.append(_norm_yf_option(r, "call"))
        for _, r in ch.puts.iterrows():
            rows.append(_norm_yf_option(r, "put"))
        return rows
    except Exception as e:
        print(f"[market_data] yfinance chain {symbol} {expiration} failed: {e!s:.120}", flush=True)
        return None


def _yf_expirations(symbol: str) -> list:
    try:
        import yfinance as yf
        return list(getattr(yf.Ticker(symbol), "options", []) or [])
    except Exception:
        return []


# ── Unified public API (Yahoo + optional Tiingo; no Tradier) ─────────────────
def get_quotes(symbols: list) -> dict:
    """{SYM: quote}. Yahoo chart first (parallel); Tiingo fills gaps when key is set."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    symbols = [s.strip().upper() for s in symbols if s and s.strip()]
    if not symbols:
        return {}
    out = {}
    # Parallel Yahoo chart. NEVER use `with ThreadPoolExecutor` + timeout —
    # executor.__exit__ calls shutdown(wait=True) and hangs the request while
    # Yahoo workers finish (watchlist / idea-feed freeze).
    workers = min(12, max(1, len(symbols)))
    wall_s = float(os.environ.get("QUOTE_FANOUT_TIMEOUT_S", "6") or 6)
    ex = ThreadPoolExecutor(max_workers=workers)
    try:
        futs = {ex.submit(_yahoo_chart_quote, sym): sym for sym in symbols}
        try:
            for fut in as_completed(futs, timeout=wall_s):
                sym = futs[fut]
                try:
                    q = fut.result(timeout=0.1)
                except Exception as e:
                    print(f"[market_data] get_quotes {sym}: {e!s:.100}", flush=True)
                    q = None
                if q:
                    out[sym] = q
        except Exception as e:
            print(f"[market_data] get_quotes wall {wall_s}s: {e!s:.100}", flush=True)
    finally:
        try:
            ex.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            ex.shutdown(wait=False)
    missing = [s for s in symbols if s not in out or out[s].get("price") is None]
    if missing:
        try:
            tq = _tiingo_quotes(missing)
            out.update(tq or {})
        except Exception as e:
            print(f"[market_data] tiingo fill: {e!s:.100}", flush=True)
    return out


def get_expirations(symbol: str) -> list:
    return _yf_expirations(symbol) or []


def get_chain(symbol: str, expiration: str) -> list:
    """Normalized option rows — yfinance only (free)."""
    return _yf_chain(symbol, expiration) or []


def source_label() -> str:
    if (os.environ.get("TIINGO_API_KEY") or "").strip():
        return "yahoo+tiingo"
    return "yahoo"


# ── Yahoo v8 chart API (free, no key) ────────────────────────────────────────
# This is the raw JSON chart endpoint (query1/query2.finance.yahoo.com), NOT the
# crumb-authenticated path the yfinance library uses — it is lighter and far more
# tolerant of cloud IPs, so it sidesteps most of the cloud-IP block. Returns
# split/dividend-adjusted closes when available.
def _yahoo_chart_raw(symbol: str, rng: str, interval: str):
    """→ (timestamps[], closes[], gmtoffset_seconds) or (None, None, 0)."""
    import requests
    for host in ("query1", "query2"):
        try:
            r = requests.get(
                f"https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}",
                params={"range": rng, "interval": interval, "includePrePost": "false"},
                # 5s — 15s per host × N tickers was a major watchlist hang
                timeout=5, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code != 200:
                continue
            res = (((r.json().get("chart") or {}).get("result")) or [None])[0]
            if not res:
                continue
            ts = res.get("timestamp") or []
            ind = res.get("indicators") or {}
            adj = ind.get("adjclose")
            closes = ((adj[0].get("adjclose") if adj else None)
                      or (ind.get("quote") or [{}])[0].get("close") or [])
            gmt = ((res.get("meta") or {}).get("gmtoffset")) or 0
            if ts:
                return ts, closes, gmt
        except Exception as e:
            print(f"[market_data] yahoo chart {symbol} {host} failed: {e!s:.120}", flush=True)
    return None, None, 0


def yahoo_history(symbol: str, rng: str = "max") -> list | None:
    """Daily adjusted closes from Yahoo v8 chart. [{date, close}] or None."""
    import datetime as _dt
    ts, closes, _ = _yahoo_chart_raw(symbol, rng, "1d")
    if not ts:
        return None
    out = []
    for t, c in zip(ts, closes):
        c = _f(c)
        if c is None:
            continue
        out.append({"date": _dt.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d"),
                    "close": c})
    return out or None


def yahoo_intraday(symbol: str, rng: str = "5d", interval: str = "15m") -> list | None:
    """Intraday closes from Yahoo v8 chart, in market-local time. [{time, close}]."""
    import datetime as _dt
    ts, closes, gmt = _yahoo_chart_raw(symbol, rng, interval)
    if not ts:
        return None
    out = []
    for t, c in zip(ts, closes):
        c = _f(c)
        if c is None:
            continue
        out.append({"time": _dt.datetime.utcfromtimestamp(t + gmt).strftime("%Y-%m-%d %H:%M"),
                    "close": c})
    return out or None



def _yf_history(symbol: str, period: str = "max",
                interval: str = "1d") -> list | None:
    """yfinance daily bars fallback. [{date, close}] or None."""
    try:
        import yfinance as yf
        df = yf.Ticker(symbol).history(period=period, interval=interval,
                                       auto_adjust=True)
        out = []
        for idx, row in df["Close"].dropna().items():
            out.append({"date": idx.strftime("%Y-%m-%d"), "close": float(row)})
        return out or None
    except Exception as e:
        print(f"[market_data] yf history {symbol} failed: {e!s:.120}", flush=True)
        return None


def _yahoo_range_for(start: str) -> str:
    """Smallest Yahoo range token that still covers `start` → today."""
    if not start:
        return "max"
    try:
        from datetime import date as _date
        y, m, d = map(int, start.split("-"))
        days = (_date.today() - _date(y, m, d)).days
    except Exception:
        return "max"
    for thr, tok in [(7, "1mo"), (35, "3mo"), (95, "6mo"), (370, "1y"),
                     (740, "2y"), (1850, "5y"), (3700, "10y")]:
        if days <= thr:
            return tok
    return "max"


def get_price_history(symbol: str, interval: str = "daily",
                      start: str = None, end: str = None,
                      adjusted: bool = False) -> list:
    """Daily bars via free Yahoo v8 chart → yfinance fallback.

    Prefer adjusted Yahoo closes for return math (split-adjusted).
    """
    rows = yahoo_history(symbol, rng=_yahoo_range_for(start))
    if not rows:
        rows = _yf_history(symbol)
    return rows or []


def get_intraday(symbol: str) -> list:
    """5-day intraday closes (15-min) from free Yahoo v8 chart."""
    return yahoo_intraday(symbol) or []


def _us_equity_session_date():
    """US equity session date (America/New_York calendar date).

    Before ~4am ET we still treat the prior calendar day as the active
    session date (Yahoo day_gainers often freezes on last close overnight).
    After that, today's date — pre-market / RTH / after-hours all count as
    the current session once Yahoo starts publishing it.
    """
    from datetime import datetime, timedelta
    try:
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
    except Exception:
        et = None
    now = datetime.now(et) if et else datetime.utcnow()
    # Yahoo often keeps prior-session screeners until early morning ET.
    # After 04:00 ET we expect "today" (premarket) or last completed session.
    if now.hour < 4:
        return (now.date() - timedelta(days=1)).isoformat()
    return now.date().isoformat()


def yahoo_market_movers(min_price: float = 3.0, min_market_cap: float = 2e9,
                        per_list: int = 30) -> list:
    """Biggest BROAD-MARKET movers from Yahoo's free predefined screeners
    (day_gainers + day_losers + most_actives) — the day's real movers market-wide,
    not just a given universe. No API key; same cloud-tolerant Yahoo host family
    as the price-chart endpoint. Returns [{ticker, price, pct_change, name,
    market_cap, market_time, session_date}], deduped to the largest move.
    Filters out penny stocks (< min_price), micro/small caps (known marketCap
    < min_market_cap, default $2B), and quotes whose regularMarketTime is older
    than the active US session (drops weekend / multi-day-stale names that
    sometimes leak into most_actives)."""
    import requests
    from datetime import datetime, timezone
    try:
        from zoneinfo import ZoneInfo
        _ET = ZoneInfo("America/New_York")
    except Exception:
        _ET = timezone.utc

    session_date = _us_equity_session_date()
    out: dict = {}
    for scr in ("day_gainers", "day_losers", "most_actives"):
        got = False
        for host in ("query1", "query2"):
            try:
                r = requests.get(
                    f"https://{host}.finance.yahoo.com/v1/finance/screener/predefined/saved",
                    params={"scrIds": scr, "count": per_list},
                    timeout=12, headers={"User-Agent": "Mozilla/5.0"})
                if r.status_code != 200:
                    continue
                res = (((r.json().get("finance") or {}).get("result")) or [None])[0]
                if not res:
                    continue
                for q in (res.get("quotes") or []):
                    sym = (q.get("symbol") or "").upper().strip()
                    px  = _f(q.get("regularMarketPrice"))
                    pct = _f(q.get("regularMarketChangePercent"))
                    mc  = _f(q.get("marketCap"))
                    if not sym or px is None or pct is None or px < min_price:
                        continue
                    if mc is not None and mc < min_market_cap:
                        continue   # drop micro / small caps
                    # Skip flat names from most_actives (noise, often multi-day stale)
                    if abs(pct) < 0.05 and scr == "most_actives":
                        continue
                    mkt_ts = q.get("regularMarketTime")
                    mkt_iso = None
                    quote_session = None
                    if mkt_ts:
                        try:
                            dt = datetime.fromtimestamp(int(mkt_ts), tz=timezone.utc)
                            mkt_iso = dt.isoformat()
                            quote_session = dt.astimezone(_ET).date().isoformat()
                        except Exception:
                            quote_session = None
                    # Drop multi-day-stale quotes (e.g. most_actives from last week)
                    if quote_session:
                        try:
                            from datetime import date as _date
                            age = (_date.fromisoformat(session_date)
                                   - _date.fromisoformat(quote_session)).days
                            if age > 1:
                                continue
                        except Exception:
                            pass
                    row = {
                        "ticker": sym,
                        "price": px,
                        "pct_change": round(pct, 4),
                        "market_cap": mc,
                        "name": q.get("shortName") or q.get("longName")
                                or q.get("displayName") or "",
                        "market_time": mkt_iso,
                        "session_date": quote_session or session_date,
                        "screener": scr,
                    }
                    if sym not in out or abs(pct) > abs(out[sym]["pct_change"]):
                        out[sym] = row
                got = True
                break
            except Exception as e:
                print(f"[market_data] yahoo movers {scr} {host} failed: {e!s:.120}", flush=True)
        if not got:
            print(f"[market_data] yahoo movers {scr}: no data", flush=True)
    rows = list(out.values())
    # Keep only the freshest session Yahoo is actually publishing (today once
    # premarket/RTH ticks; otherwise last completed session — not a mix).
    dated = [r.get("session_date") for r in rows if r.get("session_date")]
    if dated:
        newest = max(dated)
        rows = [r for r in rows if (r.get("session_date") or newest) >= newest]
    return rows


# ── Nasdaq earnings calendar (free, no key) ──────────────────────────────────
# Used to flag imminent quarterly results on the GP watchlist.
_EARNINGS_CACHE: dict = {}   # day_iso -> (epoch, rows)
_EARNINGS_TTL_S = 4 * 3600


def nasdaq_earnings_for_day(day_iso: str) -> list[dict]:
    """Earnings scheduled for a calendar day (YYYY-MM-DD) from Nasdaq's free API.

    Returns list of {symbol, name, time, fiscal_quarter, eps_forecast, ...}.
    Empty list on failure — never raises.
    """
    import time as _time
    day_iso = (day_iso or "")[:10]
    if not day_iso:
        return []
    hit = _EARNINGS_CACHE.get(day_iso)
    if hit and _time.time() - hit[0] < _EARNINGS_TTL_S:
        return hit[1]
    rows_out: list[dict] = []
    try:
        import requests
        r = requests.get(
            "https://api.nasdaq.com/api/calendar/earnings",
            params={"date": day_iso},
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; DGA-Capital/1.0)",
                "Accept": "application/json",
            },
            timeout=4,
        )
        if r.status_code == 200:
            data = (r.json() or {}).get("data") or {}
            for row in (data.get("rows") or []):
                sym = (row.get("symbol") or "").strip().upper()
                if not sym:
                    continue
                rows_out.append({
                    "symbol": sym,
                    "name": row.get("name") or "",
                    "time": row.get("time") or "",  # time-pre-market / time-after-hours / …
                    "fiscal_quarter": row.get("fiscalQuarterEnding") or "",
                    "eps_forecast": row.get("epsForecast") or "",
                    "date": day_iso,
                })
        else:
            print(f"[market_data] nasdaq earnings {day_iso} HTTP {r.status_code}", flush=True)
    except Exception as e:
        print(f"[market_data] nasdaq earnings {day_iso} failed: {e!s:.120}", flush=True)
    _EARNINGS_CACHE[day_iso] = (_time.time(), rows_out)
    return rows_out


def earnings_upcoming(symbols: list[str] | None = None,
                      horizon_days: int = 5,
                      include_past_days: int = 1) -> dict[str, dict]:
    """Map SYMBOL → next earnings event within the horizon window.

    Window: [today - include_past_days, today + horizon_days] (calendar days).
    When *symbols* is set, only those tickers are returned.
    """
    from datetime import date, timedelta
    want = None
    if symbols is not None:
        want = {str(s).strip().upper() for s in symbols if s}
        if not want:
            return {}
    today = date.today()
    start = today - timedelta(days=max(0, int(include_past_days)))
    end = today + timedelta(days=max(0, int(horizon_days)))
    days: list[str] = []
    d = start
    while d <= end:
        days.append(d.isoformat())
        d += timedelta(days=1)

    # Parallel day fetches — sequential was stacking 4–12s and blocking mobile
    # watchlist price refresh after the earnings feature landed.
    # CRITICAL: never `with ThreadPoolExecutor` — its __exit__ waits for hung
    # workers and freezes the caller (watchlist hang ui390). shutdown(wait=False).
    day_rows: list[tuple[str, list]] = []
    try:
        from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FutTimeout
        pool = ThreadPoolExecutor(max_workers=min(6, max(1, len(days))))
        try:
            futs = {pool.submit(nasdaq_earnings_for_day, day): day for day in days}
            try:
                for fut in as_completed(futs, timeout=8):
                    day = futs[fut]
                    try:
                        day_rows.append((day, fut.result() or []))
                    except Exception:
                        day_rows.append((day, []))
            except FutTimeout:
                # Collect whatever finished; leave stragglers to die in the pool
                done_days = {d for d, _ in day_rows}
                for fut, day in futs.items():
                    if day in done_days:
                        continue
                    if fut.done():
                        try:
                            day_rows.append((day, fut.result() or []))
                        except Exception:
                            day_rows.append((day, []))
        finally:
            try:
                pool.shutdown(wait=False, cancel_futures=True)
            except TypeError:
                pool.shutdown(wait=False)
    except Exception:
        for day in days:
            try:
                day_rows.append((day, nasdaq_earnings_for_day(day) or []))
            except Exception:
                day_rows.append((day, []))

    best: dict[str, dict] = {}
    for day_iso, rows in day_rows:
        try:
            from datetime import date as _date
            day_d = _date.fromisoformat(day_iso)
        except Exception:
            continue
        for row in rows:
            sym = row["symbol"]
            if want is not None and sym not in want:
                continue
            days_until = (day_d - today).days
            rec = {
                **row,
                "days_until": days_until,
                "imminent": -include_past_days <= days_until <= horizon_days,
            }
            prev = best.get(sym)
            if prev is None:
                best[sym] = rec
            else:
                def _rank(r):
                    du = r["days_until"]
                    return (0 if du >= 0 else 1, abs(du))
                if _rank(rec) < _rank(prev):
                    best[sym] = rec
    return best


_EARNINGS_DETAIL_CACHE: dict = {}  # symbol -> (epoch, payload)
_EARNINGS_DETAIL_TTL_S = 30 * 60


def company_ir_links(symbol: str) -> dict:
    """Company website + investor-relations URL (Yahoo/yfinance free profile).

    Used by the watchlist earnings card so GPs can open the IR site (or the
    SEC 8-K press release when we already pulled it) without an LLM call.
    Cached 6h — IR URLs almost never change.
    """
    import time as _time
    sym = (symbol or "").strip().upper()
    if not sym:
        return {}
    cache_key = ("ir_links", sym)
    hit = _EARNINGS_DETAIL_CACHE.get(cache_key)
    if hit and _time.time() - hit[0] < 6 * 3600:
        return dict(hit[1] or {})

    out: dict = {"website": None, "ir_url": None, "source": None}
    try:
        import yfinance as yf
        info = {}
        try:
            info = yf.Ticker(sym).info or {}
        except Exception:
            # Older yfinance: get_info()
            try:
                t = yf.Ticker(sym)
                info = (getattr(t, "get_info", None) or (lambda: {}))() or {}
            except Exception:
                info = {}
        website = (info.get("website") or info.get("homepage") or "").strip() or None
        ir = (
            info.get("irWebsite")
            or info.get("investorRelationsWebsite")
            or info.get("ir_website")
            or ""
        ).strip() or None
        # Normalize scheme
        def _http(u: str | None) -> str | None:
            if not u:
                return None
            u = str(u).strip()
            if u.startswith("//"):
                u = "https:" + u
            if not u.startswith("http"):
                u = "https://" + u.lstrip("/")
            return u
        website = _http(website)
        ir = _http(ir)
        # Fallback: common IR path on corporate homepage when Yahoo omits irWebsite
        if not ir and website:
            base = website.rstrip("/")
            # Prefer explicit investor subdomains when website is the marketing domain
            ir = base + "/investors"
        out = {
            "website": website,
            "ir_url": ir,
            "source": "yfinance" if (website or ir) else None,
        }
    except Exception as e:
        print(f"[market_data] ir_links {sym}: {e!s:.120}", flush=True)
    _EARNINGS_DETAIL_CACHE[cache_key] = (_time.time(), out)
    return dict(out)


def _parse_money_num(v):
    """Parse '$5.59' / '5.59' / 5.59 → float or None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        try:
            f = float(v)
            return f if f == f else None
        except (TypeError, ValueError):
            return None
    s = str(v).strip().replace(",", "").replace("$", "")
    if not s or s in ("—", "-", "N/A", "n/a"):
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _parse_reported_date(s) -> "object | None":
    """Parse m/d/yyyy or ISO earnings date → date or None."""
    from datetime import datetime
    if s is None:
        return None
    raw = str(s).strip()
    if not raw:
        return None
    # ISO with time
    if "T" in raw or len(raw) >= 10 and raw[4] == "-":
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")[:19]).date()
        except Exception:
            pass
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw[:10] if fmt.startswith("%Y-%m") else raw, fmt).date()
        except Exception:
            continue
    return None


def _beat_from_eps(actual, est) -> str | None:
    if actual is None or est is None:
        return None
    try:
        a, e = float(actual), float(est)
    except (TypeError, ValueError):
        return None
    if a > e:
        return "beat"
    if a < e:
        return "miss"
    return "inline"


def nasdaq_earnings_surprise(symbol: str) -> dict:
    """Historical EPS actual vs consensus from Nasdaq (free).

    Returns {history: [...], latest: {...}|None, source: str} — never raises.
    Nasdaq often lags same-day prints by hours/days; pair with yfinance fallback.
    """
    import time as _time
    sym = (symbol or "").strip().upper()
    if not sym:
        return {"history": [], "latest": None, "source": "nasdaq"}
    hit = _EARNINGS_DETAIL_CACHE.get(("nasdaq", sym))
    if hit and _time.time() - hit[0] < _EARNINGS_DETAIL_TTL_S:
        return hit[1]
    history: list[dict] = []
    try:
        import requests
        r = requests.get(
            f"https://api.nasdaq.com/api/company/{sym}/earnings-surprise",
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; DGA-Capital/1.0)",
                "Accept": "application/json",
            },
            timeout=12,
        )
        if r.status_code == 200:
            data = (r.json() or {}).get("data") or {}
            table = (data.get("earningsSurpriseTable") or {})
            for row in (table.get("rows") or []):
                actual = _parse_money_num(row.get("eps"))
                est = _parse_money_num(row.get("consensusForecast"))
                surprise_pct = _parse_money_num(row.get("percentageSurprise"))
                history.append({
                    "fiscal_quarter": row.get("fiscalQtrEnd") or "",
                    "date_reported": row.get("dateReported") or "",
                    "eps_actual": actual,
                    "eps_estimate": est,
                    "surprise_pct": surprise_pct,
                    "beat": _beat_from_eps(actual, est),
                    "source": "nasdaq",
                })
        else:
            print(f"[market_data] nasdaq surprise {sym} HTTP {r.status_code}", flush=True)
    except Exception as e:
        print(f"[market_data] nasdaq surprise {sym} failed: {e!s:.120}", flush=True)
    out = {
        "history": history,
        "latest": history[0] if history else None,
        "source": "nasdaq",
    }
    _EARNINGS_DETAIL_CACHE[("nasdaq", sym)] = (_time.time(), out)
    return out


def yfinance_earnings_surprise(symbol: str) -> dict:
    """Same-shape surprise history via yfinance get_earnings_dates (free).

    Nasdaq surprise table often lags BMO prints until late day / next day;
    yfinance usually has Reported EPS within minutes of the release.
    """
    import time as _time
    from datetime import datetime
    sym = (symbol or "").strip().upper()
    if not sym:
        return {"history": [], "latest": None, "source": "yfinance"}
    hit = _EARNINGS_DETAIL_CACHE.get(("yf", sym))
    # Short TTL — same-day results appear during the session
    if hit and _time.time() - hit[0] < 600:
        return hit[1]
    history: list[dict] = []
    try:
        import yfinance as yf
        t = yf.Ticker(sym)
        df = None
        try:
            df = t.get_earnings_dates(limit=12)
        except Exception:
            df = getattr(t, "earnings_dates", None)
        if df is not None and len(df) > 0:
            # Columns: EPS Estimate, Reported EPS, Surprise(%)
            for idx, row in df.iterrows():
                try:
                    actual = row.get("Reported EPS")
                    est = row.get("EPS Estimate")
                    surp = row.get("Surprise(%)")
                except Exception:
                    actual = est = surp = None
                try:
                    if actual is not None and actual == actual:  # not NaN
                        actual = float(actual)
                    else:
                        actual = None
                except Exception:
                    actual = None
                try:
                    if est is not None and est == est:
                        est = float(est)
                    else:
                        est = None
                except Exception:
                    est = None
                try:
                    if surp is not None and surp == surp:
                        surp = float(surp)
                    else:
                        surp = None
                except Exception:
                    surp = None
                # Skip pure future rows with no actual
                if actual is None and est is None:
                    continue
                # Date from index
                d_iso = ""
                try:
                    if hasattr(idx, "date"):
                        d_iso = idx.date().isoformat()
                    else:
                        d_iso = str(idx)[:10]
                except Exception:
                    d_iso = str(idx)[:10]
                # yfinance Surprise(%) is already percent points (e.g. 9.93)
                history.append({
                    "fiscal_quarter": "",
                    "date_reported": d_iso,
                    "eps_actual": actual,
                    "eps_estimate": est,
                    "surprise_pct": round(surp, 2) if surp is not None else (
                        round((actual - est) / abs(est) * 100, 2)
                        if actual is not None and est not in (None, 0) else None
                    ),
                    "beat": _beat_from_eps(actual, est) if actual is not None else None,
                    "source": "yfinance",
                })
    except Exception as e:
        print(f"[market_data] yfinance earnings {sym} failed: {e!s:.120}", flush=True)
    out = {
        "history": history,
        "latest": next((h for h in history if h.get("eps_actual") is not None),
                       history[0] if history else None),
        "source": "yfinance",
    }
    _EARNINGS_DETAIL_CACHE[("yf", sym)] = (_time.time(), out)
    return out


def _earnings_report_window_passed(event_date_iso: str, session: str) -> bool:
    """True if the expected print window for this event is already over (ET).

    BMO → after 09:30 America/New_York on event day.
    AMC → after 16:00 ET on event day.
    Unknown → after 12:00 ET on event day.
    Past calendar days → always True.
    """
    from datetime import date, datetime, time as dtime
    try:
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
    except Exception:
        et = None
    try:
        ev = date.fromisoformat(str(event_date_iso)[:10])
    except Exception:
        return False
    now = datetime.now(et) if et else datetime.utcnow()
    today = now.date()
    if ev < today:
        return True
    if ev > today:
        return False
    sess = (session or "").upper()
    if sess == "BMO":
        cutoff = dtime(9, 30)
    elif sess == "AMC":
        cutoff = dtime(16, 0)
    else:
        cutoff = dtime(12, 0)
    return now.timetz().replace(tzinfo=None) >= cutoff if hasattr(now, "timetz") else now.time() >= cutoff


def earnings_card(symbol: str, horizon_days: int = 5,
                  include_past_days: int = 1) -> dict:
    """Full earnings card payload for watchlist chip click.

    Combines calendar event + surprise history + beat/miss.
    Free sources: Nasdaq calendar/surprise, yfinance earnings_dates fallback
    when Nasdaq lags same-day BMO/AMC prints. No LLM.
    """
    from datetime import date, datetime, timedelta
    sym = (symbol or "").strip().upper()
    if not sym:
        return {"ok": False, "error": "invalid ticker"}

    upcoming = earnings_upcoming([sym], horizon_days=horizon_days,
                                 include_past_days=include_past_days).get(sym)
    surprise = nasdaq_earnings_surprise(sym)
    history = list(surprise.get("history") or [])
    latest = surprise.get("latest")
    result_source = "nasdaq"

    # Session label from calendar
    session = ""
    if upcoming:
        tlabel = (upcoming.get("time") or "").lower()
        if "pre" in tlabel:
            session = "BMO"
        elif "after" in tlabel or "post" in tlabel:
            session = "AMC"

    def _match_event(row: dict) -> bool:
        if not row:
            return False
        reported_d = _parse_reported_date(row.get("date_reported"))
        if reported_d is None:
            return False
        today = date.today()
        age = (today - reported_d).days
        if age < 0 or age > 14:
            return False
        if upcoming and upcoming.get("date"):
            try:
                ev = date.fromisoformat(str(upcoming["date"])[:10])
                # Same day or within 2 calendar days (Yahoo often stamps
                # BMO prints the evening before ET).
                if abs((reported_d - ev).days) <= 2:
                    return True
            except Exception:
                pass
        return age <= 3 and row.get("eps_actual") is not None

    # Determine if latest surprise is "this" event (reported within window)
    result = None
    status = "scheduled"  # scheduled | reported | pending_update | unknown
    if latest and _match_event(latest):
        result = latest
        status = "reported" if latest.get("eps_actual") is not None else "pending_update"
        result_source = latest.get("source") or "nasdaq"

    # Nasdaq lag: yfinance often has Reported EPS same morning for BMO
    if status != "reported" or (result and result.get("eps_actual") is None):
        yf_s = yfinance_earnings_surprise(sym)
        yf_latest = yf_s.get("latest")
        if yf_latest and yf_latest.get("eps_actual") is not None and _match_event(yf_latest):
            result = dict(yf_latest)
            status = "reported"
            result_source = "yfinance"
            # Prefer Nasdaq calendar consensus for beat/miss when available
            # (Street estimate users expect); keep yfinance actual.
            cal_est = _parse_money_num((upcoming or {}).get("eps_forecast"))
            if cal_est is not None:
                result["eps_estimate"] = cal_est
                result["beat"] = _beat_from_eps(result.get("eps_actual"), cal_est)
                try:
                    a = float(result["eps_actual"])
                    result["surprise_pct"] = round(
                        (a - float(cal_est)) / abs(float(cal_est)) * 100.0, 2)
                except Exception:
                    pass
                result_source = "yfinance+nasdaq"
            if not any(
                h.get("date_reported") == yf_latest.get("date_reported")
                and h.get("eps_actual") == yf_latest.get("eps_actual")
                for h in history
            ):
                history = [result] + history

    # After the expected print window, never keep saying "scheduled / AWAITING"
    if upcoming and status != "reported":
        du = upcoming.get("days_until")
        try:
            du_i = int(du) if du is not None else 0
        except (TypeError, ValueError):
            du_i = 0
        past_window = du_i < 0 or (
            du_i == 0 and _earnings_report_window_passed(
                str(upcoming.get("date") or ""), session)
        )
        if past_window:
            status = "pending_update"
        else:
            status = "scheduled"

    eps_est = None
    if result and result.get("eps_estimate") is not None:
        eps_est = result["eps_estimate"]
    elif upcoming:
        eps_est = _parse_money_num(upcoming.get("eps_forecast"))

    beat = (result or {}).get("beat")
    surprise_pct = (result or {}).get("surprise_pct")
    if (beat is None and result and result.get("eps_actual") is not None
            and eps_est is not None):
        beat = _beat_from_eps(result.get("eps_actual"), eps_est)
    if (surprise_pct is None and result and result.get("eps_actual") is not None
            and eps_est not in (None, 0)):
        try:
            surprise_pct = round(
                (float(result["eps_actual"]) - float(eps_est))
                / abs(float(eps_est)) * 100.0, 2)
        except Exception:
            pass

    # Street range / revenue consensus from Yahoo calendar (free, no LLM)
    street_range: dict = {}
    try:
        street_range = yfinance_earnings_calendar_context(sym) or {}
    except Exception as e:
        print(f"[market_data] calendar context {sym}: {e!s:.100}", flush=True)

    # Actual quarterly revenue (+ EPS fallback) from Yahoo income stmt (free).
    # CRITICAL: never treat a prior filed quarter's statement as "this" print
    # when the calendar event is still in the future (TSLA ticket 68525f84 —
    # card showed $0.13 actual for a Jun/2026 print still days away).
    actuals: dict = {}
    event_still_future = False
    if upcoming:
        try:
            du_chk = int(upcoming.get("days_until")) if upcoming.get("days_until") is not None else None
        except (TypeError, ValueError):
            du_chk = None
        if du_chk is not None and du_chk > 0:
            event_still_future = True
        elif du_chk == 0 and not _earnings_report_window_passed(
                str(upcoming.get("date") or ""), session):
            event_still_future = True

    try:
        fq_hint = (
            (upcoming or {}).get("fiscal_quarter")
            or (result or {}).get("fiscal_quarter")
            or ""
        )
        # Only pull statement actuals when print window is open/past —
        # never for pure future events.
        if not event_still_future:
            actuals = yfinance_quarterly_actuals(sym, fiscal_quarter_hint=fq_hint) or {}
            if actuals and fq_hint and not _fiscal_quarter_labels_match(
                    fq_hint, actuals.get("period_label") or ""):
                actuals = {}
    except Exception as e:
        print(f"[market_data] quarterly actuals {sym}: {e!s:.100}", flush=True)

    # Future print: never show actuals / beat / miss for this event
    if event_still_future:
        result = None
        status = "scheduled"
        beat = None
        surprise_pct = None
        eps_actual_final = None
        rev_actual = None
    else:
        eps_actual_final = (result or {}).get("eps_actual")
        # Statement fill-in only after a real report match or post-window pending
        if (eps_actual_final is None and actuals.get("eps_actual") is not None
                and status in ("reported", "pending_update")):
            eps_actual_final = actuals.get("eps_actual")
            if status == "pending_update":
                status = "reported"
                result_source = (
                    (result_source or "") + "+yf_stmt" if result_source else "yf_stmt"
                )
        rev_actual = actuals.get("revenue_actual")
    # Yahoo quarterly income stmt often lags the print by days while Nasdaq/YF
    # already have EPS (TREX ticket SUP_20260805). Pull revenue from the Item
    # 2.02 8-K exhibit 99 press release when statement actuals are missing.
    # Always keep press_release_url when an 8-K is found (IR deep-link).
    press_release_url = None
    filing_url = None
    if not event_still_future and status in ("reported", "pending_update", "scheduled"):
        # For scheduled (today) we still try IR/SEC links after window; for past
        # prints we also want the 8-K URL even when Yahoo already has revenue.
        try:
            rd = (
                (result or {}).get("date_reported")
                or (upcoming or {}).get("date")
                or ""
            )
            try:
                from datetime import datetime as _dt
                if rd and "/" in str(rd):
                    rd = _dt.strptime(str(rd)[:10], "%m/%d/%Y").date().isoformat()
            except Exception:
                pass
            # Only hit SEC when print window is open/past (not pure future).
            if status in ("reported", "pending_update") or (
                upcoming and (upcoming.get("days_until") is not None)
                and int(upcoming.get("days_until") or 0) <= 0
            ):
                k8 = sec_8k_earnings_release_actuals(sym, report_date=str(rd)[:10] or None)
                press_release_url = k8.get("press_release_url") or None
                filing_url = k8.get("filing_url") or None
                if rev_actual is None and k8.get("revenue_actual") is not None:
                    rev_actual = k8["revenue_actual"]
                    result_source = (
                        (result_source or "") + "+sec8k" if result_source else "sec8k"
                    )
                    if not actuals:
                        actuals = {
                            "revenue_actual": rev_actual,
                            "period_label": (
                                (upcoming or {}).get("fiscal_quarter")
                                or (result or {}).get("fiscal_quarter")
                                or ""
                            ),
                            "source": "sec_8k_ex99",
                            "filed": k8.get("filed"),
                        }
                    else:
                        actuals = dict(actuals)
                        actuals["revenue_actual"] = rev_actual
                        actuals["source"] = (
                            str(actuals.get("source") or "") + "+sec8k"
                        ).strip("+")
        except Exception as e:
            print(f"[market_data] 8-K rev fill {sym}: {e!s:.120}", flush=True)

    # Company IR site (Yahoo free profile) — always try for the earnings card link.
    ir_links: dict = {}
    try:
        ir_links = company_ir_links(sym) or {}
    except Exception as e:
        print(f"[market_data] ir_links card {sym}: {e!s:.100}", flush=True)

    rev_estimate = street_range.get("revenue_avg")
    rev_surprise_pct = None
    rev_beat = None
    if rev_actual is not None and rev_estimate not in (None, 0):
        try:
            ra, re_ = float(rev_actual), float(rev_estimate)
            rev_surprise_pct = round((ra - re_) / abs(re_) * 100.0, 2)
            rev_beat = _beat_from_eps(ra, re_)  # same > / < / = logic
        except Exception:
            pass

    # Recompute EPS beat if we filled actual from statement
    if beat is None and eps_actual_final is not None and eps_est is not None:
        beat = _beat_from_eps(eps_actual_final, eps_est)
    if surprise_pct is None and eps_actual_final is not None and eps_est not in (None, 0):
        try:
            surprise_pct = round(
                (float(eps_actual_final) - float(eps_est))
                / abs(float(eps_est)) * 100.0, 2)
        except Exception:
            pass

    notes = build_earnings_notes(
        symbol=sym,
        status=status,
        beat=beat,
        surprise_pct=surprise_pct,
        eps_actual=eps_actual_final,
        eps_estimate=eps_est,
        history=history,
        event={
            "date": (upcoming or {}).get("date") or (result or {}).get("date_reported"),
            "fiscal_quarter": (
                (upcoming or {}).get("fiscal_quarter")
                or (result or {}).get("fiscal_quarter") or ""
            ),
            "session": session,
            "name": (upcoming or {}).get("name") or "",
        },
        street=street_range,
        revenue_actual=rev_actual,
        revenue_estimate=rev_estimate,
        revenue_surprise_pct=rev_surprise_pct,
        revenue_beat=rev_beat,
    )

    return {
        "ok": True,
        "ticker": sym,
        "status": status,  # scheduled | reported | pending_update
        "source": result_source if status == "reported" else "nasdaq",
        "event": {
            "date": (upcoming or {}).get("date") or (result or {}).get("date_reported"),
            "days_until": (upcoming or {}).get("days_until"),
            "session": session,
            "time": (upcoming or {}).get("time") or "",
            "fiscal_quarter": (
                (upcoming or {}).get("fiscal_quarter")
                or (result or {}).get("fiscal_quarter")
                or actuals.get("period_label")
                or ""
            ),
            "name": (upcoming or {}).get("name") or "",
        } if (upcoming or result or actuals) else None,
        "result": {
            "eps_actual": eps_actual_final,
            "eps_estimate": eps_est,
            "surprise_pct": surprise_pct,
            "beat": beat,  # beat | miss | inline | null
            "date_reported": (result or {}).get("date_reported"),
            "fiscal_quarter": (result or {}).get("fiscal_quarter") or actuals.get("period_label"),
            "eps_high": street_range.get("eps_high"),
            "eps_low": street_range.get("eps_low"),
            "eps_avg": street_range.get("eps_avg"),
            # Revenue: actual (Yahoo quarterly stmt) next to consensus (calendar)
            "revenue_actual": rev_actual,
            "revenue_estimate": rev_estimate,
            "revenue_high": street_range.get("revenue_high"),
            "revenue_low": street_range.get("revenue_low"),
            "revenue_surprise_pct": rev_surprise_pct,
            "revenue_beat": rev_beat,
            "period_end": actuals.get("period_end"),
        } if (result or eps_est is not None or street_range or actuals) else None,
        "history": history[:8],
        "notes": notes,
        # External deep-links (free): company IR site + latest SEC press release
        "investor_relations_url": ir_links.get("ir_url") or None,
        "website_url": ir_links.get("website") or None,
        "press_release_url": press_release_url or None,
        "filing_url": filing_url or None,
        "cost": "free · no LLM",
    }


def _fiscal_quarter_labels_match(hint: str, label: str) -> bool:
    """True if calendar fiscal hint (e.g. 'Jun/2026') matches a period label ('Jun 2026')."""
    import re
    h = (hint or "").replace("/", " ").strip().lower()
    lab = (label or "").replace("/", " ").strip().lower()
    if not h or not lab:
        return False
    # Extract month token + 4-digit year from both
    months = ("jan", "feb", "mar", "apr", "may", "jun",
              "jul", "aug", "sep", "oct", "nov", "dec")
    def _parts(s: str):
        m = next((x for x in months if x in s), None)
        ys = re.findall(r"20\d{2}", s)
        y = ys[-1] if ys else None
        return m, y
    hm, hy = _parts(h)
    lm, ly = _parts(lab)
    if hy and ly and hy != ly:
        return False
    if hm and lm and hm != lm:
        return False
    # If both have month+year and they match
    if hm and hy and lm and ly:
        return hm == lm and hy == ly
    # Fallback: year match + month substring
    if hy and hy in lab and (not hm or hm in lab):
        return True
    return False


def yfinance_quarterly_actuals(symbol: str, fiscal_quarter_hint: str = "") -> dict:
    """Actual diluted EPS + total revenue from Yahoo quarterly income statement.

    Free, no LLM. Matches fiscal_quarter_hint (e.g. 'Jun 2026' / 'Jun/2026')
    when possible. If a hint is given and no column matches that quarter,
    returns {} — never a different quarter's actuals (avoids pre-print false MISS).
    Without a hint, returns the most recent quarter with non-null EPS or revenue.
    """
    import time as _time
    from datetime import datetime
    sym = (symbol or "").strip().upper()
    if not sym:
        return {}
    hit = _EARNINGS_DETAIL_CACHE.get(("yf_qact", sym, fiscal_quarter_hint or ""))
    if hit and _time.time() - hit[0] < 900:
        return hit[1]
    out: dict = {}
    try:
        import yfinance as yf
        import math
        t = yf.Ticker(sym)
        df = getattr(t, "quarterly_income_stmt", None)
        if df is None or getattr(df, "empty", True):
            _EARNINGS_DETAIL_CACHE[("yf_qact", sym, fiscal_quarter_hint or "")] = (_time.time(), {})
            return {}

        def _num(v):
            try:
                if v is None:
                    return None
                f = float(v)
                if math.isnan(f) or math.isinf(f):
                    return None
                return f
            except Exception:
                return None

        def _label(col) -> str:
            try:
                if hasattr(col, "to_pydatetime"):
                    d = col.to_pydatetime()
                elif hasattr(col, "month"):
                    d = col
                else:
                    d = datetime.fromisoformat(str(col)[:10])
                return d.strftime("%b %Y")  # e.g. Jun 2026
            except Exception:
                return str(col)[:12]

        def _iso(col) -> str:
            try:
                if hasattr(col, "date"):
                    return col.date().isoformat()
                return str(col)[:10]
            except Exception:
                return ""

        hint = (fiscal_quarter_hint or "").replace("/", " ").strip()
        cols = list(df.columns)
        require_match = bool(hint)

        for col in cols:
            lab = _label(col)
            if require_match and not _fiscal_quarter_labels_match(hint, lab):
                continue
            rev = None
            eps = None
            for rev_key in ("Total Revenue", "Operating Revenue", "TotalRevenue", "Revenue"):
                if rev_key in df.index:
                    rev = _num(df.loc[rev_key, col])
                    if rev is not None:
                        break
            for eps_key in ("Diluted EPS", "Basic EPS", "DilutedEPS", "BasicEPS"):
                if eps_key in df.index:
                    eps = _num(df.loc[eps_key, col])
                    if eps is not None:
                        break
            if rev is None and eps is None:
                continue
            out = {
                "period_end": _iso(col),
                "period_label": lab,
                "revenue_actual": rev,
                "eps_actual": eps,
                "source": "yfinance_quarterly_income",
                "matched_hint": require_match,
            }
            break
        # No matching quarter for a strict hint → empty (do not fall back)
        if require_match and not out:
            out = {}
    except Exception as e:
        print(f"[market_data] yf quarterly actuals {sym}: {e!s:.120}", flush=True)
        out = {}
    _EARNINGS_DETAIL_CACHE[("yf_qact", sym, fiscal_quarter_hint or "")] = (_time.time(), out)
    return out


def _sec_ua() -> str:
    """Identifying User-Agent for SEC EDGAR (required). Prefer env."""
    ua = (os.environ.get("SEC_USER_AGENT") or "").strip()
    if ua:
        return ua
    try:
        import DGA_analyst as _a  # type: ignore
        return _a.get_sec_user_agent()
    except Exception:
        # Last resort — still identify the app (anonymous UA is blocked)
        return "DGA-Capital-Research contact@dgacapital.com"


def _parse_money_phrase_to_float(num: str, unit: str) -> float | None:
    """'$418' + 'million' → 418e6; '1.25' + 'billion' → 1.25e9; bare '418,019' thousands handled by caller."""
    try:
        n = float(str(num).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None
    u = (unit or "").strip().lower()
    if u.startswith("b"):
        return n * 1_000_000_000.0
    if u.startswith("m"):
        return n * 1_000_000.0
    if u.startswith("k") or u.startswith("thousand"):
        return n * 1_000.0
    return n


def _extract_revenue_from_earnings_text(text: str) -> dict:
    """Pull quarterly revenue/net sales from an 8-K exhibit 99 press release.

    Prefers explicit dollar+unit phrases over table cells in thousands.
    Returns {revenue_actual, snippet, method} or {}.
    """
    import re as _re
    if not text:
        return {}
    # Strip HTML / collapse whitespace
    t = _re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text)
    t = _re.sub(r"(?is)<style[^>]*>.*?</style>", " ", t)
    t = _re.sub(r"(?is)<[^>]+>", " ", t)
    t = _re.sub(r"&#\d+;|&[a-z]+;", " ", t, flags=_re.I)  # &#8226; bullets, etc.
    t = _re.sub(r"\s+", " ", t)

    # High-confidence prose patterns (quarter just reported)
    # Note: "revenues" (plural) and "sales" used by many industrial filers (CMI).
    rev_words = (
        r"(?:net\s+sales|total\s+(?:net\s+)?sales|total\s+revenues?|net\s+revenues?|"
        r"revenues?|sales)"
    )
    patterns = [
        # Net sales of $418 million / revenues of $9.5 billion
        rev_words
        + r"\s+(?:of|were|was|reached|totaled|totalled)\s*\$?\s*"
        + r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million|bn|mm|m|b)\b",
        # second-quarter revenues of $9.5 billion / Record … revenues of …
        r"(?:first|second|third|fourth|1st|2nd|3rd|4th)?\s*-?\s*"
        r"(?:quarter|qtr)?\s*" + rev_words
        + r"\s+(?:of|were|was)\s*\$?\s*"
        + r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million|bn|mm|m|b)\b",
        # increased X% to $418 million
        rev_words + r"\s+"
        r"(?:increased|decreased|rose|fell|grew|declined)[^\.]{0,80}?\s+to\s+"
        r"\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million|bn|mm|m|b)\b",
        # reported revenue/net sales of $…
        r"reported\s+" + rev_words + r"\s+of\s+"
        r"\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million|bn|mm|m|b)\b",
    ]
    hits: list[tuple[float, str, str]] = []
    for pat in patterns:
        for m in _re.finditer(pat, t, _re.I):
            val = _parse_money_phrase_to_float(m.group(1), m.group(2))
            if val is None or val < 50_000:  # ignore tiny / parse noise
                continue
            # Skip obvious full-year guidance bands when "full year" nearby
            ctx = t[max(0, m.start() - 80): m.end() + 40].lower()
            if any(x in ctx for x in (
                "full year", "full-year", "fy 20", "guidance ranging",
                "guidance of", "outlook of", "for the year",
            )) and "quarter" not in ctx and "second quarter" not in ctx \
                    and "first quarter" not in ctx and "third quarter" not in ctx \
                    and "fourth quarter" not in ctx:
                continue
            hits.append((val, m.group(0)[:160], "prose"))

    if hits:
        # Prefer company-level quarterly print over segment lines / FY guidance
        def _score(item):
            val, snip, _ = item
            s = snip.lower()
            sc = 0
            if "net sales" in s:
                sc += 4
            if "revenues of" in s or "revenue of" in s or "sales of" in s:
                sc += 3
            if any(q in s for q in (
                "quarter", "q1", "q2", "q3", "q4", "second-quarter",
                "first-quarter", "third-quarter", "fourth-quarter",
            )):
                sc += 4
            if "record" in s:
                sc += 1
            if "segment" in s or "engine segment" in s or "components" in s:
                sc -= 6
            if any(x in s for x in ("full year", "full-year", "fy ", "guidance")):
                sc -= 8
            # Prefer mid/large company totals over tiny segment noise
            if val >= 1_000_000_000:
                sc += 1
            return sc
        hits.sort(key=_score, reverse=True)
        val, snip, method = hits[0]
        return {
            "revenue_actual": float(val),
            "snippet": snip,
            "method": method,
        }

    # Fallback: income statement table row "Net sales $418,019 $387,801" (thousands)
    m = _re.search(
        r"(?:net\s+sales|total\s+revenue|revenue)\s+\$?\s*([0-9]{2,3}(?:,[0-9]{3})+)"
        r"(?:\s+\$?\s*[0-9,]+)?",
        t,
        _re.I,
    )
    if m:
        try:
            raw = float(m.group(1).replace(",", ""))
            # SEC press tables for mid/large caps are almost always $000s
            if 100 <= raw <= 50_000_000:
                val = raw * 1000.0
                return {
                    "revenue_actual": val,
                    "snippet": m.group(0)[:160],
                    "method": "table_thousands",
                }
        except (TypeError, ValueError):
            pass
    return {}


# Serialize SEC 8-K revenue pulls — concurrent card opens must not stampede EDGAR.
_SEC8K_FETCH_LOCK = __import__("threading").Semaphore(2)


class _Sec8kDone(Exception):
    """Internal control-flow for early exit while still releasing the semaphore."""


def sec_8k_earnings_release_actuals(
    symbol: str,
    report_date: str | None = None,
    *,
    max_age_days: int = 21,
) -> dict:
    """Actual revenue (and optional EPS hint) from the latest Item 2.02 8-K exhibit 99.

    Free SEC EDGAR only. Used when Yahoo quarterly income stmt still lags the print
    (ticket SUP_20260805 — TREX etc. showed EPS from Nasdaq but Actual Revenue blank).

    Hardened after ui418 deploy: company_tickers map is process-cached (see
    sec_edgar_xbrl.resolve_cik) and 8-K fetches are concurrency-limited so a
    multi-name desk open cannot 429-storm SEC and starve the worker pool.
    """
    import time as _time
    import re as _re
    from datetime import date, datetime, timedelta
    import requests as _req

    sym = (symbol or "").strip().upper()
    if not sym:
        return {}
    cache_key = ("sec8k_rev", sym, (report_date or "")[:10])
    hit = _EARNINGS_DETAIL_CACHE.get(cache_key)
    if hit and _time.time() - hit[0] < 1800:
        return hit[1]

    out: dict = {}
    # Non-blocking: if two 8-K pulls already in flight, skip rather than queue
    # (card can retry; avoids deploy-time worker exhaustion under SEC 429).
    if not _SEC8K_FETCH_LOCK.acquire(blocking=False):
        print(f"[market_data] 8-K rev {sym}: skipped (concurrency cap)", flush=True)
        return {}
    try:
        try:
            import sec_edgar_xbrl as _edgar
            ua = _sec_ua()
            try:
                cik = _edgar.resolve_cik(sym, user_agent=ua)
            except Exception as e:
                print(f"[market_data] 8-K CIK {sym}: {e!s:.100}", flush=True)
                out = {}
                raise _Sec8kDone()
            cik10 = str(cik).zfill(10)
            cik_int = str(int(cik10))
            r = _req.get(
                f"https://data.sec.gov/submissions/CIK{cik10}.json",
                headers={"User-Agent": ua, "Accept-Encoding": "gzip, deflate"},
                timeout=25,
            )
            if r.status_code != 200:
                out = {}
                raise _Sec8kDone()
            recent = (r.json().get("filings") or {}).get("recent") or {}
            forms = recent.get("form") or []
            dates = recent.get("filingDate") or []
            items = recent.get("items") or []
            accs = recent.get("accessionNumber") or []
            primaries = recent.get("primaryDocument") or []

            target: date | None = None
            if report_date:
                try:
                    target = date.fromisoformat(str(report_date)[:10])
                except Exception:
                    try:
                        target = datetime.strptime(str(report_date)[:10], "%m/%d/%Y").date()
                    except Exception:
                        target = None
            today = date.today()
            floor = today - timedelta(days=max_age_days)

            chosen = None
            for i, form in enumerate(forms[:80]):
                if form not in ("8-K", "8-K/A"):
                    continue
                it = str(items[i] if i < len(items) else "") or ""
                if "2.02" not in it:
                    continue
                filed_s = str(dates[i] if i < len(dates) else "")[:10]
                if not filed_s:
                    continue
                try:
                    filed_d = date.fromisoformat(filed_s)
                except Exception:
                    continue
                if filed_d < floor:
                    continue
                if target is not None and abs((filed_d - target).days) > 5:
                    continue
                chosen = {
                    "filed": filed_s,
                    "accession": accs[i] if i < len(accs) else None,
                    "primary": primaries[i] if i < len(primaries) else None,
                    "items": it,
                }
                break
            if not chosen or not chosen.get("accession"):
                out = {}
                raise _Sec8kDone()

            acc = str(chosen["accession"]).replace("-", "")
            # Filing index for exhibit list
            idx_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc}/index.json"
            idx = _req.get(
                idx_url,
                headers={"User-Agent": ua, "Accept-Encoding": "gzip, deflate"},
                timeout=20,
            )
            docs: list[str] = []
            if idx.status_code == 200:
                try:
                    items_d = ((idx.json().get("directory") or {}).get("item")) or []
                    for it in items_d:
                        name = str(it.get("name") or "")
                        if not name:
                            continue
                        low = name.lower()
                        if not (low.endswith(".htm") or low.endswith(".html") or low.endswith(".txt")):
                            continue
                        docs.append(name)
                except Exception:
                    pass
            if chosen.get("primary"):
                docs.insert(0, str(chosen["primary"]))

            def _doc_score(name: str) -> int:
                low = name.lower()
                sc = 0
                if "ex99" in low or "ex-99" in low or "exhibit99" in low or "ex99" in low.replace("-", ""):
                    sc += 50
                if "ex99_1" in low or "ex-99.1" in low or "ex991" in low:
                    sc += 20
                if any(x in low for x in ("earn", "release", "press", "news", "results")):
                    sc += 15
                if low.endswith(".htm") or low.endswith(".html"):
                    sc += 5
                # Prefer larger narrative exhibits over thin cover 8-K shells
                if low.endswith(".txt"):
                    sc += 8  # full submission text usually includes ex99
                if "8-k" in low or (low.startswith("form") and "ex" not in low):
                    sc -= 5
                if "graph" in low or "image" in low or low.endswith(".jpg") or low.endswith(".png"):
                    sc -= 30
                if "index" in low or "header" in low:
                    sc -= 40
                return sc

            docs = sorted(set(docs), key=_doc_score, reverse=True)
            filing_base = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc}/"
            # Always expose the filing folder (and best exhibit guess) so the
            # earnings card can deep-link the IR / press-release PDF or HTML.
            best_doc = docs[0] if docs else (chosen.get("primary") or "")
            out = {
                "filed": chosen.get("filed"),
                "accession": chosen.get("accession"),
                "document": best_doc or None,
                "filing_url": filing_base,
                "press_release_url": (filing_base + str(best_doc)) if best_doc else filing_base,
                "source": "sec_8k",
            }
            # Cap downloads (prefer ex99 / earnings release first)
            for name in docs[:8]:
                url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc}/{name}"
                try:
                    pr = _req.get(
                        url,
                        headers={"User-Agent": ua, "Accept-Encoding": "gzip, deflate"},
                        timeout=25,
                    )
                except Exception:
                    continue
                if pr.status_code != 200 or len(pr.text or "") < 400:
                    continue
                parsed = _extract_revenue_from_earnings_text(pr.text)
                if parsed.get("revenue_actual"):
                    out = {
                        "revenue_actual": parsed["revenue_actual"],
                        "source": "sec_8k_ex99",
                        "filed": chosen.get("filed"),
                        "accession": chosen.get("accession"),
                        "document": name,
                        "snippet": parsed.get("snippet"),
                        "method": parsed.get("method"),
                        "filing_url": filing_base,
                        "press_release_url": url,
                    }
                    break
                # tiny pause between SEC hits
                _time.sleep(0.12)
        except _Sec8kDone:
            pass
        except Exception as e:
            print(f"[market_data] 8-K earnings release {sym}: {e!s:.140}", flush=True)
            out = {}
        _EARNINGS_DETAIL_CACHE[cache_key] = (_time.time(), out)
        if out:
            print(
                f"[market_data] 8-K rev {sym}: ${out.get('revenue_actual'):,.0f} "
                f"from {out.get('document')} filed {out.get('filed')}",
                flush=True,
            )
        return out
    finally:
        _SEC8K_FETCH_LOCK.release()


def yfinance_earnings_calendar_context(symbol: str) -> dict:
    """Street range (EPS high/low/avg + revenue band) from yfinance calendar."""
    import time as _time
    sym = (symbol or "").strip().upper()
    if not sym:
        return {}
    hit = _EARNINGS_DETAIL_CACHE.get(("yf_cal", sym))
    if hit and _time.time() - hit[0] < 1800:
        return hit[1]
    out: dict = {}
    try:
        import yfinance as yf
        cal = getattr(yf.Ticker(sym), "calendar", None) or {}
        if isinstance(cal, dict):
            for src, dst in (
                ("Earnings High", "eps_high"),
                ("Earnings Low", "eps_low"),
                ("Earnings Average", "eps_avg"),
                ("Revenue High", "revenue_high"),
                ("Revenue Low", "revenue_low"),
                ("Revenue Average", "revenue_avg"),
            ):
                v = cal.get(src)
                if v is None:
                    continue
                try:
                    out[dst] = float(v)
                except (TypeError, ValueError):
                    pass
            # Next earnings date list if present
            ed = cal.get("Earnings Date")
            if isinstance(ed, (list, tuple)) and ed:
                try:
                    d0 = ed[0]
                    out["next_earnings_date"] = (
                        d0.isoformat() if hasattr(d0, "isoformat") else str(d0)[:10]
                    )
                except Exception:
                    pass
    except Exception as e:
        print(f"[market_data] yf calendar {sym}: {e!s:.100}", flush=True)
    _EARNINGS_DETAIL_CACHE[("yf_cal", sym)] = (_time.time(), out)
    return out


def yahoo_earnings_headlines(symbol: str, limit: int = 4) -> list[dict]:
    """Recent free Yahoo headlines mentioning earnings / print (no LLM)."""
    import time as _time
    import re as _re
    sym = (symbol or "").strip().upper()
    if not sym:
        return []
    hit = _EARNINGS_DETAIL_CACHE.get(("yf_news", sym))
    if hit and _time.time() - hit[0] < 900:
        return hit[1]
    out: list[dict] = []
    keys = _re.compile(
        r"earn|eps|quarter|guidance|outlook|beat|miss|forecast|results|print|revenue|profit",
        _re.I,
    )
    try:
        import yfinance as yf
        news = getattr(yf.Ticker(sym), "news", None) or []
        for item in news:
            c = item.get("content") if isinstance(item, dict) else None
            if not isinstance(c, dict):
                c = item if isinstance(item, dict) else {}
            title = (c.get("title") or item.get("title") or "").strip()
            if not title or not keys.search(title):
                continue
            pub = ""
            try:
                pub = (
                    (c.get("provider") or {}).get("displayName")
                    or item.get("publisher")
                    or ""
                )
            except Exception:
                pub = item.get("publisher") or ""
            url = ""
            try:
                url = (
                    (c.get("canonicalUrl") or {}).get("url")
                    or (c.get("clickThroughUrl") or {}).get("url")
                    or item.get("link")
                    or ""
                )
            except Exception:
                url = item.get("link") or ""
            out.append({"title": title[:180], "publisher": str(pub)[:60], "url": url})
            if len(out) >= limit:
                break
    except Exception as e:
        print(f"[market_data] yf news {sym}: {e!s:.100}", flush=True)
    _EARNINGS_DETAIL_CACHE[("yf_news", sym)] = (_time.time(), out)
    return out


def build_earnings_notes(
    *,
    symbol: str,
    status: str,
    beat: str | None,
    surprise_pct,
    eps_actual,
    eps_estimate,
    history: list | None,
    event: dict | None,
    street: dict | None,
    revenue_actual=None,
    revenue_estimate=None,
    revenue_surprise_pct=None,
    revenue_beat: str | None = None,
) -> dict:
    """Structured free commentary for the earnings card empty space (no LLM)."""
    bullets: list[str] = []
    vs = ""
    tone = "neutral"
    fq = (event or {}).get("fiscal_quarter") or ""
    name = (event or {}).get("name") or symbol

    def _fmt_eps(v):
        try:
            return f"${float(v):.2f}"
        except Exception:
            return "—"

    def _fmt_rev(v):
        try:
            n = float(v)
            if abs(n) >= 1e9:
                return f"${n/1e9:.2f}B"
            if abs(n) >= 1e6:
                return f"${n/1e6:.1f}M"
            return f"${n:,.0f}"
        except Exception:
            return "—"

    if status == "reported" and eps_actual is not None:
        sp = None
        try:
            sp = float(surprise_pct) if surprise_pct is not None else None
        except Exception:
            sp = None
        if beat == "beat":
            tone = "beat"
            vs = f"Beat Street" + (f" by {sp:+.1f}%" if sp is not None else "")
            bullets.append(
                f"EPS {_fmt_eps(eps_actual)} vs {_fmt_eps(eps_estimate)} consensus"
                + (f" · beat {sp:+.1f}%" if sp is not None else " · beat")
                + (f" · {fq}" if fq else "")
            )
        elif beat == "miss":
            tone = "miss"
            vs = f"Missed Street" + (f" by {sp:.1f}%" if sp is not None else "")
            bullets.append(
                f"EPS {_fmt_eps(eps_actual)} vs {_fmt_eps(eps_estimate)} consensus"
                + (f" · miss {sp:.1f}%" if sp is not None else " · miss")
                + (f" · {fq}" if fq else "")
            )
        elif beat == "inline":
            tone = "inline"
            vs = "In line with Street"
            bullets.append(
                f"EPS {_fmt_eps(eps_actual)} matched {_fmt_eps(eps_estimate)} consensus"
                + (f" · {fq}" if fq else "")
            )
        else:
            bullets.append(
                f"EPS {_fmt_eps(eps_actual)}"
                + (f" vs {_fmt_eps(eps_estimate)} est" if eps_estimate is not None else "")
                + (f" · {fq}" if fq else "")
            )
    elif status == "pending_update":
        tone = "pending"
        vs = "Print window passed · results lagging free feeds"
        if eps_estimate is not None:
            bullets.append(f"Street was at {_fmt_eps(eps_estimate)} EPS — actual not in free sources yet")
        else:
            bullets.append("Awaiting free EPS actual (Yahoo/Nasdaq often lag BMO/AMC by hours)")
    else:
        if eps_estimate is not None:
            bullets.append(
                f"Consensus EPS {_fmt_eps(eps_estimate)}"
                + (f" · {fq}" if fq else "")
                + " — not yet reported"
            )
            vs = "Awaiting print"
        else:
            bullets.append("No Street EPS estimate in free calendar yet")

    st = street or {}
    if st.get("eps_low") is not None and st.get("eps_high") is not None:
        lo, hi = st["eps_low"], st["eps_high"]
        line = f"Street EPS range {_fmt_eps(lo)} – {_fmt_eps(hi)}"
        if eps_actual is not None:
            try:
                a = float(eps_actual)
                if a > float(hi):
                    line += " · print above high end of range"
                elif a < float(lo):
                    line += " · print below low end of range"
                else:
                    mid = (float(lo) + float(hi)) / 2.0
                    side = "upper half" if a >= mid else "lower half"
                    line += f" · print in {side} of range"
            except Exception:
                pass
        bullets.append(line)

    # Revenue actual vs consensus (when either side is known)
    if revenue_actual is not None or revenue_estimate is not None:
        if revenue_actual is not None and revenue_estimate is not None:
            rsp = revenue_surprise_pct
            tag = ""
            if revenue_beat == "beat":
                tag = " · beat" + (f" {rsp:+.1f}%" if rsp is not None else "")
            elif revenue_beat == "miss":
                tag = " · miss" + (f" {rsp:.1f}%" if rsp is not None else "")
            elif revenue_beat == "inline":
                tag = " · in line"
            bullets.append(
                f"Revenue {_fmt_rev(revenue_actual)} vs {_fmt_rev(revenue_estimate)} consensus{tag}"
            )
        elif revenue_actual is not None:
            bullets.append(f"Revenue actual {_fmt_rev(revenue_actual)}")
        else:
            rev_line = f"Street revenue ~{_fmt_rev(revenue_estimate)}"
            st = street or {}
            if st.get("revenue_low") is not None and st.get("revenue_high") is not None:
                rev_line += f" (band {_fmt_rev(st['revenue_low'])}–{_fmt_rev(st['revenue_high'])})"
            bullets.append(rev_line)
    elif (street or {}).get("revenue_avg") is not None:
        st = street or {}
        rev_line = f"Street revenue ~{_fmt_rev(st['revenue_avg'])}"
        if st.get("revenue_low") is not None and st.get("revenue_high") is not None:
            rev_line += f" (band {_fmt_rev(st['revenue_low'])}–{_fmt_rev(st['revenue_high'])})"
        bullets.append(rev_line)

    # Beat/miss streak from history
    hist = list(history or [])
    beats = [h for h in hist[:6] if h.get("beat") in ("beat", "miss", "inline")]
    if beats:
        n_beat = sum(1 for h in beats if h.get("beat") == "beat")
        n_miss = sum(1 for h in beats if h.get("beat") == "miss")
        n = len(beats)
        bullets.append(
            f"Last {n} quarters: {n_beat} beat · {n_miss} miss · {n - n_beat - n_miss} inline"
        )

    # Free headlines (earnings-related)
    headlines = yahoo_earnings_headlines(symbol, limit=3)
    for h in headlines[:3]:
        t = (h.get("title") or "").strip()
        if t:
            bullets.append(t)

    # Cap length for UI
    bullets = bullets[:7]
    return {
        "tone": tone,
        "vs_analysts": vs,
        "headline": (
            f"{name}: {vs}" if vs else f"{name} earnings"
        )[:140],
        "bullets": bullets,
        "headlines": headlines[:3],
        "source": "free · yahoo/nasdaq · no LLM",
    }
