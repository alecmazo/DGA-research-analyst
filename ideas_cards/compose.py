"""Turn a scanner hit into the card the desk shows.

The thesis is written here so a card still reads when no model is reachable.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from ideas_cards.catalog import ETF_LABELS
from ideas_cards.edgar import edgar_search_link
from ideas_cards.scoring import SCORERS, weights_tuned


def _day(as_of) -> str:
    if isinstance(as_of, datetime):
        return as_of.date().isoformat()
    if isinstance(as_of, date):
        return as_of.isoformat()
    return str(as_of)[:10]


def _pct(value) -> str:
    if value is None:
        return "n/a"
    return f"{float(value) * 100:.1f}%"


def _px(value) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):.2f}"


def _usd(value) -> str:
    if value is None:
        return "n/a"
    n = float(value)
    sign = "-" if n < 0 else ""
    n = abs(n)
    if n >= 1e9:
        return f"{sign}${n / 1e9:.1f}B"
    if n >= 1e6:
        return f"{sign}${n / 1e6:.1f}M"
    return f"{sign}${n:,.0f}"


def _multiple(value) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):.2f}x"


def _quote_link(symbol: str) -> dict:
    sym = (symbol or "").upper()
    return {"label": f"{sym} price", "url": f"https://finance.yahoo.com/quote/{sym}"}


def _shell(card_type: str, key: str, title: str, scored: dict, weights: dict, as_of, **fields) -> dict:
    tuned = weights_tuned(card_type, weights)
    card = {
        "id": f"{card_type}:{key}:{_day(as_of)}",
        "type": card_type,
        "subtype": "",
        "title": title,
        "score": scored["total"],
        "score_breakdown": scored["breakdown"],
        "thesis": "",
        "bull": "",
        "bear": "",
        "falsify": "",
        "question": "",
        "key_numbers": [],
        "sources": [],
        "as_of": _day(as_of),
        "status": "new",
        "chart": {"labels": [], "series": []},
        "names": [],
        "price": None,
        "ticker": "",
        "headlines": [],
        "tuned": tuned,
        "tuned_note": "Tuned by your feedback" if tuned else "",
        "weights": {k: weights[k] for k in weights},
        "signals": {},
    }
    card.update(fields)
    return card


def sector_cards(hits: list, weights: dict, as_of, macro: dict | None = None) -> list[dict]:
    cards = []
    macro = macro or {}
    for hit in hits or []:
        scored = SCORERS["sector"](hit, weights)
        label = hit.get("label") or ETF_LABELS.get(hit.get("symbol"), hit.get("symbol"))
        dd = _pct(hit.get("drawdown"))
        names = hit.get("names") or []
        name_list = ", ".join(row.get("ticker") or "" for row in names if row.get("ticker")) or "no names on file"
        numbers = [
            {"label": "Drawdown from 52-week high", "value": dd},
            {"label": "Vs SPY, 3 months", "value": _pct(hit.get("rel_3m"))},
            {"label": "Vs SPY, 6 months", "value": _pct(hit.get("rel_6m"))},
            {"label": "Valuation vs 5-year average", "value": _multiple(hit.get("valuation_vs_5y"))},
            {"label": "Last", "value": _px(hit.get("last"))},
            {"label": "Trailing high", "value": _px(hit.get("high"))},
        ]
        if macro.get("unemployment") is not None:
            numbers.append({"label": "Unemployment (FRED)", "value": f"{float(macro['unemployment']):.1f}%"})
        symbol = hit.get("symbol") or hit.get("key")
        cards.append(_shell(
            "sector",
            hit.get("key") or symbol,
            f"{label} is {dd} below its high",
            scored,
            weights,
            as_of,
            subtype=hit.get("group") or "sector",
            ticker=symbol or "",
            price=hit.get("last"),
            names=names,
            chart=hit.get("chart") or {"labels": [], "series": []},
            thesis=(
                f"{label} is {dd} below its 52-week high and has lagged SPY "
                f"over three and six months. Is this cyclical or structural?"
            ),
            bull=f"If the drawdown is cyclical, the stronger balance sheets to own are {name_list}.",
            bear="If the drawdown is structural, a cheap multiple is a trap.",
            falsify="A new 52-week low with no improvement versus SPY, or the strongest names adding leverage.",
            question="Is this cyclical or structural?",
            key_numbers=numbers,
            sources=[_quote_link(symbol), _quote_link("SPY")],
            signals={
                "drawdown": hit.get("drawdown"),
                "rel_3m": hit.get("rel_3m"),
                "rel_6m": hit.get("rel_6m"),
                "valuation_vs_5y": hit.get("valuation_vs_5y"),
                "balance_sheet_score": hit.get("balance_sheet_score"),
            },
        ))
    return cards


def weekly_cards(hits: list, weights: dict, as_of) -> list[dict]:
    cards = []
    for hit in hits or []:
        scored = SCORERS["weekly"](hit, weights)
        ticker = hit.get("ticker") or hit.get("key")
        drop = _pct(hit.get("drop"))
        cause = hit.get("cause") or "unclassified"
        urls = hit.get("headline_urls") or []
        headlines = hit.get("headlines") or []
        sources = []
        for i, headline in enumerate(headlines[:4]):
            url = urls[i] if i < len(urls) else ""
            if url:
                sources.append({"label": headline[:80], "url": url})
        if not sources:
            sources = [_quote_link(ticker)]
        pe_before = hit.get("pe_before")
        pe_after = hit.get("pe_after")
        cards.append(_shell(
            "weekly",
            hit.get("key") or ticker,
            f"{ticker} fell {drop} in five sessions",
            scored,
            weights,
            as_of,
            subtype=cause,
            ticker=ticker or "",
            price=hit.get("price_after"),
            headlines=headlines[:4],
            chart=hit.get("chart") or {"labels": [], "series": []},
            thesis=(
                f"{ticker} fell {drop} in five sessions. The tape calls it {cause}. "
                f"The overreaction score is {float(hit.get('overreaction') or 0):.0f}."
            ),
            bull="If the drop ran past the estimate revision and the sector, the price is ahead of the news.",
            bear="If the cause is a guidance cut or a legal problem, the first print is often not the last.",
            falsify="The next report confirms the new lower run-rate, or the stock keeps falling with its sector.",
            question="Is this drop larger than the news?",
            key_numbers=[
                {"label": "Five-session move", "value": drop},
                {"label": "Cause", "value": cause},
                {"label": "Overreaction", "value": f"{float(hit.get('overreaction') or 0):.0f}"},
                {"label": "Market cap", "value": _usd(hit.get("market_cap"))},
                {"label": "PE before", "value": _multiple(pe_before)},
                {"label": "PE after", "value": _multiple(pe_after)},
                {"label": "Sector move", "value": _pct(hit.get("sector_move"))},
            ],
            sources=sources,
            signals={
                "drop": hit.get("drop"),
                "overreaction": hit.get("overreaction"),
                "cause": cause,
                "market_cap": hit.get("market_cap"),
            },
        ))
    return cards


def insider_cards(hits: list, weights: dict, as_of) -> list[dict]:
    cards = []
    for hit in hits or []:
        scored = SCORERS["insider"](hit, weights)
        subtype = hit.get("subtype") or "form4"
        ticker = hit.get("ticker") or ""
        name = hit.get("name") or ticker
        if subtype == "13f":
            change = hit.get("change") or "add"
            verb = "opened" if change == "new" else "added to"
            title = f"{hit.get('fund') or 'A fund'} {verb} {name}"
            thesis = (
                f"{hit.get('fund') or 'A fund'} {verb} {name} ({_usd(hit.get('value'))}). "
                "13F prints are late, so this is a position change, not a timing signal."
            )
            bull = "A fund on your list is putting on size."
            bear = "A 13F is late, and a new line can be a hedge the form does not show."
            falsify = "The next 13F shows the position gone."
            question = "Is this a real add, or a filing lag?"
            sources = []
            if hit.get("url"):
                sources.append({"label": "13F filing", "url": hit["url"]})
            if not sources:
                sources.append({"label": "SEC EDGAR", "url": "https://www.sec.gov/edgar/search/"})
            numbers = [
                {"label": "Change", "value": change},
                {"label": "Reported value", "value": _usd(hit.get("value"))},
                {"label": "Fund", "value": hit.get("fund") or ""},
            ]
        else:
            title = f"{ticker} insider buys, {_usd(hit.get('value'))}"
            who = "a CEO or CFO check" if hit.get("senior") else "open-market buys"
            thesis = (
                f"{ticker}: {int(hit.get('buyers') or 0)} insider(s) bought {_usd(hit.get('value'))} "
                f"in the open market. That includes {who}."
            )
            bull = "Open-market buying by people who know the business."
            bear = "Small buys can be optics, and a cluster can still be a falling knife."
            falsify = "The buyers sell within the next quarter, or the next report cuts guidance."
            question = "Are these buyers putting real money in?"
            sources = []
            if hit.get("url"):
                sources.append({"label": "Form 4", "url": hit["url"]})
            if ticker:
                sources.append({
                    "label": f"{ticker} filings",
                    "url": f"https://www.sec.gov/edgar/search/#/q={ticker}&forms=4",
                })
            if not sources:
                sources.append({"label": "SEC EDGAR", "url": "https://www.sec.gov/edgar/search/"})
            numbers = [
                {"label": "Buyers", "value": str(int(hit.get("buyers") or 0))},
                {"label": "Dollars", "value": _usd(hit.get("value"))},
                {"label": "CEO or CFO", "value": "yes" if hit.get("senior") else "no"},
            ]
        cards.append(_shell(
            "insider",
            hit.get("key") or ticker or name,
            title,
            scored,
            weights,
            as_of,
            subtype=subtype,
            ticker=ticker,
            names=[{"ticker": ticker, "name": name}] if ticker or name else [],
            thesis=thesis,
            bull=bull,
            bear=bear,
            falsify=falsify,
            question=question,
            key_numbers=numbers,
            sources=sources,
            signals={
                "subtype": subtype,
                "change": hit.get("change"),
                "value": hit.get("value"),
                "buyers": hit.get("buyers"),
                "senior": bool(hit.get("senior")),
            },
        ))
    return cards


def trend_cards(hits: list, weights: dict, as_of) -> list[dict]:
    cards = []
    day = as_of if isinstance(as_of, date) else date.fromisoformat(_day(as_of))
    for hit in hits or []:
        scored = SCORERS["trend"](hit, weights)
        theme = hit.get("theme") or hit.get("key")
        growth = hit.get("mention_growth")
        growth_txt = "n/a" if growth is None else _pct(growth)
        names = hit.get("names") or []
        exposed = ", ".join(
            f"{row.get('ticker')}" + (f" ({row['revenue_pct']}%)" if row.get("revenue_pct") is not None else "")
            for row in names if row.get("ticker")
        ) or "no mapped names yet"
        cards.append(_shell(
            "trend",
            hit.get("key") or str(theme).lower().replace(" ", "-"),
            f"{theme} is showing up more often",
            scored,
            weights,
            as_of,
            subtype="theme",
            names=names,
            chart=hit.get("chart") or {"labels": [], "series": []},
            thesis=(
                f"{theme}: filing mentions are {growth_txt} versus the prior window. "
                f"Exposed names on file: {exposed}."
            ),
            bull="Filings, patents, and FDA dates moving together is a one- to two-year setup.",
            bear="Search heat without revenue is a story.",
            falsify="The next window of filings drops back, or the exposed names show no revenue from the theme.",
            question="Is this a one- to two-year setup or a headline cycle?",
            key_numbers=[
                {"label": "Filing mention growth", "value": growth_txt},
                {"label": "Patent growth", "value": "n/a" if hit.get("patent_growth") is None else _pct(hit.get("patent_growth"))},
                {"label": "FDA milestones", "value": str(int(hit.get("fda_count") or 0))},
                {"label": "Search momentum", "value": "n/a" if hit.get("search_momentum") is None else f"{float(hit['search_momentum']):.0f}"},
            ],
            sources=[{"label": f"EDGAR mentions of {theme}", "url": edgar_search_link(str(theme), day)}],
            signals={
                "mention_growth": hit.get("mention_growth"),
                "patent_growth": hit.get("patent_growth"),
                "fda_count": hit.get("fda_count"),
                "search_momentum": hit.get("search_momentum"),
            },
        ))
    return cards


def present(card: dict, settings: dict) -> dict:
    """Refresh the tuned flag from the weights Alec sees in settings."""
    kind = card.get("type") or ""
    weights = ((settings or {}).get("weights") or {}).get(kind) or card.get("weights") or {}
    out = dict(card)
    out["weights"] = weights
    tuned = weights_tuned(kind, weights) if kind else False
    out["tuned"] = tuned
    out["tuned_note"] = "Tuned by your feedback" if tuned else ""
    return out


def attach_watch_alerts(card: dict, quote, move_pct: float) -> dict:
    out = dict(card)
    alerts = []
    if out.get("status") == "watching":
        watch = out.get("watch") or {}
        basis = watch.get("price")
        try:
            if basis and quote is not None and float(basis) > 0:
                move = float(quote) / float(basis) - 1.0
                if abs(move) >= float(move_pct):
                    alerts.append({
                        "kind": "price",
                        "text": f"Price is {move * 100:.1f}% from the watch level",
                    })
        except (TypeError, ValueError):
            pass
        seen = set(watch.get("seen_headlines") or [])
        for headline in out.get("headlines") or []:
            if headline and headline not in seen:
                alerts.append({"kind": "news", "text": str(headline)})
    out["alerts"] = alerts
    return out
