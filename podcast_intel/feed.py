"""Turn a podcast feed or a publisher page into readable transcript text.

No network. Callers pass the XML or HTML they already fetched.
"""

from __future__ import annotations

import re
from email.utils import parsedate_to_datetime
from html import unescape
from xml.etree import ElementTree as ET

_STAMP = re.compile(r"^(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})$")
_SRT_TIME = re.compile(r"(\d{2}:\d{2}:\d{2}),\d{3}")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def published_day(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    try:
        return parsedate_to_datetime(text).date().isoformat()
    except (TypeError, ValueError, OverflowError):
        match = re.search(r"(20\d{2}-\d{2}-\d{2})", text)
        return match.group(1) if match else ""


def item_from_element(item) -> dict | None:
    """One RSS item. None when it has no title, link, or guid."""
    title = ""
    link = ""
    guid = ""
    published = ""
    enclosure = ""
    transcripts: list[dict] = []
    notes: list[str] = []
    for child in list(item):
        name = _local(child.tag)
        text = (child.text or "").strip()
        if name == "title" and not title:
            title = text
        elif name == "link" and not link:
            link = text
        elif name == "guid" and not guid:
            guid = text
        elif name == "pubdate" and not published:
            published = text
        elif name == "enclosure" and not enclosure:
            enclosure = (child.attrib.get("url") or "").strip()
        elif name == "transcript":
            url = (child.attrib.get("url") or text).strip()
            if url:
                transcripts.append({
                    "url": url,
                    "type": (child.attrib.get("type") or "").strip().lower(),
                })
        elif name in {"description", "encoded", "summary"} and text:
            notes.append(text)
    if not title and not link and not guid:
        return None
    return {
        "title": title or "Untitled",
        "link": link,
        "guid": guid,
        "published": published_day(published),
        "enclosure": enclosure,
        "transcripts": _prefer_transcript_urls(transcripts),
        "notes": _plain_notes(max(notes, key=len) if notes else ""),
    }


def parse_feed(xml_text: str) -> list[dict]:
    """Newest items in the feed. Each item may include transcript file URLs."""
    root = ET.fromstring(xml_text)
    items = []
    for item in root.iter():
        if _local(item.tag) != "item":
            continue
        parsed = item_from_element(item)
        if parsed:
            items.append(parsed)
    return items


def _plain_notes(raw: str) -> str:
    """Show notes for matching a video. Not a transcript."""
    text = re.sub(r"<[^>]+>", " ", raw or "")
    text = unescape(re.sub(r"\s+", " ", text)).strip()
    return text[:1200]


def _prefer_transcript_urls(rows: list[dict]) -> list[dict]:
    """Plain text first, then captions. The list is the order to try."""
    def rank(row: dict) -> tuple[int, str]:
        kind = row.get("type") or ""
        url = row.get("url") or ""
        if "text/plain" in kind or url.endswith(".txt"):
            return (0, url)
        if "vtt" in kind or url.endswith(".vtt"):
            return (1, url)
        if "srt" in kind or "subrip" in kind or url.endswith(".srt"):
            return (2, url)
        return (3, url)
    return sorted(rows, key=rank)


def normalize_transcript(raw: str) -> str:
    """One readable block. Timed cues keep a start time. Tags are removed."""
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return ""
    if text.startswith("WEBVTT") or "\nWEBVTT" in text[:80]:
        return _cues_to_text(text)
    if _SRT_TIME.search(text[:400]):
        return _cues_to_text(text)
    lines = text.split("\n")
    if not any(_STAMP.match(line.strip()) for line in lines[:12]):
        cleaned = re.sub(r"[ \t]+", " ", text)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
        return unescape(cleaned)
    parts: list[str] = []
    stamp = ""
    buf: list[str] = []

    def flush() -> None:
        nonlocal stamp, buf
        body = " ".join(piece.strip() for piece in buf if piece.strip())
        if body:
            parts.append(f"[{stamp}] {body}" if stamp else body)
        stamp = ""
        buf = []

    for line in lines:
        stripped = line.strip()
        match = _STAMP.match(stripped)
        if match:
            flush()
            stamp = match.group(1)
            continue
        if stripped:
            buf.append(stripped)
    flush()
    return "\n\n".join(parts)


def _cues_to_text(raw: str) -> str:
    blocks = re.split(r"\n\s*\n", raw.strip())
    parts: list[str] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines or lines[0] == "WEBVTT":
            continue
        if re.fullmatch(r"\d+", lines[0]):
            lines = lines[1:]
        if not lines:
            continue
        match = re.match(r"(\d{2}:\d{2}:\d{2})[,.]\d+", lines[0])
        if not match:
            continue
        body = " ".join(lines[1:])
        body = re.sub(r"<[^>]+>", "", body)
        body = unescape(re.sub(r"\s+", " ", body)).strip()
        if body:
            parts.append(f"[{match.group(1)}] {body}")
    return "\n\n".join(parts)


def simplecast_slug(url: str) -> str:
    """Episode slug from a Simplecast page. Empty for any other host."""
    from urllib.parse import urlparse
    parsed = urlparse((url or "").strip())
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host.endswith("simplecast.com"):
        return ""
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2 or parts[0] != "episodes":
        return ""
    slug = parts[1].strip()
    if not slug or len(slug) > 180 or any(ch.isspace() for ch in slug):
        return ""
    return slug


def simplecast_transcript_text(payload: dict) -> str:
    """Publisher transcript from a Simplecast episode payload. Empty when unset."""
    if not isinstance(payload, dict):
        return ""
    raw = payload.get("transcription")
    if not isinstance(raw, str) or not raw.strip():
        return ""
    text = re.sub(r"<[^>]+>", " ", raw)
    text = unescape(re.sub(r"\s+", " ", text)).strip()
    return text


def publisher_is_preview(html: str) -> bool:
    """True when the page tells a visitor the rest of the transcript is behind login."""
    low = (html or "").lower()
    return (
        "access the full transcript" in low
        or "log in to view episode transcripts" in low
        or "register to view episode transcripts" in low
    )


def publisher_transcript(html: str) -> str:
    """Speaker lines from a Colossus-style transcript page. Empty if none."""
    parts: list[str] = []
    for match in re.finditer(r"<p\b([^>]*)>(.*?)</p>", html or "", flags=re.I | re.S):
        attrs, inner = match.group(1), match.group(2)
        if "data-transcript-" not in attrs.lower() and "transcript__speaker" not in inner.lower():
            continue
        speaker_match = re.search(
            r"transcript__speaker[^>]*>([^<]+)",
            inner,
            flags=re.I,
        )
        speaker = unescape(speaker_match.group(1)).strip() if speaker_match else ""
        text = re.sub(r"<[^>]+>", " ", inner)
        text = unescape(re.sub(r"\s+", " ", text)).strip()
        if speaker and text.lower().startswith(speaker.lower()):
            text = text[len(speaker):].strip(" :")
        if len(text) < 2:
            continue
        parts.append(f"{speaker}: {text}" if speaker else text)
    return "\n\n".join(parts)
