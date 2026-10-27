"""Systems Over Goals Daily.

One orchestrator. The script check, disclaimer, stings, and loudnorm stay in
podcast_engine. This module ranks, guards, schedules, and records the run.
Network calls are lazy so tests can pass the stage functions in.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.request
from copy import deepcopy
from datetime import date, datetime, time as dt_time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SHOW_ID = "systems-over-goals"
DISCLOSURE = "This episode is AI-generated and AI-narrated."
LA = ZoneInfo("America/Los_Angeles")
CATEGORIES = ("politics", "world", "science", "markets")
ADVISORY_LOCK_KEY = 78126026
DROP_LIMIT = 0.30

# Prompt guard. The post-check scans the script, not this string.
LENS_GUARD = (
    "Write in the spirit of incentives, persuasion, and systems over goals: "
    "who benefits, what the incentives predict, which persuasion tactics are "
    "in play, and how a system behaves versus a stated goal. "
    "Never use that writer's name, voice, catchphrases, or likeness. "
    "The script must not contain the words Scott Adams, Dilbert, Dogbert, "
    "or pointy-haired."
)

BANNED_RE = re.compile(
    r"scott\s+adams|dilbert|dogbert|pointy[\s-]*haired",
    re.IGNORECASE,
)

# One style record for the writer prompt and the render targets.
SOGD_STYLE = {
    "stories_min": 4,
    "stories_max": 5,
    "word_min": 3700,
    "word_max": 4400,
    "voice": "kepler",
    "voice_rotation": False,
    "voice_pool": ("kepler", "ara", "rex", "eve", "sal"),
    "intros": (
        "Start with Good morning and the weekday, then the date and the show name, then two fresh sentences on how a story is told here, then one short paragraph per story.",
        "Start with one plain sentence on what kind of morning it is, then Good morning, the date, the show name, two sentences on how this works, then the topic preview.",
        "Start with a short question about the day, answer it in one line, then Good morning, the date, the show name, two sentences on how this works, then the topic preview.",
        "Start by naming the lead story in a single clause, then Good morning, the date, the show name, two sentences on how this works, then the topic preview.",
        "Start with the date said out loud, then Good morning and the show name, then two sentences on how this works that do not repeat a previous episode, then the topic preview.",
    ),
    "text_normalization": True,
    "pause": "[pause]",
    "long_pause": "[long-pause]",
    "breath_max": 2,
    "speed_min": 0.96,
    "speed_max": 1.02,
    "opening_speed": 0.97,
    "gap_within_story": (0.45, 1.1),
    "gap_recap": (1.0, 1.5),
    "gap_between_stories": (1.6, 2.2),
    "gap_preview": (1.2, 1.6),
    "pad_sec": 1.5,
    "highpass_hz": 70,
    "lufs": -16,
    "peak_dbtp": -1.5,
    "bitrate_kbps": 96,
    "channels": 1,
    "max_bytes": 25 * 1024 * 1024,
    "publish_local": "07:00",
    "prompt": "",
}


def style_prompt() -> str:
    """Writer instructions. Render numbers come from SOGD_STYLE."""
    s = SOGD_STYLE
    within = s["gap_within_story"]
    recap = s["gap_recap"]
    between = s["gap_between_stories"]
    preview = s["gap_preview"]
    return (
        "Morning-news feel. Topic pool: politics, Trump, markets and finance, AI, "
        "science, health and cancer research, world developments, war. "
        "Pick the most important real stories of the day from X trends and reliable outlets. "
        "Verify facts and dates, cite every claim, never invent facts. "
        f"{s['stories_min']}-{s['stories_max']} stories, gone into deeply, each drawing on 2-3 or more sources. "
        "No rapid-fire headline lists. "
        "Per story: what happened, then who says what, then the other side, then "
        "follow the money: who wins if you believe this, then so why does this matter to you, "
        "then a short recap, then what to watch next. "
        "Plain conversational language: short and varied sentences, contractions, "
        "concrete examples, rhetorical questions, signposting, the occasional casual aside. "
        "No academic jargon. "
        "Opening: Good morning, the date, the show name Systems Over Goals Daily, "
        "a loose two-sentence how this works, then a topic preview with one short paragraph per story. "
        "The opening shape changes with the date. Use the opening shape named for today. "
        "No AI disclosure at the top. "
        "Close: a short zoom-out on the day's pattern. "
        "The AI-narration disclosure and the not-investment-advice line go only at the close. "
        "Never name Scott Adams or Dilbert. "
        f"Length about {s['word_min']}-{s['word_max']} words. "
        f"Voice {s['voice']}, text normalization {'on' if s['text_normalization'] else 'off'}. "
        f"Use {s['pause']} and {s['long_pause']} freely. Put {s['long_pause']} before each new story. "
        f"Use [breath] at most {s['breath_max']} times, only at a natural inhale after a long sentence. "
        "Never mid-phrase, never right after a pause. "
        "Use <slow>, <emphasis>, and <soft> sparingly. No cough or sneeze. "
        f"Per-section speed {s['speed_min']}-{s['speed_max']} (opening {s['opening_speed']}). "
        "Render paragraph by paragraph, then join with silence: "
        f"{within[0]}-{within[1]} seconds within a story, "
        f"{recap[0]}-{recap[1]} seconds around recaps, "
        f"{between[0]}-{between[1]} seconds between stories, "
        f"{preview[0]}-{preview[1]} seconds between topic-preview items. "
        f"{s['pad_sec']} seconds of pad at the start and end. "
        f"Master: highpass {s['highpass_hz']} Hz, then gain, then a light peak limiter, "
        f"targeting {s['lufs']} LUFS integrated, peak <= {s['peak_dbtp']} dBTP, no heavy compression. "
        f"Output {s['bitrate_kbps']} kbps mono MP3, under 25 MB. "
        f"Publish at {s['publish_local']} America/Los_Angeles, never earlier."
    )


SOGD_STYLE["prompt"] = style_prompt()
SOGD_STYLE_GUIDE = SOGD_STYLE

PILOT_GUID = "11546341-0cb4-5cda-8267-26668ac6a3cc"
PILOT_BYTE_SIZE = 17158220
PILOT_MD5 = "82c27994586aba9c07fc543caa282a08"
PILOT_DURATION_SEC = 1430
PILOT_EPISODE_NUMBER = 1
PILOT_TITLE = "Systems Over Goals Daily — Oct 27, 2026: Iran's deal-or-strike moment (Pilot)"
PILOT_DESCRIPTION = (
    "Five stories, taken slowly: Trump's deal-or-strike decision on Iran, Israel's election, "
    "the Fed meeting a week before the midterms, Anthropic's IPO filing, and the Ebola outbreak "
    "plus new US travel rules. AI-narrated. Not investment advice. © DGA Capital."
)
PILOT_SHOW_NOTES = """AI-narrated. Five stories, each looked at from several sources. Sources below.

1. **Iran: deal or strike** — Japan Times/Bloomberg (https://www.japantimes.co.jp/news/2026/10/26/world/trump-iran-deal/), Al Jazeera (https://www.aljazeera.com/news/2026/10/27/irans-calculations-as-us-escalation-looms-trust-midterms-hormuz), CNBC (https://www.cnbc.com/2026/10/26/us-iran-war-hormuz.html), Anadolu morning briefing (https://www.aa.com.tr/en/world/morning-briefing-oct-27-2026/4101934), CNBC markets live (https://www.cnbc.com/2026/10/26/stock-market-today-live-updates.html), X: https://x.com/i/trending/2114808772992593941
2. **Israel votes** — Israel National News final polls (https://www.israelnationalnews.com/news/435074), CNN live (https://www.cnn.com/2026/10/27/world/live-news/israel-elections-live-results-latest-votes-intl), Jerusalem Post (https://www.jpost.com/israel-election-2026/article-912743), BBC (https://www.bbc.com/news), NYT (https://www.nytimes.com/2026/10/26/world/middleeast/netanyahu-iran-israel-election.html), Guardian (https://www.theguardian.com/world/2026/oct/26/netanyahu-reportedly-pressured-israel-military-attack-iran-runup-to-election), Axios (https://www.axios.com/2026/10/18/trump-endorses-netanyahu-israel-election-iran), Times of Israel (https://www.timesofisrael.com/liveblog_entry/we-have-to-finish-the-job-trump-doubles-down-on-netanyahu-endorsement-after-pm-reportedly-asked-for-another-expression-of-support/), X: https://x.com/i/trending/2114986755707249073
3. **The Fed, one week out** — CNBC Fed survey (https://www.cnbc.com/2026/10/27/federal-reserve-rate-hike-timing-expectations.html), CNBC Morning Squawk (https://www.cnbc.com/2026/10/27/tech-rally-fed-decision.html), Kiplinger live (https://www.kiplinger.com/investing/live/fed-meeting-updates-and-commentary-october-2026), WSJ week ahead (https://www.wsj.com/livecoverage/stock-market-today-dow-sp-500-nasdaq-10-27-2026/card/fed-meeting-more-tech-earnings-what-to-watch-this-week-ltvx7PE4Rg1OTiuEpCkx)
4. **Anthropic IPO** — Anthropic (https://www.anthropic.com/news/s1-sec), TechCrunch (https://techcrunch.com/2026/10/26/anthropic-officially-files-for-its-public-debut/), AP (https://apnews.com/article/anthropic-ipo-shares-public-ca2f4c282bef3201a392e59e3df2300c), WSJ (https://www.wsj.com/livecoverage/stock-market-today-dow-sp-500-nasdaq-10-26-2026/card/QRAF03nzBzqhOLglAJbQ), CNBC live (https://www.cnbc.com/2026/10/26/stock-market-today-live-updates.html)
5. **Ebola** — ECDC (https://www.ecdc.europa.eu/en/ebola-disease-multi-country-outbreak-2026), CDC (https://www.cdc.gov/ebola/situation-summary/returning-travelers.html), AP (https://apnews.com/article/uganda-ebola-quarantine-congo-border-controls-outbreak-86561d00f73410febe41e44041105a86), Daily Monitor (https://www.monitor.co.ug/uganda/news/national/uganda-imposes-mandatory-21-day-drc-quarantine-as-regional-ebola-threat-expands-5645034), Uganda Media Centre (https://www.mediacentre.go.ug/press-room/health-minister-updates-public-on-progress-in-national-ebola-preparedness-and-response-efforts), X: https://x.com/i/trending/2114779246501433625
- **Wrap: Oleshky ceasefire** — White House (https://www.whitehouse.gov/briefings-statements/2026/10/first-lady-melania-trump-secures-ceasefire-between-russia-and-ukraine-localized-to-oleshky/), Kyiv Independent (https://kyivindependent.com/local-ceasefire-in-besieged-oleshky-begins-ukrainian-russian-officials-say/), DW, AP

Not investment advice. © DGA Capital.
"""
PILOT_DATE = date(2026, 10, 27)
PILOT_PUBLISHED_AT = datetime(2026, 10, 27, 14, 0, tzinfo=timezone.utc)
PILOT_FILENAME = "systems-over-goals-daily_pilot_2026-10-27_v4_kepler.mp3"

PRICING = {
    "grok_input_usd_per_mtok": 2.0,
    "grok_output_usd_per_mtok": 6.0,
    "x_search_usd_per_call": 0.025,
    "xai_tts_usd_per_mchar": 15.0,
    "openai_tts_usd_per_mchar": 0.60,
    "kokoro_tts_usd_per_mchar": 0.0,
}

RSS_FEEDS = (
    {"id": "ap-world", "url": "https://feeds.apnews.com/rss/apf-intlnews", "category": "world"},
    {"id": "reuters-world", "url": "https://feeds.reuters.com/Reuters/worldNews", "category": "world"},
    {"id": "npr-politics", "url": "https://feeds.npr.org/1014/rss.xml", "category": "politics"},
    {"id": "sciencedaily", "url": "https://www.sciencedaily.com/rss/all.xml", "category": "science"},
    {"id": "nature-news", "url": "https://www.nature.com/nature.rss", "category": "science"},
    {"id": "cnbc-markets", "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", "category": "markets"},
    {"id": "marketwatch", "url": "https://feeds.marketwatch.com/marketwatch/topstories/", "category": "markets"},
)

SCHEMA_STATEMENTS = (
    "ALTER TABLE analyst_podcast_episodes ADD COLUMN IF NOT EXISTS episode_date DATE",
    "ALTER TABLE analyst_podcast_episodes ADD COLUMN IF NOT EXISTS status TEXT",
    "ALTER TABLE analyst_podcast_episodes ADD COLUMN IF NOT EXISTS transcript TEXT",
    "ALTER TABLE analyst_podcast_episodes ADD COLUMN IF NOT EXISTS show_notes TEXT",
    "ALTER TABLE analyst_podcast_episodes ADD COLUMN IF NOT EXISTS summary TEXT",
    "ALTER TABLE analyst_podcast_episodes ADD COLUMN IF NOT EXISTS episode_number INTEGER",
    """
    CREATE UNIQUE INDEX IF NOT EXISTS analyst_podcast_episodes_show_date
        ON analyst_podcast_episodes (show, episode_date)
        WHERE episode_date IS NOT NULL
    """,
    """
    CREATE TABLE IF NOT EXISTS podcast_runs (
        id                 BIGSERIAL PRIMARY KEY,
        show               TEXT NOT NULL,
        episode_date       DATE,
        started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at        TIMESTAMPTZ,
        status             TEXT,
        stage              TEXT,
        error              TEXT,
        llm_input_tokens   INTEGER,
        llm_output_tokens  INTEGER,
        x_search_calls     INTEGER,
        tts_chars          INTEGER,
        cost_usd_by_stage  JSONB,
        cost_usd_total     REAL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS podcast_runs_show_started
        ON podcast_runs (show, started_at DESC)
    """,
)

FEED_VISIBILITY_SQL = (
    "(status IS NULL OR status = 'published') "
    "AND (published_at IS NULL OR published_at <= NOW())"
)


class CostCapHit(RuntimeError):
    def __init__(self, stage: str, spend: float):
        super().__init__(f"monthly cost cap hit at {stage} (${spend:.2f})")
        self.stage = stage
        self.spend = spend


def word_bounds() -> tuple[int, int]:
    try:
        lo = int(os.environ.get("SOGD_WORD_MIN") or SOGD_STYLE["word_min"])
    except ValueError:
        lo = int(SOGD_STYLE["word_min"])
    try:
        hi = int(os.environ.get("SOGD_WORD_MAX") or SOGD_STYLE["word_max"])
    except ValueError:
        hi = int(SOGD_STYLE["word_max"])
    if hi < lo:
        hi = lo
    return lo, hi


def schedule_clocks() -> tuple[str, str]:
    start = (os.environ.get("SOGD_START_LOCAL") or "06:35").strip() or "06:35"
    publish = (os.environ.get("SOGD_PUBLISH_LOCAL") or SOGD_STYLE["publish_local"]).strip() or "07:00"
    return start, publish


def cost_cap_usd() -> float:
    try:
        return float(os.environ.get("SOGD_COST_CAP_USD") or 40)
    except ValueError:
        return 40.0


def auto_publish_default() -> bool:
    raw = (os.environ.get("SOGD_AUTO_PUBLISH") or "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def pronunciation_map() -> dict:
    raw = (os.environ.get("SOGD_PRONUNCIATIONS") or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def default_voice(show_id: str = SHOW_ID) -> dict:
    if show_id == SHOW_ID:
        return {"provider": "xai", "voice": "kepler", "speed": 1.0}
    return {"provider": "xai", "voice": "leo", "speed": 1.0}


def normalize_voice(raw, show_id: str = SHOW_ID) -> dict:
    base = default_voice(show_id)
    if not isinstance(raw, dict):
        return dict(base)
    provider = str(raw.get("provider") or base["provider"]).strip().lower()
    if provider == "openai":
        provider = "xai"
    if provider not in ("xai", "kokoro"):
        provider = base["provider"]
    voice = str(raw.get("voice") or base["voice"]).strip().lower() or base["voice"]
    if provider == "xai":
        from podcast_tts import XAI_VOICES
        if voice not in XAI_VOICES:
            voice = base["voice"] if base["provider"] == "xai" else "kepler"
    try:
        speed = float(base["speed"] if raw.get("speed") is None else raw.get("speed"))
    except (TypeError, ValueError):
        speed = float(base["speed"])
    speed = max(0.7, min(1.5, speed))
    out = {"provider": provider, "voice": voice, "speed": speed}
    if "rotate" in raw:
        out["rotate"] = bool(raw.get("rotate"))
    return out


def intro_for_date(episode_date: date | datetime) -> str:
    """One opening shape per date. The next day uses a different shape."""
    day = episode_date.date() if isinstance(episode_date, datetime) else episode_date
    intros = SOGD_STYLE["intros"]
    return intros[day.toordinal() % len(intros)]


def voice_for_day(saved, episode_date: date | datetime, *, rotate: bool | None = None) -> dict:
    """Keep the saved voice unless rotation is on. Rotation is off unless asked."""
    voice = normalize_voice(saved)
    day = episode_date.date() if isinstance(episode_date, datetime) else episode_date
    enabled = bool(voice.get("rotate")) if rotate is None else bool(rotate)
    if not enabled:
        return voice
    from podcast_tts import XAI_VOICES
    pool = [name for name in SOGD_STYLE["voice_pool"] if name in XAI_VOICES]
    if not pool:
        return voice
    picked = dict(voice)
    picked["voice"] = pool[day.toordinal() % len(pool)]
    picked["rotate"] = True
    return picked


def llm_cost(input_tokens: int = 0, output_tokens: int = 0, x_search_calls: int = 0) -> float:
    return (
        int(input_tokens or 0) / 1_000_000 * PRICING["grok_input_usd_per_mtok"]
        + int(output_tokens or 0) / 1_000_000 * PRICING["grok_output_usd_per_mtok"]
        + int(x_search_calls or 0) * PRICING["x_search_usd_per_call"]
    )


def tts_cost(chars: int, provider: str) -> float:
    rate = {
        "xai": PRICING["xai_tts_usd_per_mchar"],
        "openai": PRICING["openai_tts_usd_per_mchar"],
        "kokoro": PRICING["kokoro_tts_usd_per_mchar"],
    }.get((provider or "xai").lower(), PRICING["xai_tts_usd_per_mchar"])
    return int(chars or 0) / 1_000_000 * rate


def _parse_hhmm(value: str) -> dt_time:
    hour, minute = (value or "00:00").split(":", 1)
    return dt_time(int(hour), int(minute))


def clock_on(day: date, hhmm: str, tz=LA) -> datetime:
    stamp = _parse_hhmm(hhmm)
    return datetime(day.year, day.month, day.day, stamp.hour, stamp.minute, tzinfo=tz)


def _as_local(value, tz=LA) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(tz)


def _secs_until(target: datetime, now: datetime) -> float:
    return max(0.0, (target - now).total_seconds())


def plan_tick(
    now: datetime,
    episode: dict | None,
    *,
    start_local: str = "06:35",
    publish_local: str = "07:00",
    auto_publish: bool = True,
    tz=LA,
) -> dict:
    """What the one scheduler thread should do on this wake."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    local = now.astimezone(tz)
    start_at = clock_on(local.date(), start_local, tz)
    publish_at = clock_on(local.date(), publish_local, tz)
    next_start = start_at if local < start_at else start_at + timedelta(days=1)
    status = ((episode or {}).get("status") or "").strip().lower()

    if status == "ready_pending":
        if not auto_publish:
            return {
                "action": "sleep",
                "sleep_sec": _secs_until(next_start, local),
                "reason": "manual_publish",
            }
        due = _as_local((episode or {}).get("published_at"), tz) or publish_at
        if local >= due:
            return {"action": "release", "sleep_sec": 0, "reason": "publish"}
        return {"action": "sleep", "sleep_sec": _secs_until(due, local), "reason": "hold"}

    if status in ("published", "cost_cap_hit"):
        return {
            "action": "sleep",
            "sleep_sec": _secs_until(next_start, local),
            "reason": status,
        }

    if status == "running":
        started = _as_local((episode or {}).get("started_at"), tz)
        age = (local - started).total_seconds() if started is not None else 0
        if started is not None and age < 3 * 3600:
            return {"action": "sleep", "sleep_sec": 60, "reason": "in_progress"}

    # Missing, failed, or a stale run: catch up only after the start clock.
    if local < start_at:
        return {"action": "sleep", "sleep_sec": _secs_until(start_at, local), "reason": "before_start"}
    return {"action": "generate", "sleep_sec": 0, "reason": "due"}


def publish_decision(finished_at: datetime, publish_at: datetime, *, auto_publish: bool = True) -> dict:
    if finished_at.tzinfo is None:
        finished_at = finished_at.replace(tzinfo=timezone.utc)
    if publish_at.tzinfo is None:
        publish_at = publish_at.replace(tzinfo=timezone.utc)
    when = publish_at if finished_at < publish_at else finished_at
    if not auto_publish or finished_at < publish_at:
        return {"status": "ready_pending", "published_at": when if not auto_publish else publish_at}
    return {"status": "published", "published_at": finished_at}


def manual_release(now: datetime, publish_at: datetime) -> dict:
    """A button press still waits for 7:00 AM Pacific."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    if publish_at.tzinfo is None:
        publish_at = publish_at.replace(tzinfo=timezone.utc)
    if now < publish_at:
        return {"status": "ready_pending", "published_at": publish_at}
    return {"status": "published", "published_at": now}


def date_guard(existing: dict | None, *, force: bool = False, now: datetime | None = None,
               stale_after_sec: int = 3 * 3600, lock_held: bool = False) -> dict:
    if not existing:
        return {"ok": True}
    status = (existing.get("status") or "published").strip().lower()
    if force:
        return {"ok": True, "replaced": True}
    if status in ("failed", "cost_cap_hit"):
        return {"ok": True, "retry": status == "failed"}
    if status == "running":
        # The caller already holds the daily lock, so this row's worker is gone.
        if lock_held:
            return {"ok": True, "retry": True}
        started = _as_local(existing.get("started_at"), timezone.utc)
        clock = now or datetime.now(timezone.utc)
        if clock.tzinfo is None:
            clock = clock.replace(tzinfo=timezone.utc)
        if started is not None and (clock - started).total_seconds() >= stale_after_sec:
            return {"ok": True, "retry": True}
        return {"ok": False, "reason": "in_progress"}
    return {"ok": False, "reason": "episode_exists"}


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _similar(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / len(ta | tb) >= 0.8


def dedupe_stories(items: list[dict]) -> list[dict]:
    kept: list[dict] = []
    seen_urls: set[str] = set()
    for item in items or []:
        url = (item.get("url") or "").strip()
        title = (item.get("title") or "").strip()
        if not url or not title:
            continue
        key = url.split("?")[0].rstrip("/").lower()
        if key in seen_urls:
            continue
        if any(_similar(title, prev.get("title") or "") for prev in kept):
            continue
        seen_urls.add(key)
        kept.append(item)
    return kept


def rank_stories(items: list[dict], *, limit_min: int = 5, limit_max: int = 8,
                 min_categories: int = 3) -> dict:
    cleaned = []
    for item in dedupe_stories(items):
        cat = (item.get("category") or "").strip().lower()
        if cat not in CATEGORIES:
            continue
        if not (item.get("url") or "").strip():
            continue
        cleaned.append({**item, "category": cat})
    picked: list[dict] = []
    for cat in CATEGORIES:
        for item in cleaned:
            if item["category"] == cat and item not in picked:
                picked.append(item)
                break
    for item in cleaned:
        if len(picked) >= limit_max:
            break
        if item not in picked:
            picked.append(item)
    picked = picked[:limit_max]
    cats = {item["category"] for item in picked}
    if len(picked) < limit_min or len(cats) < min_categories:
        return {
            "ok": False,
            "stories": picked,
            "error": f"need {limit_min}-{limit_max} stories across {min_categories} categories, got {len(picked)} / {len(cats)}",
        }
    return {"ok": True, "stories": picked}


def likeness_hits(text: str) -> list[str]:
    return BANNED_RE.findall(text or "")


def script_text(script: dict) -> str:
    parts = []
    for sec in (script or {}).get("sections") or []:
        for turn in sec.get("turns") or []:
            parts.append(turn.get("text") or "")
    return "\n".join(parts)


def guard_script(script: dict) -> dict:
    hits = likeness_hits(script_text(script))
    return {"ok": not hits, "hits": hits}


def _section_text(section: dict) -> str:
    return " ".join((turn.get("text") or "") for turn in section.get("turns") or [])


def _replace_section(script: dict, section_id: str, updated: dict) -> None:
    for i, sec in enumerate(script.get("sections") or []):
        if sec.get("id") == section_id:
            script["sections"][i] = updated
            return


def enforce_word_budget(
    script: dict,
    *,
    word_count,
    regenerate_section,
    trim_section,
    word_min: int = 3800,
    word_max: int = 4300,
) -> dict:
    """Regenerate only short sections. Trim only long ones. Uses _word_count."""
    script = deepcopy(script)
    notes = []
    for _ in range(6):
        total = int(word_count(script_text(script)))
        if word_min <= total <= word_max:
            return {"ok": True, "script": script, "words": total, "notes": notes}
        sections = script.get("sections") or []
        if not sections:
            break
        if total < word_min:
            short = min(sections, key=lambda sec: word_count(_section_text(sec)))
            updated = regenerate_section(deepcopy(short), word_min - total)
            _replace_section(script, short.get("id"), updated)
            notes.append({"action": "regenerate", "id": short.get("id")})
        else:
            long = max(sections, key=lambda sec: word_count(_section_text(sec)))
            updated = trim_section(deepcopy(long), total - word_max)
            _replace_section(script, long.get("id"), updated)
            notes.append({"action": "trim", "id": long.get("id")})
    total = int(word_count(script_text(script)))
    return {"ok": word_min <= total <= word_max, "script": script, "words": total, "notes": notes}


def trim_section_words(section: dict, extra: int) -> dict:
    section = deepcopy(section)
    remaining = max(0, int(extra))
    for turn in reversed(section.get("turns") or []):
        if remaining <= 0:
            break
        tokens = re.findall(r"\b[\w']+\b", turn.get("text") or "")
        if len(tokens) <= 1:
            continue
        cut = min(remaining, len(tokens) - 1)
        turn["text"] = " ".join(tokens[: len(tokens) - cut])
        remaining -= cut
    return section


def ensure_disclosure(script: dict) -> dict:
    """Keep the AI line on the close. The cold open stays a good morning."""
    script = deepcopy(script)
    sections = script.setdefault("sections", [])
    for sec in sections:
        if sec.get("id") != "cold_open":
            continue
        turns = sec.get("turns") or []
        if turns:
            text = turns[0].get("text") or ""
            if text.startswith(DISCLOSURE):
                rest = text[len(DISCLOSURE):].lstrip(" .")
                if rest:
                    turns[0]["text"] = rest
        break
    if not sections:
        sections.append({
            "id": "close",
            "turns": [{"speaker": "kimi", "intensity": "normal", "text": DISCLOSURE}],
        })
        return script
    if DISCLOSURE in script_text(script):
        return script
    last = sections[-1]
    turns = last.setdefault("turns", [])
    turns.append({"speaker": "kimi", "intensity": "normal", "text": DISCLOSURE})
    return script


_ABBREV_RE = re.compile(
    r"\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Gen|Sen|Rep|Gov|Inc|Ltd|Corp|Co|No|vs|Fig|"
    r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.",
    re.IGNORECASE,
)


def split_sentences(text: str) -> list[str]:
    """Split on sentence ends. Keep decimals and dotted names in one sentence."""
    raw = (text or "").strip()
    if not raw:
        return []
    shielded = re.sub(r"(?<=\d)\.(?=\d)", "∯", raw)
    shielded = _ABBREV_RE.sub(lambda match: match.group(0).replace(".", "∯"), shielded)
    shielded = re.sub(r"\b(?:[A-Z]\.){2,}", lambda match: match.group(0).replace(".", "∯"), shielded)
    out = []
    for part in re.split(r"(?<=[.!?])\s+", shielded):
        sentence = part.replace("∯", ".").strip()
        if sentence:
            out.append(sentence)
    return out


def extract_claims(script: dict) -> list[dict]:
    claims = []
    n = 0
    for sec in script.get("sections") or []:
        for turn in sec.get("turns") or []:
            for sent in split_sentences(turn.get("text") or ""):
                n += 1
                claims.append({
                    "id": f"c{n}",
                    "text": sent,
                    "section_id": sec.get("id"),
                    "sourced": not sent.lower().startswith("[unsourced]"),
                })
    return claims


def apply_fact_check(script: dict, claims: list[dict], verdicts: dict) -> dict:
    dropped = []
    for claim in claims:
        verdict = verdicts.get(claim["id"]) or {}
        keep = bool(claim.get("sourced", True)) and bool(verdict.get("keep", True))
        if not claim.get("sourced", True):
            keep = False
        if keep:
            continue
        dropped.append(claim)
    ratio = len(dropped) / max(1, len(claims))
    script = deepcopy(script)
    for claim in dropped:
        piece = claim.get("text") or ""
        if not piece:
            continue
        for sec in script.get("sections") or []:
            for turn in sec.get("turns") or []:
                text = turn.get("text") or ""
                if piece in text:
                    turn["text"] = re.sub(r"\s+", " ", text.replace(piece, "")).strip()
    return {"ok": ratio <= DROP_LIMIT, "script": script, "dropped": dropped, "drop_ratio": ratio}


def pick_fact_checker(ollama_ok: bool) -> str:
    return "ollama" if ollama_ok else "grok"


def judge_claims(claims, stories, *, ollama_ok: bool, ollama_fn, grok_fn) -> dict:
    """Ollama gemma4 when it is up. Any failure falls through to Grok."""
    def pack(provider: str, raw, **extra) -> dict:
        verdicts, usage = _as_verdicts(raw)
        out = {"provider": provider, "verdicts": verdicts, "usage": usage}
        out.update(extra)
        return out

    if ollama_ok:
        try:
            return pack("ollama", ollama_fn(claims, stories))
        except Exception:
            return pack("grok", grok_fn(claims, stories), fallback=True)
    return pack("grok", grok_fn(claims, stories))


def episode_title(episode_date: date, lead: str) -> str:
    stamp = f"{episode_date.strftime('%b')} {episode_date.day}, {episode_date.year}"
    lead = re.sub(r"\s+", " ", (lead or "Daily briefing").strip())
    return f"SOGD — {stamp}: {lead}"


def show_notes(stories: list[dict]) -> str:
    lines = []
    for story in stories or []:
        title = (story.get("title") or "Story").strip()
        url = (story.get("url") or "").strip()
        lines.append(f"- {title} ({url})")
    return "\n".join(lines)


def titles_from_notes(notes: str) -> list[str]:
    """Topic titles from show notes. The player and the chapter file share this list."""
    found = []
    for match in re.finditer(r"\*\*([^*]+)\*\*", notes or ""):
        title = re.sub(r"^Wrap:\s*", "", match.group(1).strip())
        if title:
            found.append(title)
    if not found:
        for line in (notes or "").splitlines():
            parsed = re.match(r"-\s+(.+?)\s+\(https?://", line.strip())
            if parsed:
                found.append(parsed.group(1).strip())
    if not found:
        return []
    if found[0].lower() != "opening":
        found.insert(0, "Opening")
    return found


def chapter_list(titles: list[str], duration_sec, urls: list[str] | None = None) -> list[dict]:
    """Even slices across the episode. The first chapter always starts at 0."""
    clean = [title.strip() for title in titles if (title or "").strip()]
    if not clean:
        return []
    try:
        duration = max(0.0, float(duration_sec or 0))
    except (TypeError, ValueError):
        duration = 0.0
    count = len(clean)
    chapters = []
    for index, title in enumerate(clean):
        start = 0.0 if index == 0 or duration <= 0 else round(duration * index / count, 3)
        row = {"startTime": start, "title": title}
        url = (urls[index] if urls and index < len(urls) else "") or ""
        if url:
            row["url"] = url
        chapters.append(row)
    return chapters


def chapters_from_stories(stories: list[dict], duration_sec) -> list[dict]:
    titles = ["Opening"]
    urls = [""]
    for story in stories or []:
        titles.append((story.get("title") or "Story").strip())
        urls.append((story.get("url") or "").strip())
    titles.append("Close")
    urls.append("")
    return chapter_list(titles, duration_sec, urls)


def resolve_chapters(notes: str, duration_sec, stored=None) -> list[dict]:
    """Stored chapter times win. Otherwise the titles come from the show notes."""
    if isinstance(stored, list) and stored:
        rows = []
        for item in stored:
            if not isinstance(item, dict) or item.get("title") in (None, ""):
                continue
            try:
                start = float(item.get("startTime") or 0)
            except (TypeError, ValueError):
                start = 0.0
            row = {"startTime": start, "title": str(item.get("title"))}
            if item.get("url"):
                row["url"] = str(item["url"])
            rows.append(row)
        if rows:
            rows[0]["startTime"] = 0.0
            return rows
    return chapter_list(titles_from_notes(notes), duration_sec)


def chapters_document(chapters: list[dict]) -> dict:
    return {"version": "1.2.0", "chapters": chapters}


def _script_payload(result: dict) -> dict:
    payload = dict(result.get("script") or {})
    if result.get("chapters"):
        payload["chapters"] = result["chapters"]
    return payload


def _json_obj(text: str) -> dict:
    raw = (text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end <= start:
            return {}
        try:
            data = json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            return {}
    return data if isinstance(data, dict) else {}


def _sum_usage(events: list[dict] | None) -> dict:
    total = {"input_tokens": 0, "output_tokens": 0, "x_search_calls": 0, "cost_usd": 0.0}
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        inp = int(ev.get("input_tokens") or 0)
        out = int(ev.get("output_tokens") or 0)
        calls = int(ev.get("x_search_calls") or ev.get("live_search_calls") or 0)
        total["input_tokens"] += inp
        total["output_tokens"] += out
        total["x_search_calls"] += calls
        if ev.get("cost_usd") is not None:
            total["cost_usd"] += float(ev["cost_usd"])
        else:
            total["cost_usd"] += llm_cost(inp, out, calls)
    total["cost_usd"] = round(total["cost_usd"], 6)
    return total


def parse_rss_items(xml_bytes: bytes, category: str, limit: int = 8) -> list[dict]:
    import xml.etree.ElementTree as ET
    root = ET.fromstring(xml_bytes)
    items = []
    for node in root.iter("item"):
        title = (node.findtext("title") or "").strip()
        link = (node.findtext("link") or "").strip()
        if title and link:
            items.append({"title": title, "url": link, "category": category, "source": "rss"})
        if len(items) >= limit:
            break
    return items


def fetch_rss_backup(opener=None) -> list[dict]:
    opener = opener or urllib.request.urlopen
    found = []
    for feed in RSS_FEEDS:
        try:
            req = urllib.request.Request(feed["url"], headers={"User-Agent": "DGA-sogd"})
            with opener(req, timeout=8) as resp:
                data = resp.read(400_000)
            found.extend(parse_rss_items(data, feed["category"]))
        except Exception as exc:
            print(f"[sogd] rss {feed['id']} skipped: {exc!s:.120}", flush=True)
    return found


def _stories_from_model(text: str) -> list[dict]:
    data = _json_obj(text)
    rows = data.get("stories") or []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        cat = str(row.get("category") or "").strip().lower()
        url = str(row.get("url") or "").strip()
        title = str(row.get("title") or "").strip()
        if cat in CATEGORIES and url and title:
            out.append({
                "title": title,
                "url": url,
                "category": cat,
                "summary": str(row.get("summary") or "").strip(),
                "source": "grok",
            })
    return out


def ollama_reachable() -> bool:
    try:
        import importlib.util
        from pathlib import Path
        path = Path(__file__).resolve().parent / "scripts" / "ollama_desk.py"
        spec = importlib.util.spec_from_file_location("ollama_desk_sogd", path)
        if spec is None or spec.loader is None:
            return False
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return bool(mod.serve_ok())
    except Exception:
        return False


def _call_grok(system: str, user: str, *, live_search: bool = False, search_from_date: str | None = None) -> tuple[str, dict]:
    import DGA_analyst as ca
    events: list[dict] = []
    text = ca.call_grok(
        system,
        user,
        live_search=live_search,
        search_from_date=search_from_date,
        usage_capture=events.append,
    )
    return text or "", _sum_usage(events)


def live_scout(episode_date: date) -> dict:
    since = (episode_date - timedelta(days=1)).isoformat()
    text, usage = _call_grok(
        "You are a news desk. Return JSON only: "
        '{"stories":[{"title":"","url":"","category":"politics|world|science|markets","summary":""}]}. '
        "Cover the last 18 hours. Every story needs a real source URL. " + LENS_GUARD,
        f"What is breaking as of {episode_date.isoformat()}? "
        "Find stories across politics, world, science, and markets.",
        live_search=True,
        search_from_date=since,
    )
    stories = _stories_from_model(text)
    stories.extend(fetch_rss_backup())
    return {"stories": stories, "usage": usage}


def live_lens(stories: list[dict]) -> dict:
    text, usage = _call_grok(
        "Return JSON only: {\"notes\":[{\"title\":\"\",\"who_benefits\":\"\",\"incentives\":\"\",\"persuasion\":\"\",\"systems\":\"\"}]}. "
        + LENS_GUARD,
        json.dumps({"stories": stories}),
    )
    data = _json_obj(text)
    return {"notes": data.get("notes") or [], "usage": usage}


def _assemble(episode_date: date, lead: str, sections: list[dict]) -> dict:
    built = []
    for sec in sections:
        built.append({
            "id": sec.get("id"),
            "turns": [{
                "speaker": "kimi",
                "intensity": "normal",
                "text": (sec.get("text") or "").strip(),
            }],
        })
    return {
        "ticker": "SOGD",
        "format": "sogd",
        "episode_title": episode_title(episode_date, lead),
        "winner": "kimi",
        "sections": built,
    }


def live_writer(stories: list[dict], lenses, episode_date: date, *, word_min: int, word_max: int) -> dict:
    text, usage = _call_grok(
        "Return JSON only: {\"sections\":[{\"id\":\"\",\"text\":\"\"}]}. "
        "Sections in order: cold_open, story_1..story_N, close. "
        f"Total between {word_min} and {word_max} words. "
        "Every number, date, quote, and who-did-what must come from the stories. "
        "Do not invent those. "
        + f"Today's opening shape: {intro_for_date(episode_date)} "
        + SOGD_STYLE["prompt"] + " "
        + LENS_GUARD,
        json.dumps({"date": episode_date.isoformat(), "stories": stories, "lens": lenses}),
    )
    data = _json_obj(text)
    lead = (stories[0].get("title") if stories else "") or "Daily briefing"
    script = _assemble(episode_date, lead, data.get("sections") or [])
    return {"script": script, "usage": usage}


def live_expand(section: dict, need: int) -> dict:
    text, usage = _call_grok(
        "Return JSON only: {\"text\":\"\"}. Keep the same facts. Add about "
        f"{need} words. " + LENS_GUARD,
        _section_text(section),
    )
    data = _json_obj(text)
    updated = deepcopy(section)
    extra = (data.get("text") or "").strip()
    if extra and updated.get("turns"):
        updated["turns"][0]["text"] = (updated["turns"][0].get("text") or "") + " " + extra
    updated["_usage"] = usage
    return updated


FACT_CHUNK = 40
FACT_INSTRUCTION = (
    "Return JSON only: {\"verdicts\":[{\"id\":\"\",\"keep\":true}]}. "
    "Set keep to false only when the sentence states a concrete fact "
    "(a number, a date, a quote, or a specific who-did-what) that the sources "
    "do not support or that they contradict. "
    "Keep the disclosure, transitions, and analysis of incentives or systems "
    "that does not add a new fact. When unsure, keep is true."
)


def _keep_flag(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "keep")
    return bool(value)


def _source_brief(stories) -> list[dict]:
    brief = []
    for story in stories or []:
        if not isinstance(story, dict):
            continue
        brief.append({
            "title": story.get("title") or "",
            "url": story.get("url") or "",
            "summary": str(story.get("summary") or "")[:500],
        })
    return brief


def _verdict_map(text: str) -> dict:
    data = _json_obj(text)
    rows = data.get("verdicts") or []
    out = {}
    if isinstance(rows, dict):
        for key, value in rows.items():
            if isinstance(value, dict):
                out[str(key)] = {"keep": _keep_flag(value.get("keep", False))}
            else:
                out[str(key)] = {"keep": _keep_flag(value)}
        return out
    for row in rows:
        if isinstance(row, dict) and row.get("id"):
            out[str(row["id"])] = {"keep": _keep_flag(row.get("keep", False))}
    return out


def _as_verdicts(raw) -> tuple[dict, dict]:
    if isinstance(raw, dict) and "verdicts" in raw:
        verdicts = raw.get("verdicts") or {}
        if not isinstance(verdicts, dict):
            verdicts = {}
        usage = raw.get("usage") if isinstance(raw.get("usage"), dict) else {}
        return verdicts, usage
    if isinstance(raw, dict):
        return raw, {}
    return {}, {}


def _chunked_verdicts(claims, stories, ask) -> dict:
    merged: dict = {}
    usage = {"input_tokens": 0, "output_tokens": 0, "x_search_calls": 0, "cost_usd": 0.0}
    rows = list(claims or [])
    for start in range(0, max(1, len(rows)), FACT_CHUNK):
        if not rows:
            break
        part = ask(rows[start:start + FACT_CHUNK])
        verdicts, part_usage = _as_verdicts(part)
        merged.update(verdicts or {})
        summed = _sum_usage([part_usage])
        usage["input_tokens"] += summed["input_tokens"]
        usage["output_tokens"] += summed["output_tokens"]
        usage["x_search_calls"] += summed["x_search_calls"]
        usage["cost_usd"] += summed["cost_usd"]
    usage["cost_usd"] = round(usage["cost_usd"], 6)
    return {"verdicts": merged, "usage": usage}


def live_grok_verdicts(claims, stories) -> dict:
    def ask(chunk):
        text, usage = _call_grok(
            FACT_INSTRUCTION,
            json.dumps({"claims": chunk, "sources": _source_brief(stories)}),
        )
        return {"verdicts": _verdict_map(text), "usage": usage}
    return _chunked_verdicts(claims, stories, ask)


def live_ollama_verdicts(claims, stories) -> dict:
    def ask(chunk):
        prompt = FACT_INSTRUCTION + "\n" + json.dumps({
            "claims": chunk,
            "sources": _source_brief(stories),
        })
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/generate",
            data=json.dumps({"model": "gemma4", "prompt": prompt, "stream": False}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return _verdict_map(payload.get("response") or "")
    return _chunked_verdicts(claims, stories, ask)


def live_repair_script(script, dropped, stories, episode_date: date) -> dict:
    """One rewrite when the checker rejects too much of the episode."""
    sections = []
    for sec in (script or {}).get("sections") or []:
        sections.append({"id": sec.get("id"), "text": _section_text(sec)})
    text, usage = _call_grok(
        "Return JSON only: {\"sections\":[{\"id\":\"\",\"text\":\"\"}]}. "
        "Rewrite the script without the dropped sentences. "
        "Replace the lost length with incentive and systems analysis grounded in the sources. "
        "Do not add a number, date, quote, or who-did-what that is not in the sources. "
        + f"Today's opening shape: {intro_for_date(episode_date)} "
        + SOGD_STYLE["prompt"] + " "
        + LENS_GUARD,
        json.dumps({
            "sections": sections,
            "dropped": [claim.get("text") for claim in (dropped or [])],
            "sources": _source_brief(stories),
        }),
    )
    data = _json_obj(text)
    got = data.get("sections") or []
    if not got:
        return {"script": script, "usage": usage}
    lead = ""
    if stories:
        lead = (stories[0].get("title") or "").strip()
    lead = lead or (script or {}).get("episode_title") or "Daily briefing"
    rebuilt = _assemble(episode_date, lead, got)
    if (script or {}).get("episode_title"):
        rebuilt["episode_title"] = script["episode_title"]
    return {"script": rebuilt, "usage": usage}


def master_sogd_mp3(path: Path) -> bool:
    """Highpass, then a light peak limiter, then 96 kbps mono. HiTech loudnorm stays put."""
    import shutil
    import subprocess
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not path.is_file():
        return False
    style = SOGD_STYLE
    limit = 10 ** (float(style["peak_dbtp"]) / 20)
    af = (
        f"highpass=f={int(style['highpass_hz'])},"
        f"alimiter=limit={limit:.4f}:level=false:asc=true"
    )
    dest = path.with_suffix(".master.mp3")
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-i", str(path),
        "-af", af,
        "-ac", str(int(style["channels"])),
        "-ar", "44100",
        "-codec:a", "libmp3lame",
        "-b:a", f"{int(style['bitrate_kbps'])}k",
        str(dest),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except (subprocess.CalledProcessError, OSError):
        return False
    if not dest.is_file() or dest.stat().st_size <= 0:
        return False
    if dest.stat().st_size > int(style["max_bytes"]):
        dest.unlink(missing_ok=True)
        return False
    dest.replace(path)
    return True


def _synthesize_engine(script, voice, pronunciation, on_progress) -> dict:
    import tempfile
    from podcast_engine import synthesize_episode
    out = Path(tempfile.mkdtemp(prefix="sogd-")) / "episode.mp3"
    syn = synthesize_episode(
        script,
        out_path=out,
        tts_provider=voice.get("provider"),
        voice_override=voice.get("voice") or SOGD_STYLE["voice"],
        speed_override=voice.get("speed") or 1.0,
        pronunciation=pronunciation,
        on_progress=(lambda *args: on_progress("tts", args[-1] if args else "")) if on_progress else None,
    )
    master_sogd_mp3(out)
    return {
        "bytes": out.read_bytes(),
        "duration_sec": syn.get("duration_sec"),
        "tts_chars": int(syn.get("tts_chars") or 0),
        "tts_model": syn.get("tts_model"),
        "voice_map": syn.get("voice_map") or {},
        "path": str(out),
    }


def run_daily_episode(
    episode_date: date,
    *,
    force: bool = False,
    dry_run: bool = False,
    existing: dict | None = None,
    voice: dict | None = None,
    auto_publish: bool = True,
    cost_cap: float | None = None,
    month_spend: float = 0.0,
    start_local: str | None = None,
    publish_local: str | None = None,
    now: datetime | None = None,
    pronunciation: dict | None = None,
    on_progress=None,
    scout=None,
    lens=None,
    writer=None,
    fact_checker=None,
    ollama_ok: bool | None = None,
    regenerate_section=None,
    trim_section=None,
    synthesize=None,
    store_put=None,
    repair=None,
    word_min: int | None = None,
    word_max: int | None = None,
) -> dict:
    """Run every stage. Injected callables keep the tests off the network."""
    if isinstance(episode_date, datetime):
        episode_date = episode_date.date()
    start_local = start_local or schedule_clocks()[0]
    publish_local = publish_local or schedule_clocks()[1]
    lo, hi = word_bounds()
    word_min = lo if word_min is None else word_min
    word_max = hi if word_max is None else word_max
    cap = cost_cap_usd() if cost_cap is None else float(cost_cap)
    voice = normalize_voice(voice or default_voice())
    pronunciation = pronunciation_map() if pronunciation is None else pronunciation
    clock = now or datetime.now(LA)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=LA)
    publish_at = clock_on(episode_date, publish_local, LA)

    usage = {
        "llm_input_tokens": 0,
        "llm_output_tokens": 0,
        "x_search_calls": 0,
        "tts_chars": 0,
        "cost_usd_by_stage": {},
        "cost_usd_total": 0.0,
    }
    log = []
    stage = "guard"
    t0 = time.perf_counter()

    def spend() -> float:
        return float(month_spend) + float(usage["cost_usd_total"])

    def charge(stage_name: str, payload: dict | None):
        payload = payload or {}
        summed = _sum_usage([payload])
        cost = float(payload["cost_usd"]) if payload.get("cost_usd") is not None else summed["cost_usd"]
        chars = int(payload.get("tts_chars") or 0)
        usage["llm_input_tokens"] += summed["input_tokens"]
        usage["llm_output_tokens"] += summed["output_tokens"]
        usage["x_search_calls"] += summed["x_search_calls"]
        usage["tts_chars"] += chars
        usage["cost_usd_by_stage"][stage_name] = round(
            float(usage["cost_usd_by_stage"].get(stage_name) or 0) + cost, 6
        )
        usage["cost_usd_total"] = round(float(usage["cost_usd_total"]) + cost, 6)

    def before(stage_name: str):
        if spend() >= cap:
            raise CostCapHit(stage_name, spend())

    def progress(stage_name: str, label: str):
        nonlocal stage
        stage = stage_name
        elapsed = time.perf_counter() - t0
        log.append({"stage": stage_name, "label": label, "elapsed_sec": round(elapsed, 3),
                    "cost_usd": usage["cost_usd_total"]})
        print(f"[sogd] {stage_name} {label} {elapsed:.1f}s ${usage['cost_usd_total']:.4f}", flush=True)
        if on_progress:
            on_progress(stage_name, label, dict(usage))

    result = {
        "ok": False,
        "show": SHOW_ID,
        "episode_date": episode_date.isoformat(),
        "status": "failed",
        "stage": stage,
        "error": "",
        "usage": usage,
        "log": log,
        "voice": voice,
    }
    try:
        guard = date_guard(existing, force=force, now=clock)
        if not guard["ok"]:
            result.update(ok=True, status="skipped", error=guard["reason"], stage="guard")
            return result
        if dry_run:
            result.update(
                ok=True,
                status="dry_run",
                stage="dry_run",
                start_local=start_local,
                publish_local=publish_local,
                feeds=[row["id"] for row in RSS_FEEDS],
                word_min=word_min,
                word_max=word_max,
            )
            return result

        before("scout")
        progress("scout", "x_search plus RSS")
        scouted = scout(episode_date) if scout else live_scout(episode_date)
        charge("scout", (scouted or {}).get("usage") or {})
        ranked = rank_stories(
            (scouted or {}).get("stories") or [],
            limit_min=int(SOGD_STYLE["stories_min"]),
            limit_max=int(SOGD_STYLE["stories_max"]),
        )
        if not ranked["ok"]:
            raise RuntimeError(ranked["error"])
        stories = ranked["stories"]
        result["stories"] = stories

        before("lens")
        progress("lens", f"{len(stories)} stories")
        lensed = lens(stories) if lens else live_lens(stories)
        charge("lens", (lensed or {}).get("usage") or {})

        before("script")
        progress("script", "section by section")
        if writer:
            written = writer(stories, (lensed or {}).get("notes"))
        else:
            written = live_writer(stories, (lensed or {}).get("notes"), episode_date,
                                  word_min=word_min, word_max=word_max)
        charge("script", (written or {}).get("usage") or {})
        script = (written or {}).get("script") or written
        from podcast_engine import _word_count, validate_script
        regen_usage: list[dict] = []

        def _regen(section, need):
            if regenerate_section:
                return regenerate_section(section, need)
            updated = live_expand(section, need)
            if updated.get("_usage"):
                regen_usage.append(updated["_usage"])
            return updated

        budget = enforce_word_budget(
            script,
            word_count=_word_count,
            regenerate_section=_regen,
            trim_section=trim_section or trim_section_words,
            word_min=word_min,
            word_max=word_max,
        )
        for extra in regen_usage:
            charge("script", extra)
        if not budget["ok"]:
            raise RuntimeError(f"word count {budget['words']} outside {word_min}-{word_max}")
        script = ensure_disclosure(budget["script"])
        guarded = guard_script(script)
        if not guarded["ok"]:
            raise RuntimeError("likeness guard rejected: " + ", ".join(guarded["hits"]))
        validation = validate_script(script)
        if not validation["ok"]:
            raise RuntimeError("script invalid: " + "; ".join(validation["errors"]))

        def _judge(script_now):
            claims_now = extract_claims(script_now)
            provider_name_now = pick_fact_checker(bool(ollama_ok))
            if fact_checker:
                checked_now = fact_checker(claims_now, stories, provider_name_now)
            else:
                checked_now = judge_claims(
                    claims_now, stories, ollama_ok=bool(ollama_ok),
                    ollama_fn=live_ollama_verdicts, grok_fn=live_grok_verdicts,
                )
            if isinstance(checked_now, dict) and "verdicts" in checked_now:
                verdicts_now = checked_now.get("verdicts") or {}
            else:
                verdicts_now = checked_now or {}
            charge("fact_check", checked_now.get("usage") if isinstance(checked_now, dict) else {})
            return apply_fact_check(script_now, claims_now, verdicts_now), checked_now, provider_name_now

        before("fact_check")
        progress("fact_check", "claims against sources")
        if ollama_ok is None and fact_checker is None:
            ollama_ok = ollama_reachable()
        applied, checked, provider_name = _judge(script)
        if not applied["ok"]:
            progress("fact_check", "rewriting unsupported lines")
            if repair:
                repaired = repair(script, applied["dropped"], stories)
            else:
                repaired = live_repair_script(script, applied["dropped"], stories, episode_date)
            charge("fact_check", repaired.get("usage") if isinstance(repaired, dict) else {})
            rewritten = repaired.get("script") if isinstance(repaired, dict) else None
            if rewritten:
                script = rewritten
            guarded = guard_script(script)
            if not guarded["ok"]:
                raise RuntimeError("likeness guard rejected: " + ", ".join(guarded["hits"]))
            spent = len(regen_usage)
            budget = enforce_word_budget(
                script,
                word_count=_word_count,
                regenerate_section=_regen,
                trim_section=trim_section or trim_section_words,
                word_min=word_min,
                word_max=word_max,
            )
            for extra in regen_usage[spent:]:
                charge("script", extra)
            if not budget["ok"]:
                raise RuntimeError(f"word count {budget['words']} outside {word_min}-{word_max}")
            script = ensure_disclosure(budget["script"])
            applied, checked, provider_name = _judge(script)
        result["dropped"] = applied["dropped"]
        result["fact_checker"] = (checked or {}).get("provider") if isinstance(checked, dict) else provider_name
        if not applied["ok"]:
            raise RuntimeError(
                f"fact-check dropped {applied['drop_ratio']:.0%} of claims"
            )
        script = ensure_disclosure(applied["script"])
        spent = len(regen_usage)
        budget = enforce_word_budget(
            script,
            word_count=_word_count,
            regenerate_section=_regen,
            trim_section=trim_section or trim_section_words,
            word_min=word_min,
            word_max=word_max,
        )
        for extra in regen_usage[spent:]:
            charge("script", extra)
        if not budget["ok"]:
            raise RuntimeError(f"word count {budget['words']} outside {word_min}-{word_max} after fact-check")
        script = budget["script"]
        guarded = guard_script(script)
        if not guarded["ok"]:
            raise RuntimeError("likeness guard rejected: " + ", ".join(guarded["hits"]))
        result["words"] = budget["words"]
        result["script"] = script
        result["title"] = script.get("episode_title") or episode_title(episode_date, stories[0]["title"])
        result["show_notes"] = show_notes(stories)
        result["transcript"] = script_text(script)

        before("tts")
        progress("tts", voice["provider"] + "/" + voice["voice"])
        if synthesize:
            audio = synthesize(script, voice, pronunciation)
        else:
            audio = _synthesize_engine(script, voice, pronunciation, on_progress)
        chars = int((audio or {}).get("tts_chars") or 0) or len(result["transcript"])
        charge("tts", {"cost_usd": tts_cost(chars, voice["provider"]), "tts_chars": chars})
        audio_bytes = (audio or {}).get("bytes") or b""
        if not audio_bytes:
            raise RuntimeError("TTS returned no audio")
        result["audio_bytes"] = audio_bytes
        result["duration_sec"] = (audio or {}).get("duration_sec")
        result["tts_model"] = (audio or {}).get("tts_model") or voice["provider"]
        result["voice_map"] = (audio or {}).get("voice_map") or {"kimi": voice["voice"]}
        result["chapters"] = chapters_from_stories(stories, result.get("duration_sec") or 0)

        decision = publish_decision(clock, publish_at, auto_publish=auto_publish)
        result["status"] = decision["status"]
        result["published_at"] = decision["published_at"]
        result["ok"] = True
        result["stage"] = "ready"
        if store_put:
            store_put(result)
        progress(result["status"], result["title"])
        return result
    except CostCapHit as exc:
        result.update(ok=False, status="cost_cap_hit", stage=exc.stage, error=str(exc))
        return result
    except Exception as exc:
        result.update(ok=False, status="failed", stage=stage, error=f"{exc!s:.400}")
        print(f"[sogd] failed at {stage}: {exc!s:.300}", flush=True)
        return result


def _cell(row):
    if row is None:
        return None
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


def try_advisory_lock(cur) -> bool:
    cur.execute("SELECT pg_try_advisory_lock(%s)", (ADVISORY_LOCK_KEY,))
    return bool(_cell(cur.fetchone()))


def with_advisory_lock(fn, connect):
    if connect is None:
        return fn()
    with connect() as conn:
        cur = conn.cursor()
        if not try_advisory_lock(cur):
            conn.commit()
            return {"ok": False, "status": "locked", "error": "another worker holds the daily lock"}
        conn.commit()
        try:
            return fn()
        finally:
            cur.execute("SELECT pg_advisory_unlock(%s)", (ADVISORY_LOCK_KEY,))
            conn.commit()


def _dict_cursor(conn):
    from psycopg2.extras import RealDictCursor
    return conn.cursor(cursor_factory=RealDictCursor)


def load_run_context(episode_date: date | None, connect) -> dict:
    now = datetime.now(LA)
    day = episode_date or now.date()
    if isinstance(day, datetime):
        day = day.date()
    start_local, publish_local = schedule_clocks()
    ctx = {
        "episode_date": day,
        "now": now,
        "existing": None,
        "voice": default_voice(),
        "auto_publish": auto_publish_default(),
        "cost_cap_usd": cost_cap_usd(),
        "month_spend": 0.0,
        "pronunciation": pronunciation_map(),
        "start_local": start_local,
        "publish_local": publish_local,
    }
    if connect is None or not os.environ.get("DATABASE_URL"):
        return ctx
    try:
        with connect() as conn:
            cur = _dict_cursor(conn)
            cur.execute("SELECT v FROM kv_store WHERE k = %s", (f"podcast.voice.{SHOW_ID}",))
            row = cur.fetchone()
            if row and row.get("v"):
                ctx["voice"] = voice_for_day(row["v"], day)
            cur.execute("SELECT v FROM kv_store WHERE k = %s", (f"podcast.settings.{SHOW_ID}",))
            row = cur.fetchone()
            settings = (row or {}).get("v") or {}
            if isinstance(settings, dict):
                if "auto_publish" in settings:
                    ctx["auto_publish"] = bool(settings.get("auto_publish"))
                if settings.get("cost_cap_usd") is not None:
                    ctx["cost_cap_usd"] = float(settings["cost_cap_usd"])
            cur.execute(
                """
                SELECT episode_guid, status, published_at, episode_date
                  FROM analyst_podcast_episodes
                 WHERE show = %s AND episode_date = %s
                 LIMIT 1
                """,
                (SHOW_ID, day),
            )
            episode = cur.fetchone()
            if episode:
                ctx["existing"] = dict(episode)
            else:
                cur.execute(
                    """
                    SELECT status, started_at, finished_at
                      FROM podcast_runs
                     WHERE show = %s AND episode_date = %s
                     ORDER BY started_at DESC
                     LIMIT 1
                    """,
                    (SHOW_ID, day),
                )
                run = cur.fetchone()
                if run and run.get("status") in ("running", "cost_cap_hit", "failed"):
                    ctx["existing"] = dict(run)
            cur.execute(
                """
                SELECT COALESCE(SUM(cost_usd_total), 0) AS spend
                  FROM podcast_runs
                 WHERE show = %s
                   AND started_at >= (
                        date_trunc('month', (NOW() AT TIME ZONE 'America/Los_Angeles'))
                        AT TIME ZONE 'America/Los_Angeles'
                   )
                """,
                (SHOW_ID,),
            )
            ctx["month_spend"] = float(_cell(cur.fetchone()) or 0)
            conn.rollback()
    except Exception as exc:
        print(f"[sogd] context skipped: {exc!s:.180}", flush=True)
    return ctx


def abandon_running(connect, episode_date: date) -> None:
    """A lock holder is the only live worker. An older running row is a dead one."""
    if connect is None or not os.environ.get("DATABASE_URL"):
        return
    try:
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE podcast_runs
                   SET finished_at = NOW(),
                       status = 'failed',
                       error = COALESCE(NULLIF(error, ''), 'worker stopped before the run finished')
                 WHERE show = %s AND episode_date = %s AND status = 'running'
                """,
                (SHOW_ID, episode_date),
            )
            conn.commit()
    except Exception as exc:
        print(f"[sogd] abandon skipped: {exc!s:.160}", flush=True)


def begin_run(connect, episode_date: date):
    if connect is None or not os.environ.get("DATABASE_URL"):
        return None
    try:
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO podcast_runs (show, episode_date, status, stage)
                VALUES (%s, %s, 'running', 'scout')
                RETURNING id
                """,
                (SHOW_ID, episode_date),
            )
            run_id = _cell(cur.fetchone())
            conn.commit()
            return run_id
    except Exception as exc:
        print(f"[sogd] run row skipped: {exc!s:.160}", flush=True)
        return None


def touch_run(connect, run_id, stage: str, label: str, usage: dict | None = None) -> None:
    """Write the live stage and spend so the desk can show a moving clock."""
    if connect is None or not run_id or not os.environ.get("DATABASE_URL"):
        return
    try:
        with connect() as conn:
            cur = conn.cursor()
            if usage:
                cur.execute(
                    """
                    UPDATE podcast_runs
                       SET stage = %s,
                           error = %s,
                           cost_usd_total = %s,
                           cost_usd_by_stage = %s::jsonb,
                           llm_input_tokens = %s,
                           llm_output_tokens = %s,
                           x_search_calls = %s
                     WHERE id = %s AND status = 'running'
                    """,
                    (
                        (stage or "")[:80],
                        (label or "")[:500] or None,
                        usage.get("cost_usd_total"),
                        json.dumps(usage.get("cost_usd_by_stage") or {}),
                        usage.get("llm_input_tokens"),
                        usage.get("llm_output_tokens"),
                        usage.get("x_search_calls"),
                        run_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    UPDATE podcast_runs
                       SET stage = %s,
                           error = %s
                     WHERE id = %s AND status = 'running'
                    """,
                    ((stage or "")[:80], (label or "")[:500] or None, run_id),
                )
            conn.commit()
    except Exception as exc:
        print(f"[sogd] progress skipped: {exc!s:.160}", flush=True)


def _finish_run(cur, run_id, result: dict, *, started_at, finished_at, status: str):
    usage = result.get("usage") or {}
    cur.execute(
        """
        UPDATE podcast_runs
           SET finished_at = %s,
               status = %s,
               stage = %s,
               error = %s,
               llm_input_tokens = %s,
               llm_output_tokens = %s,
               x_search_calls = %s,
               tts_chars = %s,
               cost_usd_by_stage = %s::jsonb,
               cost_usd_total = %s
         WHERE id = %s
        """,
        (
            finished_at,
            status,
            result.get("stage"),
            (result.get("error") or "")[:500] or None,
            usage.get("llm_input_tokens"),
            usage.get("llm_output_tokens"),
            usage.get("x_search_calls"),
            usage.get("tts_chars"),
            json.dumps(usage.get("cost_usd_by_stage") or {}),
            usage.get("cost_usd_total"),
            run_id,
        ),
    )


def _insert_run(cur, result: dict, *, started_at, finished_at, status: str):
    usage = result.get("usage") or {}
    cur.execute(
        """
        INSERT INTO podcast_runs (
            show, episode_date, started_at, finished_at, status, stage, error,
            llm_input_tokens, llm_output_tokens, x_search_calls, tts_chars,
            cost_usd_by_stage, cost_usd_total
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        RETURNING id
        """,
        (
            SHOW_ID,
            result.get("episode_date"),
            started_at,
            finished_at,
            status,
            result.get("stage"),
            (result.get("error") or "")[:500] or None,
            usage.get("llm_input_tokens"),
            usage.get("llm_output_tokens"),
            usage.get("x_search_calls"),
            usage.get("tts_chars"),
            json.dumps(usage.get("cost_usd_by_stage") or {}),
            usage.get("cost_usd_total"),
        ),
    )
    return _cell(cur.fetchone())


def persist_sogd_result(result: dict, connect=None) -> dict:
    """Store audio only for a finished episode. A cap hit writes the run and stops."""
    if result.get("status") in ("dry_run", "skipped", "locked"):
        return result
    if connect is None or not os.environ.get("DATABASE_URL"):
        if result.get("audio_bytes"):
            _put_media(result)
        result.setdefault("error", result.get("error") or "DATABASE_URL not set")
        return result
    started = datetime.now(timezone.utc)
    finished = datetime.now(timezone.utc)
    status = result.get("status") or "failed"
    publishable = status in ("published", "ready_pending") and result.get("audio_bytes")
    try:
        if publishable:
            _put_media(result)
        with connect() as conn:
            cur = conn.cursor()
            if publishable:
                from podcast_feed import mint_episode_guid
                guid = result.get("episode_guid") or mint_episode_guid()
                result["episode_guid"] = guid
                cur.execute(
                    """
                    DELETE FROM analyst_podcast_episodes
                     WHERE show = %s AND episode_date = %s AND episode_guid <> %s
                    """,
                    (SHOW_ID, result.get("episode_date"), guid),
                )
                _insert_sogd_episode(cur, result)
            if result.get("run_id"):
                _finish_run(cur, result["run_id"], result, started_at=started, finished_at=finished, status=status)
            else:
                _insert_run(cur, result, started_at=started, finished_at=finished, status=status)
            conn.commit()
    except Exception as exc:
        result["ok"] = False
        result["status"] = "failed"
        result["error"] = f"persist failed: {exc!s:.240}"
        print(f"[sogd] persist failed: {exc!s:.240}", flush=True)
    return result


def _put_media(result: dict) -> None:
    from podcast_media import get_media_store
    from podcast_feed import mint_episode_guid
    guid = result.get("episode_guid") or mint_episode_guid()
    result["episode_guid"] = guid
    store = get_media_store()
    media_key = f"{SHOW_ID}/{guid}.mp3"
    store.put(media_key, result.get("audio_bytes") or b"")
    transcript = (result.get("transcript") or "").encode("utf-8")
    if transcript:
        store.put(f"{SHOW_ID}/{guid}.transcript.txt", transcript)
    written = store.local_path(media_key)
    result["media_key"] = media_key
    result["byte_size"] = len(result.get("audio_bytes") or b"")
    result["audio_local_path"] = str(written) if written is not None else ""
    result["audio_dropbox_path"] = store.dropbox_path(media_key)


def _insert_sogd_episode(cur, result: dict) -> None:
    published = result.get("published_at")
    cur.execute(
        """
        INSERT INTO analyst_podcast_episodes (
            episode_guid, show, ticker, format, episode_title, script_json,
            media_key, byte_size, duration_sec, audio_local_path,
            audio_dropbox_path, tts_model, voice_map, published_at, cost_usd,
            episode_date, status, transcript, show_notes
        )
        VALUES (%s, %s, 'SOGD', 'sogd', %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s::jsonb,
                %s, %s, %s, %s, %s, %s)
        ON CONFLICT (episode_guid) DO NOTHING
        """,
        (
            result.get("episode_guid"),
            SHOW_ID,
            result.get("title"),
            json.dumps(_script_payload(result)),
            result.get("media_key"),
            result.get("byte_size"),
            result.get("duration_sec"),
            result.get("audio_local_path"),
            result.get("audio_dropbox_path"),
            result.get("tts_model"),
            json.dumps(result.get("voice_map") or {}),
            published,
            (result.get("usage") or {}).get("cost_usd_total"),
            result.get("episode_date"),
            result.get("status"),
            result.get("transcript"),
            result.get("show_notes"),
        ),
    )
    cur.execute(
        """
        INSERT INTO analyst_podcasts
            (ticker, format, show, episode_guid, episode_title, script_json,
             audio_local_path, audio_dropbox_path, media_key, byte_size,
             duration_sec, tts_model, voice_map, generated_at, cost_usd)
        VALUES ('SOGD', 'sogd', %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW(), %s)
        ON CONFLICT (ticker, format) DO UPDATE SET
            show = EXCLUDED.show,
            episode_guid = EXCLUDED.episode_guid,
            episode_title = EXCLUDED.episode_title,
            script_json = EXCLUDED.script_json,
            audio_local_path = EXCLUDED.audio_local_path,
            audio_dropbox_path = EXCLUDED.audio_dropbox_path,
            media_key = EXCLUDED.media_key,
            byte_size = EXCLUDED.byte_size,
            duration_sec = EXCLUDED.duration_sec,
            tts_model = EXCLUDED.tts_model,
            voice_map = EXCLUDED.voice_map,
            generated_at = NOW(),
            cost_usd = EXCLUDED.cost_usd
        """,
        (
            SHOW_ID,
            result.get("episode_guid"),
            result.get("title"),
            json.dumps(_script_payload(result)),
            result.get("audio_local_path"),
            result.get("audio_dropbox_path"),
            result.get("media_key"),
            result.get("byte_size"),
            result.get("duration_sec"),
            result.get("tts_model"),
            json.dumps(result.get("voice_map") or {}),
            (result.get("usage") or {}).get("cost_usd_total"),
        ),
    )


def execute_daily(episode_date=None, *, on_progress=None, connect=None, force: bool = False,
                  dry_run: bool = False, **kwargs):
    """Scheduler, button, and CLI all enter here. The lock wraps one local date."""
    def work():
        ctx = load_run_context(episode_date, connect if os.environ.get("DATABASE_URL") else None)
        locked = connect is not None and bool(os.environ.get("DATABASE_URL"))
        guard = date_guard(ctx["existing"], force=force, now=ctx["now"], lock_held=locked and not dry_run)
        if not dry_run and not guard["ok"]:
            return {
                "ok": True,
                "status": "skipped",
                "error": guard["reason"],
                "stage": "guard",
                "episode_date": ctx["episode_date"].isoformat(),
                "show": SHOW_ID,
            }
        retry_running = (
            not dry_run
            and guard.get("retry")
            and ((ctx.get("existing") or {}).get("status") or "").strip().lower() == "running"
        )
        if retry_running:
            abandon_running(connect, ctx["episode_date"])
        run_id = None if dry_run else begin_run(connect, ctx["episode_date"])

        def _relay(stage_name, label, usage=None):
            touch_run(connect, run_id, stage_name, label, usage if isinstance(usage, dict) else None)
            if on_progress:
                on_progress(stage_name, label, usage)

        result = run_daily_episode(
            ctx["episode_date"],
            force=force,
            dry_run=dry_run,
            existing=None if force or retry_running else ctx["existing"],
            voice=kwargs.get("voice") or ctx["voice"],
            auto_publish=ctx["auto_publish"],
            cost_cap=ctx["cost_cap_usd"],
            month_spend=ctx["month_spend"],
            start_local=ctx["start_local"],
            publish_local=ctx["publish_local"],
            now=ctx["now"],
            pronunciation=ctx["pronunciation"],
            on_progress=_relay,
            **{k: v for k, v in kwargs.items() if k not in ("voice", "on_progress")},
        )
        if run_id is not None:
            result["run_id"] = run_id
        if dry_run or result.get("status") in ("skipped", "dry_run"):
            return result
        return persist_sogd_result(result, connect=connect if os.environ.get("DATABASE_URL") else None)

    holder = connect if os.environ.get("DATABASE_URL") else None
    return with_advisory_lock(work, holder)


def release_ready(episode_date: date, connect, *, now: datetime | None = None, manual: bool = False) -> dict:
    """Flip ready_pending to published once 7:00 AM Pacific has arrived."""
    now = now or datetime.now(LA)
    _start, publish_local = schedule_clocks()
    decision = manual_release(now, clock_on(episode_date, publish_local, LA))
    if decision["status"] != "published":
        return decision
    if connect is None or not os.environ.get("DATABASE_URL"):
        return decision
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE analyst_podcast_episodes
               SET status = 'published'
             WHERE show = %s AND episode_date = %s AND status = 'ready_pending'
               AND published_at <= NOW()
            """,
            (SHOW_ID, episode_date),
        )
        conn.commit()
    return decision


def blocking_row(ctx: dict) -> dict | None:
    """The row plan_tick should see: today's episode, or the latest run marker."""
    return ctx.get("existing")


def pilot_audio_path(path: Path | str | None = None) -> Path:
    if path:
        return Path(path)
    env = (os.environ.get("SOGD_PILOT_MP3") or "").strip()
    if env:
        return Path(env)
    return Path.home() / "Desktop" / PILOT_FILENAME


def pilot_episode() -> dict:
    """Feed row for episode 1. The guid does not change between imports."""
    return {
        "episode_guid": PILOT_GUID,
        "show": SHOW_ID,
        "title": PILOT_TITLE,
        "episode_title": PILOT_TITLE,
        "summary": PILOT_DESCRIPTION,
        "show_notes": PILOT_SHOW_NOTES,
        "published_at": PILOT_PUBLISHED_AT,
        "duration_sec": PILOT_DURATION_SEC,
        "byte_size": PILOT_BYTE_SIZE,
        "episode_number": PILOT_EPISODE_NUMBER,
        "episode_type": "full",
        "status": "published",
        "explicit": False,
        "chapters": resolve_chapters(PILOT_SHOW_NOTES, PILOT_DURATION_SEC),
    }


def _pilot_matches(data: bytes) -> bool:
    return len(data) == int(PILOT_BYTE_SIZE) and hashlib.md5(data).hexdigest() == PILOT_MD5


def import_sogd_pilot(*, path: Path | str | None = None, connect=None, store=None) -> dict:
    """Store the pilot MP3 and upsert episode 1. A missing file writes nothing.

    The episode guid is fixed. Running this again keeps that guid.
    An Oct 27 row with a different guid is replaced only after the file checks out.
    """
    guid = PILOT_GUID
    audio_path = pilot_audio_path(path)
    if not audio_path.is_file():
        return {"ok": False, "status": "missing", "episode_guid": guid, "path": str(audio_path)}
    data = audio_path.read_bytes()
    digest = hashlib.md5(data).hexdigest()
    if not _pilot_matches(data):
        return {
            "ok": False,
            "status": "mismatch",
            "episode_guid": guid,
            "byte_size": len(data),
            "md5": digest,
        }
    if store is None:
        from podcast_media import get_media_store
        store = get_media_store()
    media_key = f"{SHOW_ID}/{guid}.mp3"
    store.put(media_key, data)
    local = store.local_path(media_key)
    result = {
        "ok": True,
        "status": "stored",
        "episode_guid": guid,
        "show": SHOW_ID,
        "title": PILOT_TITLE,
        "summary": PILOT_DESCRIPTION,
        "show_notes": PILOT_SHOW_NOTES,
        "byte_size": PILOT_BYTE_SIZE,
        "duration_sec": PILOT_DURATION_SEC,
        "episode_number": PILOT_EPISODE_NUMBER,
        "episode_date": PILOT_DATE.isoformat(),
        "published_at": PILOT_PUBLISHED_AT,
        "media_key": media_key,
        "audio_local_path": str(local) if local is not None else "",
        "audio_dropbox_path": store.dropbox_path(media_key) or "",
        "tts_model": "xai",
        "voice_map": {"kimi": SOGD_STYLE["voice"]},
        "transcript": "",
        "script": {},
    }
    if connect is None:
        return result
    with connect() as conn:
        cur = conn.cursor()
        cur.execute("ALTER TABLE analyst_podcast_episodes ADD COLUMN IF NOT EXISTS summary TEXT")
        cur.execute(
            "ALTER TABLE analyst_podcast_episodes ADD COLUMN IF NOT EXISTS episode_number INTEGER"
        )
        cur.execute(
            """
            DELETE FROM analyst_podcast_episodes
             WHERE show = %s AND episode_date = %s AND episode_guid <> %s
            """,
            (SHOW_ID, result["episode_date"], guid),
        )
        cur.execute(
            """
            INSERT INTO analyst_podcast_episodes (
                episode_guid, show, ticker, format, episode_title, script_json,
                media_key, byte_size, duration_sec, audio_local_path,
                audio_dropbox_path, tts_model, voice_map, published_at, cost_usd,
                episode_date, status, transcript, show_notes, summary, episode_number
            )
            VALUES (
                %s, %s, 'SOGD', 'sogd', %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s::jsonb,
                %s, %s, %s, 'published', %s, %s, %s, %s
            )
            ON CONFLICT (episode_guid) DO UPDATE SET
                episode_title = EXCLUDED.episode_title,
                media_key = EXCLUDED.media_key,
                byte_size = EXCLUDED.byte_size,
                duration_sec = EXCLUDED.duration_sec,
                audio_local_path = EXCLUDED.audio_local_path,
                audio_dropbox_path = EXCLUDED.audio_dropbox_path,
                tts_model = EXCLUDED.tts_model,
                voice_map = EXCLUDED.voice_map,
                published_at = EXCLUDED.published_at,
                episode_date = EXCLUDED.episode_date,
                status = EXCLUDED.status,
                transcript = EXCLUDED.transcript,
                show_notes = EXCLUDED.show_notes,
                summary = EXCLUDED.summary,
                episode_number = EXCLUDED.episode_number
            """,
            (
                guid,
                SHOW_ID,
                PILOT_TITLE,
                json.dumps({"chapters": resolve_chapters(PILOT_SHOW_NOTES, PILOT_DURATION_SEC)}),
                media_key,
                PILOT_BYTE_SIZE,
                PILOT_DURATION_SEC,
                result["audio_local_path"],
                result["audio_dropbox_path"],
                "xai",
                json.dumps(result["voice_map"]),
                PILOT_PUBLISHED_AT,
                None,
                PILOT_DATE,
                "",
                PILOT_SHOW_NOTES,
                PILOT_DESCRIPTION,
                PILOT_EPISODE_NUMBER,
            ),
        )
        conn.commit()
    result["status"] = "published"
    return result
