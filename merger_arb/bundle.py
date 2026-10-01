"""Fresh prices, filings, and headlines. The model never fetches these."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

WATCH_EXACT = {
    "8-K",
    "8-K/A",
    "DEFM14A",
    "DEFM14A/A",
    "PREM14A",
    "PREM14A/A",
    "S-4",
    "S-4/A",
    "425",
    "DEFA14A",
    "DEFA14A/A",
}
TERMS_EXACT = {
    "8-K",
    "8-K/A",
    "DEFM14A",
    "DEFM14A/A",
    "PREM14A",
    "PREM14A/A",
    "S-4",
    "S-4/A",
}


def sec_user_agent() -> str:
    return (os.environ.get("SEC_USER_AGENT") or "").strip() or "DGA-Capital-Research contact@dgacapital.com"


def is_watch_form(form: str) -> bool:
    text = (form or "").strip().upper()
    if text in WATCH_EXACT:
        return True
    return text.startswith("SC TO") or text.startswith("SC 14D")


def is_terms_form(form: str) -> bool:
    text = (form or "").strip().upper()
    if text in TERMS_EXACT:
        return True
    return text.startswith("SC TO") or text.startswith("SC 14D")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _quote_url(ticker: str) -> str:
    return f"https://finance.yahoo.com/quote/{ticker}"


def prices_from_quotes(quotes: dict, roles: dict[str, str], pulled_at: str) -> list[dict]:
    rows = []
    for ticker, role in roles.items():
        quote = {}
        if isinstance(quotes, dict):
            quote = quotes.get(ticker) or quotes.get(ticker.upper()) or {}
        price = quote.get("price") if isinstance(quote, dict) else None
        row = {
            "ticker": ticker,
            "role": role,
            "price": None if price is None else float(price),
            "as_of": str((quote or {}).get("as_of") or ""),
            "source_name": f"Yahoo chart {ticker}",
            "source_type": "market_data",
            "url": _quote_url(ticker),
            "pulled_at": pulled_at,
            "missing": price is None,
        }
        rows.append(row)
    return rows


def filings_from_submissions(ticker: str, payload: dict, *, since: str, pulled_at: str, limit: int = 12) -> list[dict]:
    recent = ((payload or {}).get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    accessions = recent.get("accessionNumber") or []
    primaries = recent.get("primaryDocument") or []
    items = recent.get("items") or []
    floor = (since or "")[:10]
    cik_raw = str((payload or {}).get("cik") or "").strip()
    cik_int = str(int(cik_raw)) if cik_raw.isdigit() else ""
    rows = []
    for index, form in enumerate(forms):
        form_text = str(form or "")
        if not is_watch_form(form_text):
            continue
        filed = str(dates[index] if index < len(dates) else "")[:10]
        if floor and filed and filed < floor:
            continue
        accession = str(accessions[index] if index < len(accessions) else "")
        primary = str(primaries[index] if index < len(primaries) else "")
        item = str(items[index] if index < len(items) else "")
        acc_nodash = accession.replace("-", "")
        url = ""
        if cik_int and acc_nodash and primary:
            url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/{primary}"
        excerpt = f"{form_text} filed {filed} items {item}".strip()[:500]
        rows.append({
            "ticker": ticker,
            "form": form_text,
            "filed": filed,
            "accession": accession,
            "url": url,
            "source_name": f"SEC {form_text} {ticker} {filed}",
            "source_type": "sec_filing",
            "excerpt": excerpt,
            "terms_change": is_terms_form(form_text),
            "pulled_at": pulled_at,
        })
        if len(rows) >= limit:
            break
    return rows


def headlines_from_items(ticker: str, items: list, pulled_at: str, *, limit: int = 8) -> list[dict]:
    rows = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        url = str(item.get("link") or item.get("url") or "").strip()
        if not title and not url:
            continue
        published = item.get("published") or item.get("published_label") or ""
        if hasattr(published, "isoformat"):
            published = published.isoformat()
        summary = str(item.get("summary") or "")[:400]
        rows.append({
            "ticker": ticker,
            "title": title[:300],
            "url": url,
            "publisher": str(item.get("publisher") or "Yahoo Finance"),
            "published": str(published),
            "summary": summary,
            "source_name": title[:180] or "Yahoo Finance headline",
            "source_type": "news",
            "pulled_at": pulled_at,
        })
        if len(rows) >= limit:
            break
    return rows


def _default_since() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=540)).date().isoformat()


def assemble_bundle(
    deal: dict,
    *,
    since: str | None = None,
    quotes_fn=None,
    resolve_cik=None,
    submissions_fn=None,
    news_fn=None,
    peer_ticker: str = "",
    pulled_at: str = "",
) -> dict:
    """Fetch what the app already knows. Failures are listed, not invented."""
    pulled = pulled_at or _now()
    floor = (since or _default_since())[:10]
    target = str(deal.get("target_ticker") or "").upper()
    acquirer = str(deal.get("acquirer_ticker") or "").upper()
    peer = (peer_ticker or str(deal.get("peer_ticker") or "")).upper()
    roles = {}
    if target:
        roles[target] = "target"
    if acquirer:
        roles[acquirer] = "acquirer"
    if peer:
        roles[peer] = "peer"
    errors: list[str] = []
    quotes: dict = {}
    if quotes_fn is None:
        def quotes_fn(tickers):
            import market_data
            return market_data.get_quotes(list(tickers))
    try:
        quotes = quotes_fn(list(roles)) or {}
    except Exception as exc:
        errors.append(f"prices: {exc}"[:200])
        quotes = {}
    prices = prices_from_quotes(quotes, roles, pulled)
    for row in prices:
        if row["missing"]:
            errors.append(f"no price for {row['ticker']}")

    filings: list[dict] = []
    if resolve_cik is None or submissions_fn is None:
        def resolve_cik(ticker):
            import sec_edgar_xbrl
            return sec_edgar_xbrl.resolve_cik(ticker, user_agent=sec_user_agent())

        def submissions_fn(cik):
            import requests
            cik10 = str(cik).zfill(10)
            response = requests.get(
                f"https://data.sec.gov/submissions/CIK{cik10}.json",
                headers={"User-Agent": sec_user_agent(), "Accept-Encoding": "gzip, deflate"},
                timeout=8,
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict) and not payload.get("cik"):
                payload["cik"] = str(int(cik10))
            return payload
    for ticker in (target, acquirer):
        if not ticker:
            continue
        try:
            cik = resolve_cik(ticker)
            payload = submissions_fn(cik) or {}
            if isinstance(payload, dict) and not payload.get("cik"):
                payload = dict(payload)
                payload["cik"] = str(int(str(cik))) if str(cik).isdigit() else str(cik)
            filings.extend(filings_from_submissions(ticker, payload, since=floor, pulled_at=pulled))
        except Exception as exc:
            errors.append(f"filings {ticker}: {exc}"[:200])

    if news_fn is None:
        def news_fn(ticker):
            from api.domains.yahoo_finance_news import fetch_yahoo_finance_news
            return fetch_yahoo_finance_news(ticker, limit=8)

    headlines: list[dict] = []
    for ticker in (target, acquirer):
        if not ticker:
            continue
        try:
            headlines.extend(headlines_from_items(ticker, news_fn(ticker) or [], pulled))
        except Exception as exc:
            errors.append(f"headlines {ticker}: {exc}"[:200])

    return {
        "pulled_at": pulled,
        "since": floor,
        "prices": prices,
        "filings": filings,
        "headlines": headlines,
        "errors": errors,
    }


def source_keys(bundle: dict) -> set[str]:
    """Urls and names the model is allowed to cite."""
    keys = {"deal record"}
    for row in (bundle or {}).get("prices") or []:
        if row.get("url"):
            keys.add(str(row["url"]))
        if row.get("source_name"):
            keys.add(str(row["source_name"]).lower())
    for row in (bundle or {}).get("filings") or []:
        if row.get("url"):
            keys.add(str(row["url"]))
        if row.get("source_name"):
            keys.add(str(row["source_name"]).lower())
    for row in (bundle or {}).get("headlines") or []:
        if row.get("url"):
            keys.add(str(row["url"]))
        if row.get("source_name"):
            keys.add(str(row["source_name"]).lower())
    return keys
