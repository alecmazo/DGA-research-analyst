"""Erase a published episode, or add one from an MP3 dropped on the studio.

The daily generator keeps its own path. This module only adds and removes
rows in analyst_podcast_episodes. A manual file leaves episode_date empty
so it does not take the one-episode-per-date slot.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from podcast_feed import mint_episode_guid
from podcast_shows import known_show

MAX_UPLOAD_BYTES = 80 * 1024 * 1024
_MPEG1_L3_KBPS = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)


class UploadRejected(ValueError):
    """The dropped file is not an MP3 the feed can publish."""


def _row_dict(cur, row):
    if row is None:
        return None
    if isinstance(row, dict):
        return row
    names = [d[0] for d in (cur.description or [])]
    return dict(zip(names, row))


def title_from_filename(filename: str) -> str:
    stem = Path(filename or "episode.mp3").name
    if stem.lower().endswith(".mp3"):
        stem = stem[:-4]
    stem = stem.replace("_", " ").replace("-", " ")
    stem = " ".join(stem.split())
    return (stem or "Uploaded episode")[:180]


def is_mp3(data: bytes, filename: str = "") -> bool:
    name = (filename or "").lower()
    if name.endswith(".mp3"):
        return bool(data)
    if data[:3] == b"ID3":
        return True
    return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


def _id3v2_skip(data: bytes) -> int:
    if len(data) < 10 or data[:3] != b"ID3":
        return 0
    size = 0
    for byte in data[6:10]:
        size = (size << 7) | (byte & 0x7F)
    return min(len(data), 10 + size)


def mp3_duration_seconds(data: bytes) -> float | None:
    """Seconds from the first MPEG frame bitrate, or mutagen when it is installed."""
    try:
        from io import BytesIO
        from mutagen.mp3 import MP3
        audio = MP3(BytesIO(data))
        length = getattr(getattr(audio, "info", None), "length", None)
        if length:
            return float(length)
    except Exception:
        pass
    start = _id3v2_skip(data)
    end = min(len(data) - 4, start + 65536)
    index = start
    while index < end:
        if data[index] == 0xFF and (data[index + 1] & 0xE0) == 0xE0:
            header = int.from_bytes(data[index:index + 4], "big")
            version = (header >> 19) & 0b11
            layer = (header >> 17) & 0b11
            bitrate_index = (header >> 12) & 0b1111
            if version == 0b11 and layer == 0b01 and bitrate_index not in (0, 15):
                bitrate = _MPEG1_L3_KBPS[bitrate_index] * 1000
                audio_bytes = max(0, len(data) - start)
                if bitrate and audio_bytes:
                    return audio_bytes * 8 / bitrate
        index += 1
    return None


def _check_guid(guid: str) -> str:
    guid = (guid or "").strip()
    if not guid or "/" in guid or "\\" in guid or ".." in guid:
        raise LookupError("unknown episode")
    return guid


def _delete_media(store, show: str, guid: str, row: dict) -> None:
    keys = []
    media_key = (row.get("media_key") or "").strip()
    if media_key:
        keys.append(media_key)
    keys.append(f"{show}/{guid}.mp3")
    keys.append(f"{show}/{guid}.transcript.txt")
    seen = set()
    for key in keys:
        if key in seen:
            continue
        seen.add(key)
        try:
            store.delete(key)
        except Exception as exc:
            print(f"[podcast] media delete failed for {key}: {exc!s:.160}", flush=True)
    local = (row.get("audio_local_path") or "").strip()
    if local:
        path = Path(local)
        try:
            if path.is_file():
                path.unlink()
        except Exception as exc:
            print(f"[podcast] local mp3 delete failed: {exc!s:.160}", flush=True)
    _dropbox_delete(row.get("audio_dropbox_path"))


def _dropbox_delete(path: str | None) -> None:
    dest = (path or "").strip()
    if not dest:
        return
    try:
        import DGA_analyst as analyst
        client = analyst._dropbox_client()
        if client is not None:
            client.files_delete_v2(dest)
    except Exception as exc:
        print(f"[podcast] dropbox delete failed: {exc!s:.160}", flush=True)


def erase_episode(show: str, guid: str, *, connect, store) -> dict:
    """Remove one episode from the feed and delete its audio file."""
    if not known_show(show):
        raise LookupError("unknown show")
    guid = _check_guid(guid)
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT episode_guid, media_key, audio_local_path, audio_dropbox_path
              FROM analyst_podcast_episodes
             WHERE show = %s AND episode_guid = %s
            """,
            (show, guid),
        )
        row = _row_dict(cur, cur.fetchone())
        if not row:
            raise LookupError("unknown episode")
        cur.execute(
            "DELETE FROM analyst_podcast_episodes WHERE show = %s AND episode_guid = %s",
            (show, guid),
        )
        cur.execute(
            "DELETE FROM analyst_podcasts WHERE episode_guid = %s",
            (guid,),
        )
        conn.commit()
    _delete_media(store, show, guid, row)
    return {"ok": True, "show": show, "episode_guid": guid}


def _row_from_cursor(cur):
    row = cur.fetchone()
    if row is None:
        return None
    if isinstance(row, dict):
        return row
    names = [d[0] for d in (cur.description or [])]
    if names and not isinstance(row, dict):
        return dict(zip(names, row))
    return None


def _matching_episode(connect, store, show: str, data: bytes):
    """Same bytes as an episode already on the show. Keep that row's title, date, and guid."""
    try:
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT episode_guid, episode_title, published_at, byte_size, media_key, duration_sec
                  FROM analyst_podcast_episodes
                 WHERE show = %s AND byte_size = %s
                 ORDER BY published_at NULLS LAST
                 LIMIT 5
                """,
                (show, len(data)),
            )
            row = _row_from_cursor(cur)
    except Exception:
        return None
    if not row:
        return None
    getter = getattr(store, "get", None)
    key = (row.get("media_key") or "").strip()
    if getter and key:
        try:
            current = getter(key)
        except Exception:
            current = None
        if current == data:
            return row
        return None
    return None


def upload_episode(show: str, data: bytes, filename: str, *, connect, store, title: str | None = None, now=None) -> dict:
    """Publish a desktop MP3 on the selected show."""
    if not known_show(show):
        raise LookupError("unknown show")
    blob = data or b""
    if not blob:
        raise UploadRejected("Drop an MP3 file.")
    if len(blob) > MAX_UPLOAD_BYTES:
        raise UploadRejected("That file is too large. The limit is 80 MB.")
    if not is_mp3(blob, filename):
        raise UploadRejected("Drop an MP3 file.")
    kept = _matching_episode(connect, store, show, blob)
    if kept:
        return {
            "ok": True,
            "show": show,
            "episode_guid": kept.get("episode_guid"),
            "title": kept.get("episode_title") or kept.get("title"),
            "byte_size": kept.get("byte_size") or len(blob),
            "duration_sec": kept.get("duration_sec"),
            "kept": True,
            "audio_url": f"/api/public/podcast/media/{show}/{kept.get('episode_guid')}.mp3",
        }
    from podcast_sogd import pilot_upload_override
    override = pilot_upload_override(blob)
    guid = (override or {}).get("episode_guid") or mint_episode_guid()
    episode_title = (override or {}).get("title") or (title or "").strip() or title_from_filename(filename)
    when = (override or {}).get("published_at") or now or datetime.now(timezone.utc)
    duration = (override or {}).get("duration_sec") or mp3_duration_seconds(blob)
    notes = (override or {}).get("notes") or "Uploaded from the studio. Not investment advice. © DGA Capital."
    media_key = f"{show}/{guid}.mp3"
    store.put(media_key, blob)
    written = store.local_path(media_key)
    local_path = str(written) if written is not None else ""
    dropbox_path = store.dropbox_path(media_key) if hasattr(store, "dropbox_path") else None
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO analyst_podcast_episodes (
                episode_guid, show, ticker, format, episode_title, script_json,
                media_key, byte_size, duration_sec, audio_local_path,
                audio_dropbox_path, published_at, episode_date, status,
                show_notes, summary, chapters_json
            )
            VALUES (
                %s, %s, 'MANUAL', 'manual', %s, %s::jsonb,
                %s, %s, %s, %s,
                %s, %s, NULL, 'published',
                %s, %s, '[]'
            )
            """,
            (
                guid,
                show,
                episode_title,
                json.dumps({"source": "upload", "filename": Path(filename or "").name[:240]}),
                media_key,
                len(blob),
                duration,
                local_path or None,
                dropbox_path,
                when,
                notes,
                notes,
            ),
        )
        conn.commit()
    return {
        "ok": True,
        "show": show,
        "episode_guid": guid,
        "title": episode_title,
        "byte_size": len(blob),
        "duration_sec": duration,
        "audio_url": f"/api/public/podcast/media/{show}/{guid}.mp3",
    }
