"""Price, insider, and trend screens. Every function is pure."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from ideas_cards.catalog import ETF_LABELS, INDUSTRY_ETFS, PRICE_ETFS


def _as_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "")[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _closes(bars: list) -> list[dict]:
    out = []
    for row in bars or []:
        day = _as_date(row.get("date"))
        try:
            close = float(row.get("close"))
        except (TypeError, ValueError):
            continue
        if day is None or close <= 0:
            continue
        out.append({"date": day, "close": close})
    out.sort(key=lambda row: row["date"])
    return out


def session_return(bars: list, sessions: int) -> float | None:
    rows = _closes(bars)
    if len(rows) <= sessions:
        return None
    prev = rows[-(sessions + 1)]["close"]
    last = rows[-1]["close"]
    if prev <= 0:
        return None
    return last / prev - 1.0


def trailing_high(bars: list, sessions: int = 252) -> float | None:
    rows = _closes(bars)
    if len(rows) < 60:
        return None
    window = rows[-sessions:]
    return max(row["close"] for row in window)


def downsample(bars: list, points: int = 26) -> list[dict]:
    rows = _closes(bars)
    if len(rows) <= points:
        return [{"date": row["date"].isoformat(), "close": row["close"]} for row in rows]
    step = (len(rows) - 1) / (points - 1)
    picked = []
    for i in range(points):
        row = rows[min(len(rows) - 1, int(round(i * step)))]
        picked.append({"date": row["date"].isoformat(), "close": row["close"]})
    return picked


def rebase(rows: list[dict]) -> list[float | None]:
    if not rows or not rows[0]["close"]:
        return []
    base = rows[0]["close"]
    return [round(row["close"] / base * 100.0, 2) for row in rows]


def _balance_score(names: list[dict]) -> float:
    scores = []
    for row in names:
        de = row.get("debt_to_equity")
        if de is None:
            continue
        try:
            de_f = float(de)
        except (TypeError, ValueError):
            continue
        scores.append(max(0.0, min(100.0, (2.0 - de_f) / 2.0 * 100.0)))
    if not scores:
        return 50.0
    return sum(scores) / len(scores)


def strongest_balance_sheets(names: list[dict], limit: int = 3) -> list[dict]:
    def key(row):
        de = row.get("debt_to_equity")
        try:
            de_f = float(de) if de is not None else 99.0
        except (TypeError, ValueError):
            de_f = 99.0
        cr = row.get("current_ratio")
        try:
            cr_f = float(cr) if cr is not None else 0.0
        except (TypeError, ValueError):
            cr_f = 0.0
        return (de_f, -cr_f)

    ranked = sorted(names or [], key=key)
    out = []
    for row in ranked[:limit]:
        ticker = (row.get("ticker") or "").upper()
        if not ticker:
            continue
        out.append({
            "ticker": ticker,
            "name": row.get("name") or ticker,
            "debt_to_equity": row.get("debt_to_equity"),
            "current_ratio": row.get("current_ratio"),
        })
    return out


def valuation_vs_5y(names: list[dict]) -> float | None:
    ratios = []
    for row in names or []:
        pe = row.get("pe")
        base = row.get("pe_5y")
        try:
            pe_f = float(pe)
            base_f = float(base)
        except (TypeError, ValueError):
            continue
        if pe_f <= 0 or base_f <= 0:
            continue
        ratios.append(pe_f / base_f)
    if not ratios:
        return None
    ratios.sort()
    mid = ratios[len(ratios) // 2]
    return mid


def scan_beaten_sectors(
    prices: dict,
    constituents: dict | None = None,
    *,
    drawdown_min: float = 0.15,
) -> list[dict]:
    """ETF at least `drawdown_min` under its trailing high, and behind SPY over 3m and 6m."""
    spy = _closes((prices or {}).get("SPY") or [])
    spy_3 = session_return(spy, 63)
    spy_6 = session_return(spy, 126)
    if spy_3 is None or spy_6 is None:
        return []
    found = []
    books = constituents or {}
    for symbol in PRICE_ETFS:
        bars = _closes((prices or {}).get(symbol) or [])
        high = trailing_high(bars)
        if high is None or not bars:
            continue
        last = bars[-1]["close"]
        drawdown = last / high - 1.0
        if drawdown > -abs(drawdown_min):
            continue
        r3 = session_return(bars, 63)
        r6 = session_return(bars, 126)
        if r3 is None or r6 is None or not (r3 < spy_3 and r6 < spy_6):
            continue
        names = books.get(symbol) or []
        strong = strongest_balance_sheets(names, 3)
        chart_etf = downsample(bars)
        chart_spy = downsample(spy)
        found.append({
            "key": symbol,
            "symbol": symbol,
            "label": ETF_LABELS.get(symbol, symbol),
            "group": "industry" if symbol in INDUSTRY_ETFS else "sector",
            "drawdown": drawdown,
            "rel_3m": r3 - spy_3,
            "rel_6m": r6 - spy_6,
            "return_3m": r3,
            "return_6m": r6,
            "spy_3m": spy_3,
            "spy_6m": spy_6,
            "last": last,
            "high": high,
            "valuation_vs_5y": valuation_vs_5y(names),
            "balance_sheet_score": _balance_score(strong or names),
            "names": strong,
            "chart": {
                "labels": [row["date"] for row in chart_etf],
                "series": [
                    {"name": symbol, "values": rebase(chart_etf)},
                    {"name": "SPY", "values": rebase(chart_spy)},
                ],
            },
        })
    found.sort(key=lambda row: row["drawdown"])
    return found


_CAUSE_RULES = (
    ("guidance cut", ("guidance", "outlook cut", "lowered forecast", "cuts outlook", "guide-down")),
    ("earnings miss", ("earnings miss", "missed estimates", "below estimates", "profit warning")),
    ("downgrade", ("downgrade", "price target cut", "cut to sell")),
    ("legal-regulatory", ("lawsuit", "sec charges", "doj", "regulator", "antitrust", "investigation")),
)


def classify_drop(headlines: list, drop: float, sector_move: float | None) -> str:
    text = " ".join(headlines or []).lower()
    for label, needles in _CAUSE_RULES:
        if any(needle in text for needle in needles):
            return label
    if sector_move is not None and sector_move <= -0.08 and abs(drop - sector_move) <= 0.04:
        return "market-wide"
    if text.strip():
        return "unclassified"
    return "market-wide" if (sector_move is not None and sector_move <= -0.08) else "unclassified"


def overreaction_score(drop: float, estimate_revision: float | None, sector_move: float | None) -> float:
    """How far the price fell past the estimate revision and the sector."""
    anchors = [abs(float(estimate_revision or 0)), abs(float(sector_move or 0))]
    excess = abs(float(drop)) - max(anchors)
    return max(0.0, min(100.0, excess / 0.25 * 100.0))


def scan_weekly_drops(
    names: list,
    *,
    drop_min: float = 0.15,
    min_market_cap: float = 1_000_000_000,
) -> list[dict]:
    """Names down at least `drop_min` across the last five sessions."""
    found = []
    for row in names or []:
        ticker = (row.get("ticker") or "").upper()
        if not ticker:
            continue
        try:
            cap = float(row.get("market_cap") or 0)
        except (TypeError, ValueError):
            cap = 0
        if cap < float(min_market_cap):
            continue
        bars = _closes(row.get("bars") or [])
        drop = session_return(bars, 5)
        if drop is None or drop > -abs(drop_min):
            continue
        try:
            sector_move = float(row["sector_move"]) if row.get("sector_move") is not None else None
        except (TypeError, ValueError):
            sector_move = None
        try:
            revision = float(row["estimate_revision"]) if row.get("estimate_revision") is not None else None
        except (TypeError, ValueError):
            revision = None
        headlines = [str(item) for item in (row.get("headlines") or []) if item]
        cause = classify_drop(headlines, drop, sector_move)
        before = bars[-(6)]["close"] if len(bars) > 5 else None
        after = bars[-1]["close"]
        eps = row.get("eps")
        pe_before = pe_after = None
        try:
            eps_f = float(eps) if eps is not None else None
        except (TypeError, ValueError):
            eps_f = None
        if eps_f and eps_f > 0 and before:
            pe_before = before / eps_f
            pe_after = after / eps_f
        found.append({
            "key": ticker,
            "ticker": ticker,
            "name": row.get("name") or ticker,
            "drop": drop,
            "market_cap": cap,
            "cause": cause,
            "headlines": headlines[:4],
            "headline_urls": [str(u) for u in (row.get("headline_urls") or []) if u][:4],
            "sector_move": sector_move,
            "estimate_revision": revision,
            "overreaction": overreaction_score(drop, revision, sector_move),
            "price_before": before,
            "price_after": after,
            "pe_before": pe_before,
            "pe_after": pe_after,
            "chart": {
                "labels": [item["date"] for item in downsample(bars, 20)],
                "series": [{"name": ticker, "values": rebase(downsample(bars, 20))}],
            },
        })
    found.sort(key=lambda row: row["drop"])
    return found


def _senior(role: str) -> bool:
    text = (role or "").lower()
    return "chief executive" in text or text.strip() in {"ceo", "cfo"} or "chief financial" in text or text.startswith("ceo") or text.startswith("cfo")


def scan_insider_buys(
    trades: list,
    *,
    as_of: date,
    window_days: int = 30,
    cluster_min: int = 2,
    ceo_cfo_min_usd: float = 250_000,
) -> list[dict]:
    """Open-market buys: a cluster, or one CEO/CFO buy at or above the dollar floor."""
    start = as_of - timedelta(days=int(window_days))
    by_ticker: dict[str, list] = {}
    for row in trades or []:
        code = (row.get("code") or "P").upper()
        if code not in {"P", "BUY"}:
            continue
        day = _as_date(row.get("date"))
        if day is None or day < start or day > as_of:
            continue
        ticker = (row.get("ticker") or "").upper()
        if not ticker:
            continue
        try:
            value = float(row.get("value") or 0)
        except (TypeError, ValueError):
            value = 0
        if value <= 0:
            try:
                value = float(row.get("shares") or 0) * float(row.get("price") or 0)
            except (TypeError, ValueError):
                value = 0
        by_ticker.setdefault(ticker, []).append({
            "insider": row.get("insider") or "",
            "role": row.get("role") or "",
            "date": day.isoformat(),
            "value": value,
            "url": row.get("url") or "",
        })
    found = []
    for ticker, rows in by_ticker.items():
        people = {row["insider"] for row in rows if row["insider"]}
        dollars = sum(row["value"] for row in rows)
        senior_hit = any(_senior(row["role"]) and row["value"] >= ceo_cfo_min_usd for row in rows)
        if len(people) < int(cluster_min) and not senior_hit:
            continue
        found.append({
            "key": ticker,
            "subtype": "form4",
            "ticker": ticker,
            "name": ticker,
            "buyers": len(people) or 1,
            "value": dollars,
            "senior": senior_hit,
            "trades": rows,
            "url": next((row["url"] for row in rows if row["url"]), ""),
        })
    found.sort(key=lambda row: row["value"], reverse=True)
    return found


def scan_13f_changes(
    current: list,
    prior: list,
    funds: list | None = None,
    *,
    add_pct: float = 0.50,
) -> list[dict]:
    """New positions and large adds for the configured funds."""
    allowed = {(row.get("name") or "").strip().lower() for row in (funds or []) if row.get("name")}
    allowed_cik = {str(row.get("cik") or "").lstrip("0") for row in (funds or []) if row.get("cik")}

    def keep(row) -> bool:
        if not allowed and not allowed_cik:
            return True
        name = (row.get("fund") or "").strip().lower()
        cik = str(row.get("cik") or "").lstrip("0")
        return name in allowed or (cik and cik in allowed_cik)

    def key(row):
        return (
            (row.get("fund") or "").strip().lower(),
            (row.get("cusip") or row.get("ticker") or row.get("issuer") or "").upper(),
        )

    before = {key(row): row for row in (prior or []) if keep(row)}
    found = []
    for row in current or []:
        if not keep(row):
            continue
        ident = key(row)
        if not ident[1]:
            continue
        try:
            shares = float(row.get("shares") or 0)
            value = float(row.get("value") or 0)
        except (TypeError, ValueError):
            continue
        prev = before.get(ident)
        if prev is None:
            change = "new"
        else:
            try:
                prev_shares = float(prev.get("shares") or 0)
            except (TypeError, ValueError):
                prev_shares = 0
            if prev_shares <= 0 or shares < prev_shares * (1 + add_pct):
                continue
            change = "add"
        ticker = (row.get("ticker") or "").upper()
        issuer = row.get("issuer") or ticker or ident[1]
        found.append({
            "key": f"{ident[0]}:{ident[1]}",
            "subtype": "13f",
            "ticker": ticker,
            "name": issuer,
            "fund": row.get("fund") or "",
            "change": change,
            "value": value,
            "shares": shares,
            "cusip": row.get("cusip") or "",
            "url": row.get("url") or "",
        })
    found.sort(key=lambda row: (row["change"] != "new", -row["value"]))
    return found


def _growth(series: list) -> float | None:
    rows = [row for row in (series or []) if row.get("count") is not None]
    if len(rows) < 2:
        return None
    try:
        prev = float(rows[-2]["count"])
        last = float(rows[-1]["count"])
    except (TypeError, ValueError):
        return None
    if prev <= 0:
        return 1.0 if last > 0 else 0.0
    return last / prev - 1.0


def scan_trends(
    themes: list,
    mentions: dict | None = None,
    patents: dict | None = None,
    fda: list | None = None,
    search: dict | None = None,
    exposed: list | None = None,
    *,
    as_of: date,
) -> list[dict]:
    """Filing, patent, FDA, and search momentum for each theme."""
    mentions = mentions or {}
    patents = patents or {}
    search = search or {}
    found = []
    recent_fda = []
    for row in fda or []:
        day = _as_date(row.get("date"))
        if day is None or day < as_of - timedelta(days=180) or day > as_of:
            continue
        recent_fda.append(row)
    for theme in themes or []:
        label = (theme.get("name") if isinstance(theme, dict) else str(theme)).strip()
        if not label:
            continue
        mention_growth = _growth(mentions.get(label) or [])
        patent_growth = _growth(patents.get(label) or [])
        fda_rows = [
            row for row in recent_fda
            if (row.get("theme") or "").strip().lower() == label.lower()
        ]
        try:
            momentum = float(search.get(label)) if search.get(label) is not None else None
        except (TypeError, ValueError):
            momentum = None
        if mention_growth is None and patent_growth is None and not fda_rows and momentum is None:
            continue
        if (mention_growth or 0) <= 0 and (patent_growth or 0) <= 0 and not fda_rows and (momentum or 0) < 40:
            continue
        names = []
        for row in exposed or []:
            if (row.get("theme") or "").strip().lower() != label.lower():
                continue
            names.append({
                "ticker": (row.get("ticker") or "").upper(),
                "name": row.get("name") or row.get("ticker") or "",
                "revenue_pct": row.get("revenue_pct"),
            })
        series = mentions.get(label) or []
        found.append({
            "key": label.lower().replace(" ", "-"),
            "theme": label,
            "mention_growth": mention_growth,
            "patent_growth": patent_growth,
            "fda_count": len(fda_rows),
            "fda": fda_rows[:4],
            "search_momentum": momentum,
            "names": names[:5],
            "chart": {
                "labels": [str(row.get("quarter") or "") for row in series],
                "series": [{
                    "name": "EDGAR mentions",
                    "values": [row.get("count") for row in series],
                }],
            },
        })
    found.sort(key=lambda row: (
        float(row.get("mention_growth") or 0) + float(row.get("search_momentum") or 0) / 100.0
    ), reverse=True)
    return found
