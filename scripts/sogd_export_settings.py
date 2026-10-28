#!/usr/bin/env python3
"""Read-only note: export the SOGD voice row and Railway env before a deploy.

This script does not change the database, Railway, or any voice/TTS constant.
Run it before deploying a podcast change.

    # 1. Voice row stored for the show (needs a logged-in GP cookie)
    curl -sS -H "Cookie: $DGA_COOKIE" \
      https://portfolio.dgacapital.com/api/podcast/systems-over-goals/voice

    # 2. SOGD_* env on the web service. Read only.
    railway variables --service web --kv | awk -F= '/^SOGD_/'

Code defaults below are the Oct 27 baseline (commit 39985ba, the last commit
that day). The server voice row and the SOGD_* env override them. Do not
reset those to the defaults.
"""
from __future__ import annotations

import json

from podcast_engine import (
    GAP_BEFORE_VERDICT,
    GAP_BETWEEN_SECTIONS,
    GAP_INTRA_SECTION,
    HITECH_INTRO_EXTRA_DB,
    INTENSITY_SPEED,
    SPEAKER_SPEED_OFFSET,
)
from podcast_sogd import SOGD_STYLE, cost_cap_usd, default_voice, schedule_clocks


def main() -> None:
    start, publish = schedule_clocks()
    print(json.dumps({
        "baseline_commit": "39985ba",
        "voice_endpoint": "GET /api/podcast/systems-over-goals/voice",
        "railway_env": "railway variables --service web --kv  # keep lines starting with SOGD_",
        "schedule": {"start_local": start, "publish_local": publish},
        "cost_cap_usd": cost_cap_usd(),
        "default_voice": default_voice("systems-over-goals"),
        "style": {key: value for key, value in SOGD_STYLE.items() if key != "prompt"},
        "hitech": {
            "INTENSITY_SPEED": INTENSITY_SPEED,
            "SPEAKER_SPEED_OFFSET": SPEAKER_SPEED_OFFSET,
            "GAP_INTRA_SECTION": GAP_INTRA_SECTION,
            "GAP_BETWEEN_SECTIONS": GAP_BETWEEN_SECTIONS,
            "GAP_BEFORE_VERDICT": GAP_BEFORE_VERDICT,
            "HITECH_INTRO_EXTRA_DB": HITECH_INTRO_EXTRA_DB,
        },
    }, indent=2, default=str))


if __name__ == "__main__":
    main()
