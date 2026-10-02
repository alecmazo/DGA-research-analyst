"""Fetch starter-show transcripts into the existing transcripts table.

Tiers, first success wins: the feed's transcript file, then a publisher
transcript page. Audio and Whisper are not used. All-In is refused.
"""

from __future__ import annotations

import os
import uuid
from urllib.parse import quote

import requests

from podcast_intel.feed import (
    normalize_transcript,
    parse_feed,
    publisher_is_preview,
    publisher_transcript,
    simplecast_slug,
    simplecast_transcript_text,
)
from podcast_intel.shows import CATALOG, ShowSkipped, pick_show, show_spec
from podcast_intel.youtube_caps import (
    caption_text,
    pick_video,
    rows_with_blurbs,
    search_queries,
    search_videos,
)

USER_AGENT = "DGA-Research-Analyst/1.0 (transcript library; personal research)"
MIN_CHARS = 800
_TIMEOUT = 60


def itunes_search(term: str) -> list[dict]:
    url = (
        "https://itunes.apple.com/search?media=podcast&entity=podcast&limit=10&term="
        + quote(term)
    )
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=_TIMEOUT)
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results") if isinstance(payload, dict) else None
    return [row for row in results or [] if isinstance(row, dict)]


def discover_feed(name: str) -> dict:
    """RSS address for one starter show. Raises ShowSkipped for All-In."""
    spec = show_spec(name)
    chosen = pick_show(itunes_search(spec["name"]), spec)
    if not chosen:
        raise ShowSkipped(f"iTunes had no matching feed for {spec['name']}")
    return {
        "name": spec["name"],
        "feed_url": chosen["feedUrl"],
        "author": chosen.get("artistName") or "",
    }


def _get(url: str) -> requests.Response:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=_TIMEOUT)
    response.raise_for_status()
    return response


def _text_from_urls(urls: list[dict]) -> tuple[str, str]:
    for row in urls or []:
        url = row.get("url") or ""
        if not url:
            continue
        try:
            body = _get(url).text
        except requests.RequestException:
            continue
        text = normalize_transcript(body)
        if len(text) >= MIN_CHARS:
            return text, "T1"
    return "", ""


def _text_from_page(url: str) -> tuple[str, str]:
    if not url or not url.startswith("http"):
        return "", ""
    host = url.split("/")[2].lower()
    if not any(piece in host for piece in ("colossus.com", "acquired.fm")):
        return "", ""
    try:
        html = _get(url).text
    except requests.RequestException:
        return "", ""
    if publisher_is_preview(html):
        return "", ""
    text = publisher_transcript(html)
    if len(text) >= MIN_CHARS:
        return text, "T2"
    return "", ""


def _text_from_simplecast(url: str) -> tuple[str, str]:
    """Publisher transcript on Simplecast. Spotify has no free transcript API."""
    slug = simplecast_slug(url)
    if not slug:
        return "", ""
    try:
        response = requests.post(
            "https://api.simplecast.com/episodes/search",
            json={"slug": slug},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError):
        return "", ""
    text = simplecast_transcript_text(payload)
    if len(text) >= MIN_CHARS:
        return text, "T2"
    return "", ""


def _text_from_youtube(episode: dict) -> tuple[str, str, str]:
    show = episode.get("channel") or ""
    title = episode.get("title") or ""
    if not show or not title:
        return "", "", ""
    notes = episode.get("notes") or ""
    matched = ""
    for query in search_queries(show, title):
        rows = search_videos(query)
        published = episode.get("published") or ""
        chosen = pick_video(show, title, published, rows, notes)
        if not chosen:
            chosen = pick_video(show, title, published, rows_with_blurbs(show, rows), notes)
        if not chosen:
            continue
        matched = f"https://www.youtube.com/watch?v={chosen['id']}"
        text = caption_text(chosen["id"])
        if len(text) >= MIN_CHARS:
            return text, "T3", matched
    return "", "", matched


def acquire_episode(episode: dict) -> tuple[str, str, str]:
    """Return text, tier, and the URL the words came from."""
    text, tier = _text_from_urls(episode.get("transcripts") or [])
    if text:
        return text, tier, episode.get("link") or ""
    text, tier = _text_from_page(episode.get("link") or "")
    if text:
        return text, tier, episode.get("link") or ""
    text, tier = _text_from_simplecast(episode.get("link") or "")
    if text:
        return text, tier, episode.get("link") or ""
    return _text_from_youtube(episode)


def _connect():
    url = os.environ.get("DATABASE_URL") or ""
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    import psycopg2
    return psycopg2.connect(url)


def _already_stored(cur, channel: str, title: str, link: str) -> bool:
    cur.execute(
        """
        SELECT 1 FROM transcripts
         WHERE (%s <> '' AND video_url = %s)
            OR (channel = %s AND title = %s)
         LIMIT 1
        """,
        (link, link, channel, title),
    )
    return cur.fetchone() is not None


def _insert(cur, *, channel: str, title: str, link: str, published: str, text: str, tier: str) -> str:
    new_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO transcripts
            (id, source, person, ticker, title, video_url, channel,
             published_at, full_text, summary, word_count, created_by)
        VALUES (%s, %s, NULL, NULL, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            new_id,
            {"T1": "podcast_t1", "T2": "podcast_t2"}.get(tier, "podcast_t3"),
            title[:500],
            (link or "")[:1000] or None,
            channel[:200],
            published[:40] or None,
            text,
            f"Published transcript ({tier}).",
            len(text.split()),
            "podcast-intel",
        ),
    )
    return new_id


def ingest_show(name: str, limit: int = 3, dry_run: bool = False) -> list[dict]:
    """Store up to `limit` new episodes. Episodes already in the library are skipped."""
    found = discover_feed(name)
    feed = _get(found["feed_url"])
    episodes = parse_feed(feed.text)
    return _store_episodes(found["name"], episodes, limit=limit, dry_run=dry_run)


def ingest_feeds(limit: int = 3, dry_run: bool = False) -> list[dict]:
    """Odd Lots, Invest Like the Best, and Acquired. Not All-In."""
    rows: list[dict] = []
    for spec in CATALOG:
        rows.extend(ingest_show(spec["name"], limit=limit, dry_run=dry_run))
    return rows


def _store_episodes(channel: str, episodes: list[dict], limit: int, dry_run: bool) -> list[dict]:
    kept: list[dict] = []
    stored = 0
    looked = 0
    conn = None if dry_run else _connect()
    try:
        cur = None if conn is None else conn.cursor()
        for episode in episodes:
            if stored >= limit or looked >= max(limit * 6, limit):
                break
            looked += 1
            title = episode.get("title") or "Untitled"
            link = episode.get("link") or ""
            if cur is not None and _already_stored(cur, channel, title, link):
                kept.append({"show": channel, "title": title, "status": "already stored"})
                continue
            episode = {**episode, "channel": channel}
            text, tier, source_url = acquire_episode(episode)
            if not text:
                kept.append({"show": channel, "title": title, "status": "no transcript"})
                continue
            if cur is not None:
                _insert(
                    cur,
                    channel=channel,
                    title=title,
                    link=source_url or link,
                    published=episode.get("published") or "",
                    text=text,
                    tier=tier,
                )
                conn.commit()
            stored += 1
            kept.append({
                "show": channel,
                "title": title,
                "status": "dry-run" if dry_run else "stored",
                "tier": tier,
                "chars": len(text),
                "published": episode.get("published") or "",
            })
    finally:
        if conn is not None:
            conn.close()
    return kept


def format_report(rows: list[dict]) -> str:
    lines = []
    for row in rows:
        bits = [row.get("show") or "", row.get("status") or "", row.get("title") or ""]
        if row.get("tier"):
            bits.append(str(row["tier"]))
        if row.get("chars"):
            bits.append(f"{row['chars']} chars")
        if row.get("published"):
            bits.append(str(row["published"]))
        lines.append(" · ".join(bit for bit in bits if bit))
    return "\n".join(lines)
