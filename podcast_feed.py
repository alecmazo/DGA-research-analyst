"""RSS 2.0 for one show. The HTTP routes call this; they do not build a second feed."""
from __future__ import annotations

import os
import struct
import uuid
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

from podcast_shows import ALIAS_SHOW, directories_blocked, show_config

ARTWORK_MIN_PX = 1400
ARTWORK_MAX_PX = 3000


class UnknownShow(LookupError):
    pass


def mint_episode_guid() -> str:
    """New generation. A fresh UUID so a regenerate is a new episode."""
    return str(uuid.uuid4())


def legacy_episode_guid(ticker: str, format: str | None) -> str:
    """GUID already published for a row that predates episode history."""
    return f"{(ticker or '').upper()}::{format or 'debate'}"


def _xml_escape(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _cdata(s: str) -> str:
    return (s or "").replace("]]>", "]]&gt;")


def _rfc2822(dt) -> str:
    if dt is None:
        dt = datetime.now(timezone.utc)
    elif isinstance(dt, str):
        text = dt.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            dt = datetime.now(timezone.utc)
    if getattr(dt, "tzinfo", None) is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return format_datetime(dt)


def _explicit(value) -> str:
    if value in (True, "true", "True", "yes", "Yes", "1", 1):
        return "true"
    return "false"


def _itunes_duration(seconds) -> str:
    """Whole seconds. Apple accepts that form, so 1430 stays 1430 in the feed."""
    try:
        duration = max(0, int(float(seconds or 0)))
    except (TypeError, ValueError):
        duration = 0
    return str(duration)


def _item_bodies(episode: dict) -> tuple[str, str]:
    """Short description, then show notes for content:encoded.

    A row that only has one text keeps today's description on both tags.
    """
    summary = (
        episode.get("summary")
        or episode.get("description")
        or episode.get("title")
        or episode.get("episode_title")
        or ""
    )
    notes = (episode.get("show_notes") or "").strip()
    if notes and notes != (summary or "").strip():
        return (summary or "").strip(), notes
    desc = _item_description(episode)
    return desc, desc


def episode_byte_size(episode: dict) -> int:
    """Bytes on the enclosure. Zero means the item is left out of the feed."""
    try:
        n = int(episode.get("byte_size") or 0)
    except (TypeError, ValueError):
        n = 0
    if n > 0:
        return n
    path = episode.get("audio_local_path") or ""
    if path:
        p = Path(path)
        if p.is_file():
            return p.stat().st_size
    key = episode.get("media_key") or ""
    if key:
        try:
            from podcast_media import get_media_store
            return int(get_media_store().size(key) or 0)
        except Exception:
            return 0
    return 0


def enclosure_url(show_id: str, guid: str, *, media_base: str, request_base: str) -> str:
    key = f"{show_id}/{quote(guid, safe='')}.mp3"
    base = (media_base or "").rstrip("/")
    if base:
        return f"{base}/{key}"
    return f"{request_base.rstrip('/')}/api/public/podcast/media/{key}"


def _feed_origin(show_id: str, *, feed_base: str, request_base: str) -> str:
    origin = (feed_base or request_base or "").rstrip("/")
    return f"{origin}/api/podcast/{show_id}/rss.xml"


def _item_description(episode: dict) -> str:
    summary = (
        episode.get("summary")
        or episode.get("description")
        or episode.get("title")
        or episode.get("episode_title")
        or ""
    )
    return (
        f"{summary}\n\n"
        "DGA Capital is an exempt reporting adviser in California. "
        "This episode is for informational purposes only — "
        "it is not investment advice or a solicitation."
    )


_HIDDEN_STATUS = {"ready_pending", "failed", "cost_cap_hit", "draft", "running"}


def _as_utc(value):
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value.strip():
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def episode_visible(episode: dict, now: datetime | None = None) -> bool:
    """The feed and the player hide a row until it is published and due."""
    status = (episode.get("status") or "").strip().lower()
    if status in _HIDDEN_STATUS:
        return False
    pub = _as_utc(episode.get("published_at"))
    if pub is None:
        return True
    clock = _as_utc(now) or datetime.now(timezone.utc)
    return pub <= clock


def _sorted_episodes(episodes: list[dict]) -> list[dict]:
    def _key(ep: dict):
        dt = ep.get("published_at") or ep.get("generated_at")
        if isinstance(dt, datetime):
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        if isinstance(dt, str):
            try:
                parsed = datetime.fromisoformat(dt.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return parsed
            except ValueError:
                pass
        return datetime.min.replace(tzinfo=timezone.utc)

    return sorted(episodes or [], key=_key, reverse=True)


def render_show_feed(
    show_id: str | None,
    episodes: list[dict] | None,
    *,
    request_base: str,
    media_base: str | None = None,
    feed_base: str | None = None,
    now: datetime | None = None,
) -> str:
    """RSS for `show_id`. None is the `/api/podcast/rss.xml` alias of dga-hitech."""
    sid = ALIAS_SHOW if not show_id else show_id
    cfg = show_config(sid)
    if cfg is None:
        raise UnknownShow(sid)

    if media_base is None:
        media_base = os.environ.get("PODCAST_MEDIA_BASE_URL") or ""
    if feed_base is None:
        feed_base = os.environ.get("PODCAST_FEED_BASE_URL") or ""

    warning = artwork_warning(cfg.get("artwork_url") or "")
    if warning:
        print(f"⚠️ [podcast-feed] {warning}", flush=True)

    feed_url = _feed_origin(sid, feed_base=feed_base, request_base=request_base)
    explicit = _explicit(cfg.get("explicit"))
    author = cfg.get("author") or "DGA Capital"
    owner_email = cfg.get("owner_email") or ""
    artwork = (cfg.get("artwork_url") or "").strip()
    artwork_tag = (
        f'    <itunes:image href="{_xml_escape(artwork)}"/>\n' if artwork else ""
    )

    items: list[str] = []
    for ep in _sorted_episodes(episodes or []):
        if not episode_visible(ep, now=now):
            continue
        length = episode_byte_size(ep)
        if length <= 0:
            continue
        guid = ep.get("episode_guid") or legacy_episode_guid(
            ep.get("ticker") or "", ep.get("format")
        )
        title = ep.get("title") or ep.get("episode_title") or guid
        desc, notes = _item_bodies(ep)
        pub = _rfc2822(ep.get("published_at") or ep.get("generated_at"))
        duration = _itunes_duration(ep.get("duration_sec"))
        enc = enclosure_url(sid, guid, media_base=media_base, request_base=request_base)
        link = ep.get("link") or enc
        transcript = (ep.get("transcript_url") or "").strip()
        transcript_tag = (
            f'      <podcast:transcript url="{_xml_escape(transcript)}" type="text/plain"/>\n'
            if transcript else ""
        )
        episode_no = ep.get("episode_number")
        try:
            episode_no = int(episode_no) if episode_no not in (None, "") else None
        except (TypeError, ValueError):
            episode_no = None
        episode_tag = (
            f"      <itunes:episode>{episode_no}</itunes:episode>\n" if episode_no else ""
        )
        episode_type = ep.get("episode_type") or "full"
        items.append(
            "    <item>\n"
            f"      <title>{_xml_escape(title)}</title>\n"
            f"      <description><![CDATA[{_cdata(desc)}]]></description>\n"
            f"      <content:encoded><![CDATA[{_cdata(notes)}]]></content:encoded>\n"
            f"      <itunes:summary><![CDATA[{_cdata(desc)}]]></itunes:summary>\n"
            f"      <pubDate>{pub}</pubDate>\n"
            f'      <guid isPermaLink="false">{_xml_escape(guid)}</guid>\n'
            f"      <link>{_xml_escape(link)}</link>\n"
            f'      <enclosure url="{_xml_escape(enc)}" '
            f'type="audio/mpeg" length="{length}"/>\n'
            f"{transcript_tag}"
            f"      <itunes:duration>{duration}</itunes:duration>\n"
            f"{episode_tag}"
            f"      <itunes:author>{_xml_escape(author)}</itunes:author>\n"
            f"      <itunes:explicit>{explicit}</itunes:explicit>\n"
            f"      <itunes:episodeType>{_xml_escape(episode_type)}</itunes:episodeType>\n"
            "    </item>"
        )

    channel_link = (feed_base or request_base or "").rstrip("/") or feed_url
    block_tag = "    <itunes:block>Yes</itunes:block>\n" if directories_blocked(cfg) else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0"\n'
        '     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"\n'
        '     xmlns:podcast="https://podcastindex.org/namespace/1.0"\n'
        '     xmlns:content="http://purl.org/rss/1.0/modules/content/"\n'
        '     xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "  <channel>\n"
        f"    <title>{_xml_escape(cfg.get('title') or '')}</title>\n"
        f"    <link>{_xml_escape(channel_link)}</link>\n"
        f"    <description>{_xml_escape(cfg.get('description') or '')}</description>\n"
        f"    <language>{_xml_escape(cfg.get('language') or 'en-us')}</language>\n"
        f"    <itunes:author>{_xml_escape(author)}</itunes:author>\n"
        f"    <itunes:summary><![CDATA[{_cdata(cfg.get('description') or '')}]]></itunes:summary>\n"
        "    <itunes:owner>\n"
        f"      <itunes:name>{_xml_escape(cfg.get('owner_name') or author)}</itunes:name>\n"
        f"      <itunes:email>{_xml_escape(owner_email)}</itunes:email>\n"
        "    </itunes:owner>\n"
        f"    <itunes:explicit>{explicit}</itunes:explicit>\n"
        f"    <itunes:type>{_xml_escape(cfg.get('type') or 'episodic')}</itunes:type>\n"
        f"{block_tag}"
        f'    <itunes:category text="{_xml_escape(cfg.get("category") or "Business")}">\n'
        f'      <itunes:category text="{_xml_escape(cfg.get("subcategory") or "Investing")}"/>\n'
        "    </itunes:category>\n"
        f"{artwork_tag}"
        f'    <podcast:locked owner="{_xml_escape(owner_email)}">no</podcast:locked>\n'
        f"    <podcast:guid>{_xml_escape(cfg.get('podcast_guid') or '')}</podcast:guid>\n"
        f'    <atom:link href="{_xml_escape(feed_url)}" rel="self" type="application/rss+xml"/>\n'
        "    <copyright>© DGA Capital. All rights reserved.</copyright>\n"
        + ("\n".join(items) + "\n" if items else "")
        + "  </channel>\n"
        "</rss>\n"
    )


def artwork_warning(url: str) -> str | None:
    """1400–3000 px square JPG/PNG in RGB. A problem is a warning, never an exception."""
    url = (url or "").strip()
    if not url:
        return None
    try:
        data = _read_artwork(url)
        info = _image_info(data)
        if info is None:
            return f"artwork {url} is not a JPG or PNG"
        w, h, rgb = info
        if w != h or w < ARTWORK_MIN_PX or w > ARTWORK_MAX_PX or not rgb:
            return (
                f"artwork {url} is {w}x{h} rgb={rgb}; "
                f"Apple wants a {ARTWORK_MIN_PX}–{ARTWORK_MAX_PX}px square JPG or PNG in RGB"
            )
        return None
    except Exception as e:
        return f"artwork check skipped for {url}: {e!s:.160}"


def _read_artwork(url: str) -> bytes:
    path = Path(url)
    if path.is_file():
        return path.read_bytes()
    req = Request(url, headers={"User-Agent": "DGA-podcast-feed"})
    with urlopen(req, timeout=4) as resp:
        return resp.read(512_000)


def _image_info(data: bytes) -> tuple[int, int, bool] | None:
    """Return (width, height, is_rgb) for PNG or JPEG, else None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        # color type 2 = RGB, 6 = RGBA
        w, h, _depth, color = struct.unpack(">IIBB", data[16:26])
        return w, h, color in (2, 6)
    if data.startswith(b"\xff\xd8"):
        return _jpeg_info(data)
    return None


def _jpeg_info(data: bytes) -> tuple[int, int, bool] | None:
    i = 2
    sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    n = len(data)
    while i + 8 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        while i < n and data[i] == 0xFF:
            i += 1
        if i >= n:
            break
        marker = data[i]
        i += 1
        if marker in (0xD8, 0xD9):
            continue
        if i + 2 > n:
            break
        seg_len = struct.unpack(">H", data[i:i + 2])[0]
        if marker in sof and i + 7 <= n:
            precision = data[i + 2]
            h, w = struct.unpack(">HH", data[i + 3:i + 7])
            components = data[i + 7] if i + 8 <= n else 0
            _ = precision
            return w, h, components >= 3
        i += seg_len
    return None
