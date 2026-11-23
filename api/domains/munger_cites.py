"""Pull Rule N lines out of a saved note.

Local notes cite with a full number, as in ``Rule 10`` and ``Rule 44``.
A one-digit capture would keep 4 and drop 44.
"""
from __future__ import annotations

import re

_CITE_RE = re.compile(r"Rule\s+(\d{1,2})\b[^\n]{0,320}", re.I)


def rule_citations(text: str) -> dict[int, str]:
    """First excerpt for each rule number from 1 to 50."""
    found: dict[int, str] = {}
    for match in _CITE_RE.finditer(text or ""):
        n = int(match.group(1))
        if 1 <= n <= 50 and n not in found:
            found[n] = " ".join(match.group(0).split())[:280]
    return found
