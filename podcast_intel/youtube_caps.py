"""Match an episode to a YouTube video and read its captions.

The video id is discovered from a search. It is not stored in the repo.
yt-dlp is used when it is installed. Otherwise the public search page is read.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from urllib.parse import quote

import requests

_STOP = {
    "with", "from", "that", "this", "have", "your", "about", "into",
    "episode", "show", "best", "like", "invest", "podcast",
}
_SHOW_STOP = {
    "the", "show", "podcast", "with", "and", "from", "that", "this",
    "best", "like",
}
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


def title_words(title: str) -> list[str]:
    words = []
    for raw in re.findall(r"[A-Za-z][A-Za-z']{3,}", title or ""):
        word = raw.lower().strip("'")
        if word in _STOP or word in words:
            continue
        words.append(word)
        if len(words) >= 8:
            break
    return words


def show_tokens(show: str) -> list[str]:
    """Distinctive words in a show name. 'The a16z Show' keeps a16z."""
    tokens = []
    for raw in re.findall(r"[A-Za-z0-9][A-Za-z0-9']{2,}", show or ""):
        word = raw.lower().strip("'")
        if len(word) < 4 or word in _SHOW_STOP or word in tokens:
            continue
        tokens.append(word)
    return tokens


def show_on_video(show: str, channel: str, title: str) -> bool:
    """True when this video is from the show, even if the channel is shorter."""
    blob = f"{channel or ''} {title or ''}".lower()
    show_l = " ".join((show or "").split()).lower()
    if not show_l:
        return False
    if show_l in blob:
        return True
    return any(token in blob for token in show_tokens(show))


def pick_video(
    show: str,
    title: str,
    published: str,
    rows: list[dict],
    notes: str = "",
) -> dict | None:
    """Prefer the channel's video that shares the guest's words, then the date."""
    words = title_words(title)
    for word in title_words(notes):
        if word not in words:
            words.append(word)
        if len(words) >= 16:
            break
    published = (published or "")[:10]
    best: tuple[int, int, dict] | None = None
    for row in rows or []:
        video_id = str(row.get("id") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            continue
        channel = str(row.get("channel") or "")
        vtitle = str(row.get("title") or "")
        blob = f"{vtitle} {row.get('description') or ''}".lower()
        if not show_on_video(show, channel, vtitle):
            continue
        overlap = sum(1 for word in words if word in blob)
        day = _day(str(row.get("upload_date") or ""))
        same_day = bool(published and day == published)
        if overlap < 1:
            continue
        if overlap < 2 and not same_day:
            continue
        score = overlap * 3 + (8 if same_day else 0)
        if best is None or score > best[0]:
            best = (score, overlap, row)
    return best[2] if best else None


def _day(raw: str) -> str:
    if re.fullmatch(r"20\d{6}", raw):
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", raw):
        return raw
    return ""


def search_queries(show: str, title: str) -> list[str]:
    """A short guest query, then a few distinctive words. Brackets stay out."""
    first = search_query(show, title)
    words = title_words(title)
    second = f"{show} {' '.join(words[:4])}".strip()
    queries = []
    for query in (first, second):
        query = re.sub(r"\s+", " ", query).strip()[:180]
        if query and query not in queries:
            queries.append(query)
    return queries


def search_query(show: str, title: str) -> str:
    """Guest plus show. The bracketed episode tag makes YouTube search return nothing."""
    cleaned = re.sub(r"\[[^\]]*\]", " ", title or "")
    guest = cleaned.split(" - ")[0]
    guest = re.sub(r"\s+", " ", guest).strip()
    return f"{show} {guest}".strip()[:180]


def _json_after(html: str, marker: str) -> dict:
    start = (html or "").find(marker)
    if start < 0:
        return {}
    brace = html.find("{", start)
    if brace < 0:
        return {}
    try:
        data, _end = json.JSONDecoder().raw_decode(html[brace:])
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _snippet(renderer: dict) -> str:
    parts: list[str] = []
    for key in ("detailedMetadataSnippets", "descriptionSnippet"):
        node = renderer.get(key)
        if isinstance(node, list):
            for row in node:
                if isinstance(row, dict):
                    parts.append(_yt_text(row.get("snippetText")))
        elif isinstance(node, dict):
            parts.append(_yt_text(node.get("snippetText") or node))
    return re.sub(r"\s+", " ", " ".join(part for part in parts if part)).strip()[:800]


def _yt_text(node) -> str:
    if not isinstance(node, dict):
        return ""
    if isinstance(node.get("simpleText"), str):
        return node["simpleText"]
    runs = node.get("runs") or []
    return "".join(row.get("text") or "" for row in runs if isinstance(row, dict))


def videos_from_search(data: dict, limit: int = 6) -> list[dict]:
    """Video rows from a YouTube search payload. No network."""
    found: list[dict] = []

    def walk(node) -> None:
        if len(found) >= limit:
            return
        if isinstance(node, dict):
            renderer = node.get("videoRenderer")
            if isinstance(renderer, dict):
                video_id = str(renderer.get("videoId") or "").strip()
                if re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                    found.append({
                        "id": video_id,
                        "channel": _yt_text(renderer.get("ownerText") or renderer.get("longBylineText")),
                        "title": _yt_text(renderer.get("title")),
                        "upload_date": "",
                        "description": _snippet(renderer),
                    })
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data or {})
    return found[:limit]


def _search_html(query: str, limit: int) -> list[dict]:
    url = "https://www.youtube.com/results?search_query=" + quote(query)
    try:
        response = requests.get(
            url,
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
            timeout=20,
        )
        response.raise_for_status()
    except requests.RequestException:
        return []
    return videos_from_search(_json_after(response.text, "ytInitialData"), limit)


def search_videos(query: str, limit: int = 6) -> list[dict]:
    """yt-dlp when it is installed, otherwise the public search page."""
    limit = max(1, min(int(limit), 8))
    parsed = _search_ytdlp(query, limit)
    if parsed:
        return parsed
    return _search_html(query, limit)


def _search_ytdlp(query: str, limit: int) -> list[dict]:
    """yt-dlp search. Empty if yt-dlp is not installed."""
    cmd = [
        sys.executable, "-m", "yt_dlp",
        f"ytsearch{limit}:{query}",
        "--flat-playlist",
        "--no-warnings",
        "--print", "%(id)s\t%(channel)s\t%(title)s\t%(upload_date)s",
    ]
    for attempt in range(2):
        try:
            done = subprocess.run(cmd, capture_output=True, text=True, timeout=90, check=False)
        except (OSError, subprocess.TimeoutExpired):
            done = None
        parsed = []
        for line in ((done.stdout if done else "") or "").splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            parsed.append({
                "id": parts[0].strip(),
                "channel": parts[1].strip(),
                "title": parts[2].strip(),
                "upload_date": parts[3].strip() if len(parts) > 3 else "",
            })
        if parsed:
            return parsed
        if attempt == 0:
            time.sleep(2)
    return []


def description_from_player(data: dict) -> str:
    """shortDescription from a watch-page player payload. No network."""
    details = data.get("videoDetails") if isinstance(data, dict) else None
    if not isinstance(details, dict):
        return ""
    text = str(details.get("shortDescription") or "")
    return re.sub(r"\s+", " ", text).strip()[:800]


def _blurb_html(video_id: str) -> str:
    try:
        response = requests.get(
            f"https://www.youtube.com/watch?v={video_id}",
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
            timeout=20,
        )
        response.raise_for_status()
    except requests.RequestException:
        return ""
    return description_from_player(_json_after(response.text, "ytInitialPlayerResponse"))


def video_blurb(video_id: str) -> str:
    """Short description, used only to confirm the guest. Empty on failure."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id or ""):
        return ""
    text = _blurb_ytdlp(video_id)
    if text:
        return text
    return _blurb_html(video_id)


def _blurb_ytdlp(video_id: str) -> str:
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--skip-download", "--no-warnings",
        "--print", "%(description).800s",
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (done.stdout or "")[:800]


def rows_with_blurbs(show: str, rows: list[dict], limit: int = 2) -> list[dict]:
    """Add descriptions for the show's own videos when the title did not match."""
    filled = 0
    out = []
    for row in rows or []:
        row = dict(row)
        channel = str(row.get("channel") or "")
        vtitle = str(row.get("title") or "")
        if filled < limit and show_on_video(show, channel, vtitle) and not row.get("description"):
            row["description"] = video_blurb(str(row.get("id") or ""))
            filled += 1
        out.append(row)
    return out


def caption_text(video_id: str) -> str:
    """English captions as timed lines. Empty when none are available."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id or ""):
        return ""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        return ""
    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id, languages=["en", "en-US", "en-GB"])
        snippets = list(fetched)
    except TypeError:
        try:
            snippets = YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "en-US"])
        except Exception:
            return ""
    except Exception:
        return ""
    lines = []
    for snippet in snippets:
        if isinstance(snippet, dict):
            start = float(snippet.get("start") or 0)
            text = str(snippet.get("text") or "")
        else:
            start = float(getattr(snippet, "start", 0) or 0)
            text = str(getattr(snippet, "text", "") or "")
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        total = int(start)
        hours, rem = divmod(total, 3600)
        minutes, seconds = divmod(rem, 60)
        lines.append(f"[{hours:02d}:{minutes:02d}:{seconds:02d}] {text}")
    return "\n\n".join(lines)
