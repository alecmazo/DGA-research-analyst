"""Resume, lock, style checks, and one full Daily run. No network."""
from __future__ import annotations

import json
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _stories():
    rows = []
    for cat in ("politics", "world", "science", "markets"):
        rows.append({
            "title": f"{cat} headline about the day",
            "url": f"https://example.test/{cat}",
            "category": cat,
            "sources": [
                {"title": f"{cat} wire", "url": f"https://example.test/{cat}/a"},
                {"title": f"{cat} desk", "url": f"https://example.test/{cat}/b"},
            ],
        })
    return rows


def _beats(n: int, words: int) -> str:
    body = " ".join(["detail"] * words)
    return (
        f"Story {n}. What happened. {body} Who says what. Now the other side. "
        "Follow the money. Who wins if you believe this? "
        "So why does this matter to you? A short recap. What to watch next."
    )


def _style_script(words: int = 900) -> dict:
    sections = [{
        "id": "cold_open",
        "turns": [{
            "speaker": "kimi",
            "intensity": "normal",
            "text": (
                "Good morning. It is Wednesday. Systems Over Goals Daily. "
                "First the markets. Then the world. Then science. Then politics."
            ),
        }],
    }]
    for n in range(1, 5):
        sections.append({
            "id": f"story_{n}",
            "turns": [{"speaker": "kimi", "intensity": "normal", "text": _beats(n, words)}],
        })
    sections.append({
        "id": "close",
        "turns": [{
            "speaker": "kimi",
            "intensity": "normal",
            "text": "That is the pattern today. This episode is AI-generated and AI-narrated.",
        }],
    })
    return {
        "ticker": "SOGD",
        "format": "sogd",
        "episode_title": "SOGD — Oct 28, 2026: Markets",
        "winner": "kimi",
        "intro_style": "question",
        "sections": sections,
    }


def _keep(claims, stories, provider):
    return {"verdicts": {claim["id"]: {"keep": True} for claim in claims}, "usage": {}}


class SogdResumeTests(unittest.TestCase):
    def _run(self, **overrides):
        from podcast_sogd import run_daily_episode
        kwargs = dict(
            existing=None,
            month_spend=0,
            cost_cap=40,
            word_min=3000,
            word_max=6000,
            scout=lambda day: {"stories": _stories(), "usage": {}},
            lens=lambda stories: {"notes": [], "usage": {}},
            writer=lambda stories, notes: {"script": _style_script(), "usage": {}},
            fact_checker=_keep,
            ollama_ok=False,
            synthesize=lambda script, voice, pronunciation: {
                "bytes": b"ID3sogd", "duration_sec": 1200, "tts_chars": 20, "tts_model": "xai",
            },
        )
        kwargs.update(overrides)
        return run_daily_episode(date(2026, 10, 28), **kwargs)

    def test_writer_prompt_matches_validator_and_the_pilot_shape(self):
        from podcast_engine import validate_script
        from podcast_sogd import (
            SOGD_CLOSE_IDS,
            writer_instructions,
            writer_section_line,
        )
        line = writer_section_line()
        self.assertIn("cold_open", line)
        self.assertIn("close", line)
        self.assertNotIn("systems_takeaway", line)
        self.assertEqual(SOGD_CLOSE_IDS[0], "close")
        prompt = writer_instructions(date(2026, 10, 28), None, 3700, 4400)
        for phrase in (
            "follow the money",
            "why does this matter",
            "No AI disclosure",
            "short recap",
            "what to watch",
            "[long-pause]",
            "Good morning",
            "4-5" if "4-5" in prompt else "Four or five",
            "Scott Adams",
        ):
            self.assertIn(phrase, prompt)
        self.assertIn("Oct 27 v4 pilot", prompt)
        self.assertLessEqual(prompt.count("Shape example from the approved Oct 27 v4 pilot"), 1)
        script = _style_script(50)
        self.assertTrue(validate_script(script)["ok"], validate_script(script)["errors"])
        too_many = _style_script(20)
        for n in range(5, 8):
            too_many["sections"].insert(-1, {
                "id": f"story_{n}",
                "turns": [{"speaker": "kimi", "intensity": "normal", "text": _beats(n, 5)}],
            })
        self.assertFalse(validate_script(too_many)["ok"])
        disclosed = _style_script(20)
        disclosed["sections"][0]["turns"][0]["text"] = "This episode is AI-generated and AI-narrated. Good morning."
        self.assertFalse(validate_script(disclosed)["ok"])
        thin = _style_script(20)
        thin["sections"][1]["turns"][0]["text"] = "Markets moved and nobody said why."
        errors = validate_script(thin)["errors"]
        self.assertTrue(any("recap" in err or "why it matters" in err for err in errors))

    def test_full_run_reaches_publish_and_notify(self):
        seen = []
        result = self._run(on_checkpoint=lambda stage, artifacts: seen.append(stage))
        self.assertIn(result["status"], ("published", "ready_pending"))
        for stage in ("scout", "rank", "script", "factcheck", "tts_chunks", "assemble", "master", "upload", "publish", "notify"):
            self.assertIn(stage, seen)
        self.assertEqual(result["notify"]["delivered"], True)
        again = result["notify"]["episode_guid"]
        from podcast_sogd import notify_delivery
        second = notify_delivery(again, again)
        self.assertTrue(second["skipped"])
        self.assertNotIn("delivered", second)

    def test_resume_skips_finished_stages_and_cached_chunks(self):
        from podcast_sogd import plan_tts_chunks
        calls = {"writer": 0, "tts": []}

        def writer(stories, notes):
            calls["writer"] += 1
            return {"script": _style_script(40), "usage": {}}

        def synthesize(script, voice, pronunciation, chunk_cache=None):
            made = 0
            for chunk in plan_tts_chunks(script, voice, pronunciation):
                if chunk["id"] not in chunk_cache:
                    calls["tts"].append(chunk["id"])
                    chunk_cache[chunk["id"]] = b"a"
                    made += 1
                    if made == 1 and calls["writer"] == 1 and not calls.get("again"):
                        raise RuntimeError("tts broke")
            return {"bytes": b"ID3sogd", "duration_sec": 10, "tts_chars": 4, "tts_model": "xai"}

        first = self._run(writer=writer, synthesize=synthesize, word_min=100, word_max=8000)
        self.assertEqual(first["status"], "failed")
        self.assertEqual(calls["writer"], 1)
        self.assertEqual(first.get("stage_done"), "factcheck")
        self.assertEqual(len(calls["tts"]), 1)
        calls["again"] = True
        before = len(calls["tts"])
        second = self._run(
            writer=writer,
            synthesize=synthesize,
            word_min=100,
            word_max=8000,
            resume={
                "stage_done": first["stage_done"],
                "artifacts": first["artifacts"],
                "chunk_audio": first["chunk_audio"],
            },
        )
        self.assertIn(second["status"], ("published", "ready_pending"))
        self.assertEqual(calls["writer"], 1)
        self.assertGreater(len(calls["tts"]), before)
        self.assertEqual(len(calls["tts"]), len(set(calls["tts"])))

        audio_calls = {"n": 0}

        def explode(*args, **kwargs):
            audio_calls["n"] += 1
            raise AssertionError("tts should not run")

        uploaded = []

        def store(result):
            uploaded.append(result.get("episode_guid"))
            if len(uploaded) == 1:
                raise RuntimeError("upload broke")

        held = {
            "stage_done": "master",
            "artifacts": {
                "stories": _stories(),
                "script": _style_script(40),
                "audio_bytes": b"ID3sogd",
                "title": "SOGD — Oct 28, 2026: Markets",
                "transcript": "Good morning.",
                "show_notes": "notes",
                "words": 100,
                "duration_sec": 10,
            },
        }
        broken = self._run(
            writer=writer,
            synthesize=explode,
            store_put=store,
            resume=held,
            word_min=100,
            word_max=8000,
        )
        self.assertEqual(broken["status"], "failed")
        self.assertEqual(audio_calls["n"], 0)
        self.assertEqual(calls["writer"], 1)
        fixed = self._run(
            writer=writer,
            synthesize=explode,
            store_put=store,
            resume=held,
            word_min=100,
            word_max=8000,
        )
        self.assertIn(fixed["status"], ("published", "ready_pending"))
        self.assertEqual(audio_calls["n"], 0)
        self.assertIn("notify", fixed["stages"])

    def test_lock_backoff_cap_and_cleanup(self):
        from podcast_sogd import (
            RETRY_BACKOFF_MIN,
            auto_daily_default,
            claim_run,
            cleanup_partials,
            failure_is_retryable,
            late_alert_due,
            plan_tick,
            retry_backoff,
        )
        now = datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc)
        fresh = {"status": "running", "heartbeat_at": now}
        self.assertFalse(claim_run(fresh, lock_acquired=False, now=now)["ok"])
        self.assertEqual(claim_run(fresh, lock_acquired=True, now=now)["status"], "locked")
        stale = {"status": "running", "heartbeat_at": now - timedelta(minutes=11)}
        taken = claim_run(stale, lock_acquired=True, now=now)
        self.assertTrue(taken["ok"])
        self.assertTrue(taken["takeover"])
        self.assertEqual(retry_backoff(1, 0), timedelta(minutes=2))
        self.assertEqual(retry_backoff(2, 0), timedelta(minutes=5))
        self.assertEqual(retry_backoff(3, 0), timedelta(minutes=10))
        self.assertEqual(retry_backoff(4, 0), timedelta(minutes=20))
        self.assertEqual(RETRY_BACKOFF_MIN, (2, 5, 10, 20, 40))
        self.assertIsNone(retry_backoff(5, 0))
        self.assertIsNone(retry_backoff(6, 0))
        self.assertFalse(failure_is_retryable("failed_needs_attention", "script invalid"))
        self.assertFalse(failure_is_retryable("failed", "script invalid: missing recap"))
        tz_now = datetime(2026, 10, 28, 8, 0, tzinfo=timezone.utc)  # 01:00 PT, before the window
        la = datetime(2026, 10, 28, 11, 0, tzinfo=__import__("zoneinfo").ZoneInfo("America/Los_Angeles"))
        self.assertEqual(plan_tick(la, {"status": "failed_needs_attention"})["reason"], "needs_attention")
        capped = plan_tick(la, {"status": "failed", "attempts": 5})
        self.assertEqual(capped["reason"], "attempts")
        waiting = plan_tick(la, {"status": "failed", "attempts": 1, "next_retry_at": la + timedelta(minutes=5)})
        self.assertEqual(waiting["reason"], "backoff")
        noon = datetime(2026, 10, 28, 12, 5, tzinfo=__import__("zoneinfo").ZoneInfo("America/Los_Angeles"))
        self.assertEqual(plan_tick(noon, {"status": "failed", "attempts": 1})["reason"], "after_window")
        morning = datetime(2026, 10, 28, 6, 40, tzinfo=__import__("zoneinfo").ZoneInfo("America/Los_Angeles"))
        self.assertEqual(plan_tick(morning, None)["action"], "generate")
        manual = plan_tick(morning, None, auto_daily=False)
        self.assertEqual(manual["action"], "sleep")
        self.assertEqual(manual["reason"], "manual")
        held = {
            "status": "ready_pending",
            "published_at": datetime(2026, 10, 28, 7, 0, tzinfo=__import__("zoneinfo").ZoneInfo("America/Los_Angeles")),
        }
        at_seven = datetime(2026, 10, 28, 7, 0, tzinfo=__import__("zoneinfo").ZoneInfo("America/Los_Angeles"))
        self.assertEqual(plan_tick(at_seven, held, auto_daily=False)["action"], "release")
        self.assertTrue(auto_daily_default())
        late = datetime(2026, 10, 28, 7, 31, tzinfo=__import__("zoneinfo").ZoneInfo("America/Los_Angeles"))
        self.assertFalse(late_alert_due(late, {"status": "failed"}, auto_daily=False))
        self.assertTrue(late_alert_due(late, {"status": "failed"}))
        self.assertFalse(late_alert_due(datetime(2026, 10, 28, 7, 31, tzinfo=__import__("zoneinfo").ZoneInfo("America/Los_Angeles")), {"status": "published"}))
        self.assertFalse(late_alert_due(datetime(2026, 10, 28, 7, 10, tzinfo=__import__("zoneinfo").ZoneInfo("America/Los_Angeles")), {"status": "failed"}))
        today = date(2026, 10, 28)
        cleaned = cleanup_partials(
            [
                {"episode_date": date(2026, 10, 20), "status": "failed", "stage_done": "script", "chunk_keys": ["orphan"]},
                {"episode_date": date(2026, 10, 20), "status": "published", "stage_done": "notify", "chunk_keys": ["keep"]},
                {"episode_date": date(2026, 10, 27), "status": "failed", "stage_done": "tts_chunks", "chunk_keys": ["recent"]},
            ],
            [
                {"key": "orphan", "kind": "chunk"},
                {"key": "keep", "kind": "chunk"},
                {"key": "recent", "kind": "chunk"},
                {"key": "old.wav", "kind": "wav"},
            ],
            today=today,
        )
        self.assertIn(date(2026, 10, 20), cleaned["states"])
        self.assertNotIn(date(2026, 10, 27), cleaned["states"])
        self.assertIn("orphan", cleaned["files"])
        self.assertIn("old.wav", cleaned["files"])
        self.assertNotIn("keep", cleaned["files"])
        self.assertNotIn("recent", cleaned["files"])
        del tz_now

    def test_settings_match_the_oct_27_snapshot(self):
        from podcast_engine import (
            GAP_BEFORE_VERDICT,
            GAP_BETWEEN_SECTIONS,
            GAP_INTRA_SECTION,
            HITECH_INTRO_EXTRA_DB,
            INTENSITY_SPEED,
            LOUDNORM_FILTER,
            SPEAKER_SPEED_OFFSET,
        )
        from podcast_sogd import SOGD_STYLE, cost_cap_usd, default_voice, schedule_clocks
        snap = json.loads((ROOT / "tests/fixtures/sogd_settings_39985ba.json").read_text(encoding="utf-8"))
        for key, value in snap["SOGD_STYLE"].items():
            got = SOGD_STYLE[key]
            if isinstance(got, tuple):
                got = list(got)
            self.assertEqual(got, value, key)
        self.assertEqual(default_voice("systems-over-goals"), snap["default_voice"])
        self.assertEqual(list(schedule_clocks()), snap["schedule"])
        self.assertEqual(cost_cap_usd(), snap["cost_cap_usd"])
        self.assertEqual(INTENSITY_SPEED, snap["INTENSITY_SPEED"])
        self.assertEqual(SPEAKER_SPEED_OFFSET, snap["SPEAKER_SPEED_OFFSET"])
        self.assertEqual(GAP_INTRA_SECTION, snap["GAP_INTRA_SECTION"])
        self.assertEqual(GAP_BETWEEN_SECTIONS, snap["GAP_BETWEEN_SECTIONS"])
        self.assertEqual(GAP_BEFORE_VERDICT, snap["GAP_BEFORE_VERDICT"])
        self.assertEqual(HITECH_INTRO_EXTRA_DB, snap["HITECH_INTRO_EXTRA_DB"])
        self.assertEqual(LOUDNORM_FILTER, snap["LOUDNORM_FILTER"])
        engine = (ROOT / "podcast_sogd.py").read_text(encoding="utf-8")
        self.assertIn("COALESCE(status, '') <> 'failed'", engine)

    def test_sogd_opens_on_the_host_and_hitech_keeps_the_bumper(self):
        from podcast_engine import (
            DEFAULT_DISCLAIMER_INTRO,
            DEFAULT_DISCLAIMER_OUTRO,
            assembly_lead_ms,
            assembly_timeline,
            show_assembly,
        )
        from podcast_sogd import SOGD_STYLE, plan_tts_chunks, writer_instructions
        sogd = assembly_timeline("sogd")
        hitech = assembly_timeline("debate")
        self.assertEqual(sogd[0], "voice")
        self.assertNotIn("intro_sting", sogd)
        self.assertNotIn("intro_disclaimer", sogd)
        self.assertNotIn("outro_sting", sogd)
        self.assertIn("outro_disclaimer", sogd)
        self.assertEqual(hitech[0], "intro_disclaimer")
        self.assertNotIn("intro_sting", hitech)
        self.assertNotIn("outro_sting", hitech)
        self.assertIn("voice", hitech)
        self.assertTrue(show_assembly("sogd")["open_on_voice"])
        self.assertFalse(show_assembly("debate")["open_on_voice"])
        self.assertFalse(show_assembly("debate")["intro_sting"])
        self.assertFalse(show_assembly("debate")["outro_sting"])
        self.assertEqual(assembly_lead_ms(show_assembly("sogd"), intro_ms=5000, disc_intro_ms=8000, body_gap_ms=500), 0)
        hitech_lead = assembly_lead_ms(show_assembly("debate"), intro_ms=3200, disc_intro_ms=4000, body_gap_ms=750)
        self.assertEqual(hitech_lead, 4000 + 750)
        script = _style_script(20)
        chunks = plan_tts_chunks(script, {"voice": "kepler", "speed": 1.0}, {})
        spoken = [row["text"] for row in chunks]
        self.assertNotIn(DEFAULT_DISCLAIMER_INTRO, spoken)
        self.assertIn(DEFAULT_DISCLAIMER_OUTRO, spoken)
        disc = [row for row in chunks if row["kind"] == "disclaimer"]
        self.assertEqual(len(disc), 1)
        self.assertGreater(disc[0]["speed"], 1.0)
        self.assertEqual(SOGD_STYLE["opening_speed"], 0.97)
        self.assertEqual(SOGD_STYLE["voice"], "kepler")
        prompt = writer_instructions(date(2026, 10, 28), None, 3700, 4400)
        self.assertIn("person talking to a friend", prompt)
        self.assertIn("Do not wrap the opening in <slow>", prompt)

    def test_hitech_disclaimer_is_shorter_and_faster(self):
        import re
        from podcast_engine import (
            DEFAULT_DISCLAIMER_INTRO,
            DEFAULT_DISCLAIMER_OUTRO,
            DISCLAIMER_SPEED,
            _system_prompt_common,
            human_delivery_rules,
        )
        old_intro = (
            "This podcast is for informational and educational purposes only. "
            "It is not investment advice, an offer to sell, or a solicitation to buy "
            "any security. DGA Capital is an exempt reporting adviser in California. "
            "Holdings, opinions, and price targets discussed may change without notice. "
            "Past performance is not indicative of future results."
        )
        old_outro = (
            "Reminder: this episode is for informational purposes only and is not "
            "investment advice. Consult your own financial advisor before making any "
            "investment decisions. Thanks for listening."
        )

        def words(text: str) -> int:
            return len(re.findall(r"\b[\w']+\b", text))

        self.assertLessEqual(words(DEFAULT_DISCLAIMER_INTRO), int(words(old_intro) * 0.55))
        self.assertLessEqual(words(DEFAULT_DISCLAIMER_OUTRO), int(words(old_outro) * 0.55))
        spoken = (DEFAULT_DISCLAIMER_INTRO + " " + DEFAULT_DISCLAIMER_OUTRO).lower()
        for point in ("not investment advice", "ai-generated", "may hold positions", "your own research"):
            self.assertIn(point, spoken)
        self.assertGreaterEqual(DISCLAIMER_SPEED, 1.15)
        self.assertLessEqual(DISCLAIMER_SPEED, 1.2)
        self.assertGreater(DISCLAIMER_SPEED, 1.0)
        rules = human_delivery_rules()
        prompt = _system_prompt_common()
        self.assertIn(rules, prompt)
        self.assertIn("Do not wrap the opening in <slow>", prompt)
        self.assertIn("[pause]", prompt)

    def test_trim_keeps_pause_tags(self):
        from podcast_sogd import trim_section_words
        section = {
            "id": "story_1",
            "turns": [{
                "text": "Hello [pause] world extra words here. So why does this matter to you? A short recap.",
            }],
        }
        trimmed = trim_section_words(section, 3)
        text = trimmed["turns"][0]["text"]
        self.assertIn("[pause]", text)
        self.assertIn("recap", text.lower())
        self.assertIn("why does this matter", text.lower())


if __name__ == "__main__":
    unittest.main()
