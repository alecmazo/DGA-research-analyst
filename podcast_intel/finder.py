"""Find a show and one episode for the Transcripts page.

Feed addresses come from iTunes at request time. Nothing here is a batch
ingest, and All-In is not special-cased: a person can pull any one episode.
"""

from __future__ import annotations

import hashlib
import ipaddress
from urllib.parse import quote, urlparse
from xml.etree import ElementTree as ET

import requests

from podcast_intel.feed import _local, item_from_element
from podcast_intel.ingest import USER_AGENT, acquire_episode, itunes_search

NO_TRANSCRIPT = (
    "No transcript file in this show's RSS feed, and the publisher did not "
    "publish one. YouTube blocks caption downloads from the server."
)
_SCAN_ITEMS = 40
_EPISODES = 12


class ShowFinderError(Exception):
    """The search box can show this message as-is."""


def clean_term(term: str) -> str:
    text = " ".join((term or "").split())
    if len(text) < 2:
        raise ShowFinderError("Type at least two characters.")
    return text[:80]


def clean_collection_id(value: str) -> str:
    text = str(value or "").strip()
    if not text.isdigit() or len(text) > 12:
        raise ShowFinderError("That show is not in the directory.")
    return text


def clean_episode_key(value: str) -> str:
    text = str(value or "").strip().lower()
    if len(text) != 20 or any(ch not in "0123456789abcdef" for ch in text):
        raise ShowFinderError("That episode is not in this show.")
    return text


def public_https(url: str) -> bool:
    """True for a normal public https URL. Rejects loopback and local names."""
    parsed = urlparse((url or "").strip())
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    if host in {"localhost"} or host.endswith(".local") or host.endswith(".internal"):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved)


def episode_key(episode: dict) -> str:
    raw = "|".join([
        str(episode.get("guid") or ""),
        str(episode.get("link") or ""),
        str(episode.get("title") or ""),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def same_show(stored_channel: str, show_name: str) -> bool:
    """True when the library folder is this show, including a 'with Host' suffix."""
    stored = " ".join((stored_channel or "").split())
    show = " ".join((show_name or "").split())
    if not stored or not show:
        return False
    if stored.casefold() == show.casefold():
        return True
    folded_show = show.casefold()
    folded_stored = stored.casefold()
    return any(folded_show.startswith(folded_stored + sep) for sep in (" with ", " - ", ": "))


def choose_channel(show_name: str, channels: list[str]) -> str:
    """Keep a new episode in the folder the library already uses for this show."""
    show_name = " ".join((show_name or "").split())[:200] or "Show"
    matches = [channel.strip() for channel in channels or [] if channel and same_show(channel, show_name)]
    if not matches:
        return show_name
    matches.sort(key=len)
    return matches[0][:200]


def show_hits(rows: list[dict]) -> list[dict]:
    hits = []
    seen = set()
    for row in rows or []:
        if not public_https(str(row.get("feedUrl") or "")):
            continue
        collection_id = str(row.get("collectionId") or "").strip()
        if not collection_id.isdigit() or collection_id in seen:
            continue
        seen.add(collection_id)
        hits.append({
            "collection_id": collection_id,
            "name": str(row.get("collectionName") or "Show")[:200],
            "author": str(row.get("artistName") or "")[:200],
        })
        if len(hits) >= 8:
            break
    return hits


def recent_episodes(items: list[dict], limit: int = _EPISODES) -> list[dict]:
    rows = [row for row in items or [] if isinstance(row, dict)]
    if any(row.get("published") for row in rows):
        rows = sorted(rows, key=lambda row: str(row.get("published") or ""), reverse=True)
    return rows[:limit]


def stored_hit(show_name: str, episode: dict, rows: list[dict]) -> dict | None:
    title = str(episode.get("title") or "").strip()
    short = title[:500]
    link = str(episode.get("link") or "").strip()
    for row in rows or []:
        url = str(row.get("video_url") or "").strip()
        if link and url and link == url:
            return row
        stored_title = str(row.get("title") or "").strip()
        if stored_title and stored_title in {title, short} and same_show(str(row.get("channel") or ""), show_name):
            return row
    return None


def shape_episodes(show_name: str, episodes: list[dict], stored_rows: list[dict]) -> list[dict]:
    shaped = []
    for episode in episodes or []:
        hit = stored_hit(show_name, episode, stored_rows)
        shaped.append({
            "key": episode_key(episode),
            "title": str(episode.get("title") or "Untitled")[:300],
            "published": str(episode.get("published") or ""),
            "stored_id": str((hit or {}).get("id") or ""),
        })
    return shaped


def search_shows(term: str) -> list[dict]:
    return show_hits(itunes_search(clean_term(term)))


def _recent_items(url: str) -> list[dict]:
    """First items in the feed. Podcast feeds put the newest episode first."""
    if not public_https(url):
        raise ShowFinderError("That show has no public feed.")
    response = None
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=20,
            stream=True,
        )
        response.raise_for_status()
        response.raw.decode_content = True
        items = []
        try:
            for _event, elem in ET.iterparse(response.raw, events=("end",)):
                if _local(elem.tag) != "item":
                    continue
                parsed = item_from_element(elem)
                elem.clear()
                if not parsed:
                    continue
                items.append(parsed)
                if len(items) >= _SCAN_ITEMS:
                    break
        except ET.ParseError as exc:
            if not items:
                raise ShowFinderError("That show's feed could not be read.") from exc
    except ShowFinderError:
        raise
    except requests.RequestException as exc:
        raise ShowFinderError("That show's feed did not load. Try again.") from exc
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
    return items


def lookup_show(collection_id: str) -> dict:
    collection_id = clean_collection_id(collection_id)
    url = "https://itunes.apple.com/lookup?entity=podcast&id=" + quote(collection_id)
    try:
        response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise ShowFinderError("Show search did not respond. Try again.") from exc
    results = payload.get("results") if isinstance(payload, dict) else None
    chosen = None
    for row in results or []:
        if isinstance(row, dict) and public_https(str(row.get("feedUrl") or "")):
            chosen = row
            break
    if not chosen:
        raise ShowFinderError("That show has no public feed.")
    return {
        "collection_id": collection_id,
        "name": str(chosen.get("collectionName") or "Show")[:200],
        "author": str(chosen.get("artistName") or "")[:200],
        "feed_url": str(chosen.get("feedUrl") or "").strip(),
    }


def load_show(collection_id: str) -> dict:
    """Show name plus the recent episodes, including the link used to match storage."""
    show = lookup_show(collection_id)
    try:
        episodes = recent_episodes(_recent_items(show["feed_url"]))
    except ShowFinderError:
        raise
    except Exception as exc:
        raise ShowFinderError("That show's feed could not be read.") from exc
    return {**show, "episodes": episodes}


def episode_by_key(episodes: list[dict], key: str) -> dict | None:
    key = clean_episode_key(key)
    for episode in episodes or []:
        if episode_key(episode) == key:
            return episode
    return None


def pull_text(show_name: str, episode: dict) -> dict:
    """Download one episode. Empty text is a normal miss, not an exception."""
    found = {**episode, "channel": show_name}
    try:
        text, tier, source_url = acquire_episode(found)
    except Exception as exc:
        raise ShowFinderError("The transcript could not be fetched. Try again.") from exc
    if not text:
        video_id = ""
        if "watch?v=" in (source_url or ""):
            video_id = source_url.split("watch?v=", 1)[1][:11]
        return {"ok": False, "error": NO_TRANSCRIPT, "video_id": video_id}
    return {
        "ok": True,
        "text": text,
        "tier": tier,
        "url": source_url or episode.get("link") or "",
    }
