"""Choose stored podcast shows to remove. No network and no database."""

from __future__ import annotations

MAX_SHOWS = 40
MAX_CHANNEL = 200

# Show names on the transcripts table. Earnings-call chunks are not in that table.
CHANNEL_EXPR = "COALESCE(NULLIF(btrim(channel), ''), 'Unlabeled')"


class CleanupError(ValueError):
    pass


def clean_channels(raw) -> list[str]:
    """Exact show names, in the order given. Empty and oversized names drop out."""
    if not isinstance(raw, list):
        raise CleanupError("Choose at least one show.")
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        name = " ".join(str(item or "").split())
        if not name or len(name) > MAX_CHANNEL or name in seen:
            continue
        seen.add(name)
        out.append(name)
        if len(out) > MAX_SHOWS:
            raise CleanupError(f"Select at most {MAX_SHOWS} shows.")
    if not out:
        raise CleanupError("Choose at least one show.")
    return out


def shape_show(channel: str, episodes: int, nbytes: int) -> dict:
    return {
        "channel": channel,
        "episodes": int(episodes),
        "bytes": int(nbytes or 0),
    }
