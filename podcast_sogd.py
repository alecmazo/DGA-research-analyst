"""Systems Over Goals Daily.

One orchestrator. The script check, disclaimer, stings, and loudnorm stay in
podcast_engine. This module ranks, guards, schedules, and records the run.
Network calls are lazy so tests can pass the stage functions in.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from copy import deepcopy
from datetime import date, datetime, time as dt_time, timedelta, timezone
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
        lo = int(os.environ.get("SOGD_WORD_MIN") or 3800)
    except ValueError:
        lo = 3800
    try:
        hi = int(os.environ.get("SOGD_WORD_MAX") or 4300)
    except ValueError:
        hi = 4300
    if hi < lo:
        hi = lo
    return lo, hi


def schedule_clocks() -> tuple[str, str]:
    start = (os.environ.get("SOGD_START_LOCAL") or "06:35").strip() or "06:35"
    publish = (os.environ.get("SOGD_PUBLISH_LOCAL") or "07:00").strip() or "07:00"
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
    return {"provider": provider, "voice": voice, "speed": speed}


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
               stale_after_sec: int = 3 * 3600) -> dict:
    if not existing:
        return {"ok": True}
    status = (existing.get("status") or "published").strip().lower()
    if force:
        return {"ok": True, "replaced": True}
    if status in ("failed", "cost_cap_hit"):
        return {"ok": True, "retry": status == "failed"}
    if status == "running":
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
    script = deepcopy(script)
    for sec in script.get("sections") or []:
        if sec.get("id") != "cold_open":
            continue
        turns = sec.setdefault("turns", [])
        if not turns:
            turns.append({"speaker": "kimi", "intensity": "normal", "text": DISCLOSURE})
        elif DISCLOSURE not in (turns[0].get("text") or ""):
            turns[0]["text"] = f"{DISCLOSURE} {turns[0]['text']}".strip()
        break
    return script


def extract_claims(script: dict) -> list[dict]:
    claims = []
    n = 0
    for sec in script.get("sections") or []:
        for turn in sec.get("turns") or []:
            for sent in re.split(r"(?<=[.!?])\s+", turn.get("text") or ""):
                sent = sent.strip()
                if not sent:
                    continue
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
    if ollama_ok:
        try:
            return {"provider": "ollama", "verdicts": ollama_fn(claims, stories)}
        except Exception:
            return {"provider": "grok", "verdicts": grok_fn(claims, stories), "fallback": True}
    return {"provider": "grok", "verdicts": grok_fn(claims, stories)}


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
        f"Sections in order: cold_open, story_1..story_N, systems_takeaway. "
        f"Total between {word_min} and {word_max} words. "
        f"The cold open starts with: {DISCLOSURE} "
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


def _verdict_map(text: str) -> dict:
    data = _json_obj(text)
    rows = data.get("verdicts") or []
    out = {}
    if isinstance(rows, dict):
        return rows
    for row in rows:
        if isinstance(row, dict) and row.get("id"):
            out[str(row["id"])] = {"keep": bool(row.get("keep", False))}
    return out


def live_grok_verdicts(claims, stories) -> dict:
    text, _usage = _call_grok(
        "Return JSON only: {\"verdicts\":[{\"id\":\"\",\"keep\":true}]}. "
        "keep is true only when the claim is supported by the sources.",
        json.dumps({"claims": claims, "sources": stories}),
    )
    return _verdict_map(text)


def live_ollama_verdicts(claims, stories) -> dict:
    prompt = (
        "Check each claim against the sources. "
        "Return JSON only: {\"verdicts\":[{\"id\":\"\",\"keep\":true}]}. "
        "keep is false when the sources do not support the claim.\n"
        + json.dumps({"claims": claims, "sources": stories})
    )
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=json.dumps({"model": "gemma4", "prompt": prompt, "stream": False}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return _verdict_map(payload.get("response") or "")


def _synthesize_engine(script, voice, pronunciation, on_progress) -> dict:
    import tempfile
    from pathlib import Path
    from podcast_engine import synthesize_episode
    out = Path(tempfile.mkdtemp(prefix="sogd-")) / "episode.mp3"
    syn = synthesize_episode(
        script,
        out_path=out,
        tts_provider=voice.get("provider"),
        voice_override=voice.get("voice"),
        speed_override=voice.get("speed") or 1.0,
        pronunciation=pronunciation,
        on_progress=(lambda *args: on_progress("tts", args[-1] if args else "")) if on_progress else None,
    )
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
        ranked = rank_stories((scouted or {}).get("stories") or [])
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

        before("fact_check")
        progress("fact_check", "claims against sources")
        claims = extract_claims(script)
        if ollama_ok is None and fact_checker is None:
            ollama_ok = ollama_reachable()
        provider_name = pick_fact_checker(bool(ollama_ok))
        if fact_checker:
            checked = fact_checker(claims, stories, provider_name)
        else:
            checked = judge_claims(
                claims, stories, ollama_ok=bool(ollama_ok),
                ollama_fn=live_ollama_verdicts, grok_fn=live_grok_verdicts,
            )
        verdicts = checked.get("verdicts") if isinstance(checked, dict) and "verdicts" in checked else checked
        charge("fact_check", (checked or {}).get("usage") if isinstance(checked, dict) else {})
        applied = apply_fact_check(script, claims, verdicts or {})
        result["dropped"] = applied["dropped"]
        result["fact_checker"] = (checked or {}).get("provider") if isinstance(checked, dict) else provider_name
        if not applied["ok"]:
            raise RuntimeError(
                f"fact-check dropped {applied['drop_ratio']:.0%} of claims"
            )
        script = ensure_disclosure(applied["script"])
        budget = enforce_word_budget(
            script,
            word_count=_word_count,
            regenerate_section=_regen,
            trim_section=trim_section or trim_section_words,
            word_min=word_min,
            word_max=word_max,
        )
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
                ctx["voice"] = normalize_voice(row["v"])
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
            json.dumps(result.get("script") or {}),
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
            json.dumps(result.get("script") or {}),
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
        guard = date_guard(ctx["existing"], force=force, now=ctx["now"])
        if not dry_run and not guard["ok"]:
            return {
                "ok": True,
                "status": "skipped",
                "error": guard["reason"],
                "stage": "guard",
                "episode_date": ctx["episode_date"].isoformat(),
                "show": SHOW_ID,
            }
        run_id = None if dry_run else begin_run(connect, ctx["episode_date"])
        result = run_daily_episode(
            ctx["episode_date"],
            force=force,
            dry_run=dry_run,
            existing=None if force else ctx["existing"],
            voice=kwargs.get("voice") or ctx["voice"],
            auto_publish=ctx["auto_publish"],
            cost_cap=ctx["cost_cap_usd"],
            month_spend=ctx["month_spend"],
            start_local=ctx["start_local"],
            publish_local=ctx["publish_local"],
            now=ctx["now"],
            pronunciation=ctx["pronunciation"],
            on_progress=on_progress,
            **{k: v for k, v in kwargs.items() if k != "voice"},
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
