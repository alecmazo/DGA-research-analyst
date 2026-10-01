"""RSS 2.0 via the stdlib. feedparser is not a dependency."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from merger_arb.scanner.classify import classify_headline
from merger_arb.scanner.models import SourceRecord
from merger_arb.scanner.resolve import tickers_in_text


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if tag else ""


def _strip_ns(xml_text: str) -> str:
    text = re.sub(r'\sxmlns(:\w+)?="[^"]*"', "", xml_text or "")
    return text


def _child_text(node: ET.Element, name: str) -> str:
    for child in list(node):
        if _local(child.tag) == name and child.text:
            return child.text.strip()
    return ""


def _categories(node: ET.Element) -> list[str]:
    values = []
    for child in list(node):
        if _local(child.tag) == "category" and child.text:
            values.append(child.text.strip())
    return values


def parse_rss(xml_text: str, *, source: str, pulled_at: str) -> list[SourceRecord]:
    try:
        root = ET.fromstring(_strip_ns(xml_text))
    except ET.ParseError:
        return []
    channel = None
    if _local(root.tag) == "channel":
        channel = root
    else:
        for child in list(root):
            if _local(child.tag) == "channel":
                channel = child
                break
    if channel is None:
        return []
    records = []
    for node in list(channel):
        if _local(node.tag) != "item":
            continue
        title = _child_text(node, "title")
        link = _child_text(node, "link")
        guid = _child_text(node, "guid") or link or title
        description = _child_text(node, "description")
        published = _child_text(node, "pubDate")
        if published:
            try:
                published = parsedate_to_datetime(published).isoformat()
            except (TypeError, ValueError, IndexError):
                pass
        cats = _categories(node)
        blob = " ".join(part for part in (title, description, " ".join(cats)) if part)
        if not title and not guid:
            continue
        event = classify_headline(blob) or ""
        records.append(SourceRecord(
            source=source,
            external_id=guid[:240],
            url=link,
            title=title,
            published_at=published,
            pulled_at=pulled_at,
            raw_excerpt=description[:500],
            text=blob,
            event_type=event,
            tickers=tickers_in_text(blob),
            extra={"categories": cats},
        ))
    return records
