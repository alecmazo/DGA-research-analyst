"""Which starter shows this ingest will fetch. Feed URLs are not stored here.

iTunes Search is the source of the RSS address. A result counts only when
the show title and the publisher both match, so a copycat with the same
name is rejected. All-In is excluded on purpose.
"""

from __future__ import annotations

CATALOG = (
    {
        "name": "Odd Lots",
        "title": "odd lots",
        "author": "bloomberg",
    },
    {
        "name": "Invest Like the Best",
        "title": "invest like the best",
        "author": "colossus",
    },
    {
        "name": "Acquired",
        "title": "acquired",
        "author": "gilbert",
    },
)

_ALL_IN = {
    "all-in",
    "all in",
    "all-in podcast",
    "all in podcast",
}


class ShowSkipped(Exception):
    """The requested show is not one of the starter shows we ingest."""


def _key(name: str) -> str:
    return " ".join((name or "").strip().lower().split())


def show_spec(name: str) -> dict:
    key = _key(name)
    if key in _ALL_IN:
        raise ShowSkipped("All-In is not part of this ingest")
    for spec in CATALOG:
        if key == spec["title"] or key == spec["name"].lower():
            return spec
    raise ShowSkipped(f"No starter show named {name}")


def pick_show(results: list[dict], spec: dict) -> dict | None:
    """Choose the iTunes hit whose title and publisher match the show."""
    title = spec["title"]
    author = spec["author"]
    best: tuple[int, dict] | None = None
    for row in results or []:
        feed = str(row.get("feedUrl") or "").strip()
        if not feed:
            continue
        name = str(row.get("collectionName") or "").strip().lower()
        artist = str(row.get("artistName") or "").strip().lower()
        if author not in artist:
            continue
        if name == title:
            score = 2
        elif name.startswith(title + " "):
            score = 1
        else:
            continue
        if best is None or score > best[0]:
            best = (score, row)
    return best[1] if best else None
