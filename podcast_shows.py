"""Podcast show catalog.

One dict is the source for feed metadata. `podcast:guid` is a UUIDv5 of the
canonical feed URL (podcastindex namespace) and is not overridable, so a
host change cannot mint a second show identity.

Directory flags stay off until Alec turns them on. The feed is still served.
"""
from __future__ import annotations

import copy
import os
import uuid

# https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md
PODCAST_GUID_NAMESPACE = uuid.UUID("ead4c236-bf58-58c6-a2c6-a6b28d128cb6")
CANONICAL_FEED_ORIGIN = "https://portfolio.dgacapital.com"
ALIAS_SHOW = "dga-hitech"

OWNER_EMAIL = "alecmazo1@gmail.com"


def canonical_feed_url(show_id: str) -> str:
    return f"{CANONICAL_FEED_ORIGIN}/api/podcast/{show_id}/rss.xml"


def stable_podcast_guid(show_id: str) -> str:
    return str(uuid.uuid5(PODCAST_GUID_NAMESPACE, canonical_feed_url(show_id)))


def _show(
    show_id: str,
    *,
    title: str,
    description: str,
    category: str,
    subcategory: str,
) -> dict:
    return {
        "id": show_id,
        "title": title,
        "description": description,
        "artwork_url": "",
        "author": "DGA Capital",
        "owner_name": "DGA Capital",
        "owner_email": OWNER_EMAIL,
        "category": category,
        "subcategory": subcategory,
        "explicit": False,
        "language": "en-us",
        "type": "episodic",
        "podcast_guid": stable_podcast_guid(show_id),
        "directories": {
            "spotify": {"enabled": False},
            "apple": {"enabled": False},
        },
    }


SHOWS: dict[str, dict] = {
    "dga-hitech": _show(
        "dga-hitech",
        title="DGA HiTech Podcast",
        description=(
            "Sharp, fast-paced equity research dialogue from DGA Capital — "
            "Marc the PM moderates Rock (Grok) and Claudia (Claude) debating "
            "the long and short on each name. Informational only; not investment advice."
        ),
        category="Business",
        subcategory="Investing",
    ),
    "systems-over-goals": _show(
        "systems-over-goals",
        title="Systems Over Goals Daily",
        description=(
            "Systems Over Goals Daily. One 20–30 minute episode each day. "
            "Informational only; not investment advice."
        ),
        category="Business",
        subcategory="Management",
    ),
}

# Existing Railway env names keep working for the HiTech show.
_DGA_ENV = {
    "title": "PODCAST_RSS_TITLE",
    "description": "PODCAST_RSS_DESCRIPTION",
    "language": "PODCAST_RSS_LANGUAGE",
    "author": "PODCAST_RSS_AUTHOR",
    "owner_email": "PODCAST_RSS_OWNER_EMAIL",
    "owner_name": "PODCAST_RSS_AUTHOR",
    "category": "PODCAST_RSS_CATEGORY",
    "subcategory": "PODCAST_RSS_SUBCATEGORY",
    "artwork_url": "PODCAST_RSS_ARTWORK_URL",
}

_OVERRIDABLE = (
    "title",
    "description",
    "artwork_url",
    "author",
    "owner_name",
    "owner_email",
    "category",
    "subcategory",
    "language",
    "type",
)


def show_config(show_id: str | None) -> dict | None:
    """Return a copy of the show, with env overrides applied.

    `podcast_guid` and `directories` stay on the values in this file.
    """
    sid = ALIAS_SHOW if not show_id else show_id
    base = SHOWS.get(sid)
    if base is None:
        return None
    cfg = copy.deepcopy(base)
    slug = sid.upper().replace("-", "_")
    legacy = _DGA_ENV if sid == ALIAS_SHOW else {}
    for field in _OVERRIDABLE:
        specific = os.environ.get(f"PODCAST_SHOW_{slug}_{field.upper()}")
        old = os.environ.get(legacy[field]) if field in legacy else None
        val = specific if specific not in (None, "") else old
        if val not in (None, ""):
            cfg[field] = val
    explicit = os.environ.get(f"PODCAST_SHOW_{slug}_EXPLICIT")
    if explicit not in (None, ""):
        cfg["explicit"] = explicit.strip().lower() in ("1", "true", "yes")
    return cfg


def known_show(show_id: str | None) -> bool:
    sid = ALIAS_SHOW if not show_id else show_id
    return sid in SHOWS
