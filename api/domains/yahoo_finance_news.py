"""Yahoo Finance headlines for the local finance model.

Primary source is the free Yahoo Finance RSS feed. If that returns nothing,
fall back to the yfinance package (Apache-2.0). Results are cached per ticker
for 15 minutes. This module does not invent headlines.
"""

from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

YAHOO_RSS = (
    "https://feeds.finance.yahoo.com/rss/2.0/headline"
    "?s={ticker}&region=US&lang=en-US"
)
CACHE_TTL_S = 15 * 60
NEWS_LIMIT = 18
DISPLAY_TZ = ZoneInfo("America/Los_Angeles")
EMPTY_NOTE = "No recent Yahoo Finance news available"

_cache: dict[str, tuple[float, list[dict]]] = {}


def _http_get(url: str, timeout: float = 8.0) -> str:
    import ssl
    import urllib.request

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "DGA-Capital-Research/1.0 (yahoo-finance-news)",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")
    except Exception:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read().decode("utf-8", "replace")


def _parse_when(value) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=DISPLAY_TZ)
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    try:
        dt = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=DISPLAY_TZ)
    return dt.astimezone(DISPLAY_TZ)


def _fmt_when(dt: datetime | None) -> str:
    if dt is None:
        return "undated"
    return dt.strftime("%Y-%m-%d %H:%M PT")


def _norm(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def _dedupe_sort(items: list[dict], limit: int) -> list[dict]:
    seen_titles: set[str] = set()
    seen_links: set[str] = set()
    out: list[dict] = []
    for it in items:
        title = (it.get("title") or "").strip()
        link = (it.get("link") or "").strip()
        if not title and not link:
            continue
        nt = _norm(title)
        nl = _norm(link.split("?")[0])
        if nt and nt in seen_titles:
            continue
        if nl and nl in seen_links:
            continue
        if nt:
            seen_titles.add(nt)
        if nl:
            seen_links.add(nl)
        when = it.get("published")
        if not isinstance(when, datetime):
            when = _parse_when(it.get("published") or it.get("pub"))
        out.append({
            "title": title,
            "publisher": (it.get("publisher") or "Yahoo Finance").strip() or "Yahoo Finance",
            "published": when,
            "published_label": _fmt_when(when),
            "link": link,
            "summary": (it.get("summary") or "").strip(),
        })
    out.sort(key=lambda row: row["published"] or datetime.min.replace(tzinfo=DISPLAY_TZ), reverse=True)
    return out[:limit]


def _from_rss(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    channel = root.find("channel")
    if channel is None:
        return []
    items: list[dict] = []
    for it in channel.findall("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        pub = (it.findtext("pubDate") or "").strip()
        summary = (it.findtext("description") or "").strip()
        source = it.find("source")
        publisher = (source.text or "").strip() if source is not None and source.text else "Yahoo Finance"
        if not title:
            continue
        items.append({
            "title": title,
            "link": link,
            "publisher": publisher,
            "published": _parse_when(pub),
            "summary": summary,
        })
    return items


def _from_yfinance(ticker: str, limit: int) -> list[dict]:
    import yfinance as yf

    raw = yf.Ticker(ticker).news or []
    items: list[dict] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        content = row.get("content") if isinstance(row.get("content"), dict) else row
        title = content.get("title") or row.get("title") or ""
        link = ""
        canonical = content.get("canonicalUrl") or content.get("clickThroughUrl") or {}
        if isinstance(canonical, dict):
            link = canonical.get("url") or ""
        link = link or content.get("link") or row.get("link") or ""
        provider = content.get("provider") or {}
        publisher = ""
        if isinstance(provider, dict):
            publisher = provider.get("displayName") or ""
        publisher = publisher or row.get("publisher") or "Yahoo Finance"
        when_raw = (
            content.get("pubDate")
            or row.get("providerPublishTime")
            or content.get("providerPublishTime")
        )
        summary = content.get("summary") or content.get("description") or row.get("summary") or ""
        items.append({
            "title": title,
            "link": link,
            "publisher": publisher,
            "published": _parse_when(when_raw),
            "summary": summary,
        })
        if len(items) >= limit * 2:
            break
    return items


def fetch_yahoo_finance_news(ticker: str, *, limit: int = NEWS_LIMIT, force: bool = False) -> list[dict]:
    """Latest Yahoo Finance items for one ticker. Empty list on failure."""
    tk = (ticker or "").strip().upper()
    if not tk:
        return []
    limit = max(1, min(int(limit), 20))
    now = time.monotonic()
    cached = _cache.get(tk)
    if not force and cached and (now - cached[0]) < CACHE_TTL_S:
        return list(cached[1][:limit])

    raw: list[dict] = []
    rss_error = None
    try:
        xml_text = _http_get(YAHOO_RSS.format(ticker=quote(tk)))
        raw = _from_rss(xml_text)
    except Exception as exc:
        rss_error = exc
        raw = []
    if not raw:
        try:
            raw = _from_yfinance(tk, limit)
        except Exception as exc:
            print(
                f"   [yahoo-news] {tk}: RSS failed ({rss_error!s:.80}); "
                f"yfinance failed ({exc!s:.80})",
                flush=True,
            )
            raw = []
    items = _dedupe_sort(raw, limit)
    _cache[tk] = (now, items)
    return list(items)


def clear_news_cache() -> None:
    _cache.clear()


def format_yahoo_news_block(ticker: str, items: list[dict] | None) -> str:
    """Same bullet shape as the Analyze news section, Yahoo items only."""
    tk = (ticker or "").strip().upper()
    lines = [
        f"=== FREE CATALYST HEADLINES — {tk} (Yahoo Finance, newest first) ===",
        "These headlines were fetched from Yahoo Finance. Do not invent news beyond them.",
        "",
    ]
    if not items:
        lines.append(EMPTY_NOTE)
        lines.append("")
        return "\n".join(lines)
    for it in items:
        label = it.get("published_label") or _fmt_when(it.get("published"))
        title = it.get("title") or ""
        src = it.get("publisher") or "Yahoo Finance"
        row = f"- [{label}] {title}  ({src})"
        if it.get("link"):
            row += f"  {it['link']}"
        lines.append(row)
        summary = (it.get("summary") or "").strip()
        if summary:
            lines.append(f"  {summary}")
    lines.append("")
    return "\n".join(lines)
