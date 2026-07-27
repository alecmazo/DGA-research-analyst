"""Session-aware Yahoo chart quotes (SUP_20260726).

Extracted so the weekend last-session-close fix can ship without rewriting
all of market_data.py in one Contents-API upload.
"""
from __future__ import annotations

from typing import Any


def _f(v):
    try:
        v = float(v)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


# ── Yahoo chart quotes (free primary) ────────────────────────────────────────
def _daily_closes_from_chart(res0: dict) -> list[float]:
    """Non-null daily closes from a v8 chart result, oldest → newest."""
    return [c for _, c in _daily_bars_from_chart(res0)]


def _daily_bars_from_chart(res0: dict) -> list[tuple[str, float]]:
    """[(YYYY-MM-DD ET session date, close), ...] oldest → newest, nulls dropped."""
    from datetime import datetime, timezone
    try:
        from zoneinfo import ZoneInfo
        et = ZoneInfo("America/New_York")
    except Exception:
        et = timezone.utc
    ts = res0.get("timestamp") or []
    closes = ((res0.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    out: list[tuple[str, float]] = []
    for t, c in zip(ts, closes):
        px = _f(c)
        if px is None or t is None:
            continue
        try:
            d = datetime.fromtimestamp(int(t), tz=timezone.utc).astimezone(et).date()
            out.append((d.isoformat(), float(px)))
        except Exception:
            continue
    return out


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
            r = requests.get(
                f"https://{host}.finance.yahoo.com/v8/finance/chart/{sym}",
                params={"range": "10d", "interval": "1d", "includePrePost": "false"},
                timeout=8,
                headers={"User-Agent": "Mozilla/5.0 DGACapital/1.0"},
            )
            if r.status_code != 200:
                continue
            res0 = (((r.json().get("chart") or {}).get("result")) or [None])[0]
            if not res0:
                continue
            meta = res0.get("meta") or {}
            bars = _daily_bars_from_chart(res0)
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

            # ── Prior session close (never chartPreviousClose) ───────────
            prev = _f(meta.get("previousClose")
                      or meta.get("regularMarketPreviousClose"))
            if prev is None and closes:
                # If the last bar is *today's* (partial or final) session while
                # RTH is open, prior close is the previous bar. If the last bar
                # is still Friday and today is Monday open, prior close is the
                # last bar itself — NOT closes[-2] (that would be Thursday and
                # inflate multi-day %).
                if rth_open and bar_last_date and bar_last_date >= _us_now_et().date().isoformat():
                    prev = bar_prev
                elif rth_open and bar_last is not None:
                    # No today bar yet → last bar is prior session close
                    prev = bar_last
                else:
                    # Closed: price is last bar; day % vs prior bar
                    prev = bar_prev

            # Prefer Yahoo's own day % only when RTH is open (live session).
            # When closed, recompute from last two session closes so weekend
            # day % stays Friday's move, not a stale meta % or multi-day span.
            pct = None
            if rth_open:
                pct = _f(meta.get("regularMarketChangePercent"))
            if pct is None and prev not in (None, 0):
                pct = (float(px) - float(prev)) / float(prev) * 100.0

            return {
                "price": float(px),
                "prev_close": float(prev) if prev is not None else None,
                "pct_change": pct,
                "source": "yahoo-chart",
                "price_source": price_source,
                "as_of": as_of,
            }
        except Exception as e:
            print(f"[market_data] yahoo quote {sym} {host}: {e!s:.100}", flush=True)
    return None
