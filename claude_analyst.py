"""Backward-compatible alias for :mod:`DGA_analyst`.

Historically this module was Claude-only; the research core now routes Grok,
Claude, DeepSeek, and Kimi. Prefer::

    import DGA_analyst as analyst

This shim keeps old ``import claude_analyst`` paths working (podcast_engine,
ad-hoc scripts, docs bookmarks) without duplication.
"""
from __future__ import annotations

import sys

import DGA_analyst as _dga

# Present as the full module so ``import claude_analyst as x; x.analyze_ticker`` works.
sys.modules[__name__] = _dga
