"""Systems Over Goals Daily. No network."""
from __future__ import annotations

import io
import json
import os
import unittest
import urllib.error
from datetime import date, datetime, timedelta, timezone
from email.message import Message
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]

os.environ.pop("XAI_API_KEY", None)


def _stories():
    rows = []
    for cat in ("politics", "world", "science", "markets"):
        for i in range(2):
            rows.append({
                "title": f"{cat} headline number {i} about {cat}",
                "url": f"https://example.test/{cat}/{i}",
                "category": cat,
            })
    rows.append({
        "title": "politics headline number 0 about politics",
        "url": "https://example.test/politics/0?dup=1",
        "category": "politics",
    })
    rows.append({"title": "no link", "url": "", "category": "markets"})
    return rows


def _words(n: int, tail: str = "") -> str:
    text = " ".join(["markets"] * n)
    if tail:
        text = f"{text} {tail}"
    return text.strip() + "."


def _script(words: int = 4000, tail: str = "") -> dict:
    first = words // 3
    second = words // 3
    third = words - first - second
    return {
        "ticker": "SOGD",
        "format": "sogd",
        "episode_title": "SOGD — Oct 26, 2026: Lead",
        "winner": "kimi",
        "sections": [
            {"id": "cold_open", "turns": [{"speaker": "kimi", "intensity": "normal", "text": _words(first, tail)}]},
            {"id": "story_1", "turns": [{"speaker": "kimi", "intensity": "normal", "text": _words(second)}]},
            {"id": "systems_takeaway", "turns": [{"speaker": "kimi", "intensity": "normal", "text": _words(third)}]},
        ],
    }


def _audio(script, voice, pronunciation):
    return {"bytes": b"ID3sogd", "duration_sec": 1500, "tts_chars": 100, "tts_model": voice["provider"]}


class SogdPipelineTests(unittest.TestCase):
    def test_xai_body_chunk_pronunciation_and_cache(self):
        from podcast_tts import (
            XaiTTS,
            apply_pronunciation,
            cached_xai_voices,
            chunk_text,
            xai_request_body,
        )

        body = xai_request_body("Say LUFS today.", "kepler", 1.0, {"LUFS": "luffs"})
        self.assertEqual(body["text"], "Say luffs today.")
        self.assertEqual(body["voice_id"], "kepler")
        self.assertNotIn("voice", body)
        self.assertEqual(body["language"], "en")
        self.assertIs(body["text_normalization"], True)
        self.assertEqual(body["output_format"]["codec"], "mp3")
        self.assertNotIn("replace", body)
        self.assertEqual(apply_pronunciation("NVDA and LUFS", {"LUFS": "luffs", "NVDA": "en vidia"}),
                         "en vidia and luffs")

        parts = chunk_text("Sentence one. Sentence two. " * 400, 3000)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(len(part) <= 3000 for part in parts))

        fetches = []
        state = {}
        store = {}

        def fetch():
            fetches.append(1)
            return ["kepler", "eve"]

        voices = cached_xai_voices(fetch, lambda: store.get("row"), lambda row: store.__setitem__("row", row),
                                   now=1_000, state=state)
        again = cached_xai_voices(fetch, lambda: store.get("row"), lambda row: store.__setitem__("row", row),
                                  now=2_000, state=state)
        cold = cached_xai_voices(fetch, lambda: store.get("row"), lambda row: store.__setitem__("row", row),
                                 now=3_000, state={})
        self.assertEqual(fetches, [1])
        self.assertEqual(voices, ["kepler", "eve"])
        self.assertEqual(again, voices)
        self.assertEqual(cold, voices)

        os.environ["XAI_API_KEY"] = "super-secret-key"
        self.addCleanup(os.environ.pop, "XAI_API_KEY", None)
        seen = []

        class Resp:
            headers = {"Content-Type": "audio/mpeg"}

            def read(self):
                return b"mp3"

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def opener(req, timeout=30):
            seen.append(json.loads(req.data.decode()))
            return Resp()

        tts = XaiTTS()
        tts._opener = opener
        tts._concat = lambda blobs: b"|".join(blobs)
        long = "Say LUFS. " * 800
        audio = tts.synthesize(long, "kepler", 1.0, {"LUFS": "luffs"})
        self.assertGreater(len(seen), 1)
        self.assertTrue(all(row["text"].find("LUFS") < 0 for row in seen))
        self.assertIn(b"|", audio)
        self.assertEqual(tts.chars_used, sum(len(row["text"]) for row in seen))
        self.assertNotIn("super-secret-key", json.dumps(seen))

        attempts = {"n": 0}

        def flaky(req, timeout=30):
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise urllib.error.HTTPError(
                    req.full_url, 429, "slow", Message(), io.BytesIO(b"super-secret-key"),
                )
            return Resp()

        tts._opener = flaky
        tts._sleep = lambda _delay: None
        self.assertEqual(tts.synthesize("Hello there.", "kepler", 1.0), b"mp3")
        self.assertEqual(attempts["n"], 3)

        attempts["n"] = 0

        def rejected(req, timeout=30):
            attempts["n"] += 1
            raise urllib.error.HTTPError(
                req.full_url, 400, "bad", Message(), io.BytesIO(b"no super-secret-key"),
            )

        tts._opener = rejected
        with self.assertRaises(RuntimeError) as caught:
            tts.synthesize("Hello.", "kepler", 1.0)
        self.assertEqual(attempts["n"], 1)
        self.assertNotIn("super-secret-key", str(caught.exception))

    def test_rank_covers_three_categories(self):
        from podcast_sogd import rank_stories
        ranked = rank_stories(_stories())
        self.assertTrue(ranked["ok"], ranked["error"] if not ranked["ok"] else "")
        self.assertGreaterEqual(len(ranked["stories"]), 5)
        self.assertLessEqual(len(ranked["stories"]), 8)
        self.assertGreaterEqual(len({row["category"] for row in ranked["stories"]}), 3)
        self.assertTrue(all(row["url"] for row in ranked["stories"]))
        urls = [row["url"].split("?")[0].rstrip("/") for row in ranked["stories"]]
        self.assertEqual(len(urls), len(set(urls)))

    def test_word_count_gate(self):
        from podcast_engine import _word_count
        from podcast_sogd import enforce_word_budget

        def regen(section, need):
            section["turns"][0]["text"] += " " + " ".join(["alpha"] * need)
            return section

        short = enforce_word_budget(
            _script(120),
            word_count=_word_count,
            regenerate_section=regen,
            trim_section=lambda section, extra: section,
            word_min=3800,
            word_max=4300,
        )
        self.assertTrue(short["ok"])
        self.assertGreaterEqual(short["words"], 3800)
        self.assertLessEqual(short["words"], 4300)
        self.assertTrue(any(note["action"] == "regenerate" for note in short["notes"]))

        from podcast_sogd import trim_section_words
        long = enforce_word_budget(
            _script(5000),
            word_count=_word_count,
            regenerate_section=regen,
            trim_section=trim_section_words,
            word_min=3800,
            word_max=4300,
        )
        self.assertTrue(long["ok"])
        self.assertLessEqual(long["words"], 4300)
        self.assertTrue(any(note["action"] == "trim" for note in long["notes"]))

    def test_likeness_guard_rejects_scott_adams(self):
        from podcast_sogd import guard_script, run_daily_episode
        script = _script(tail="Scott Adams")
        self.assertFalse(guard_script(script)["ok"])
        spoken = []
        result = self._run(writer=lambda stories, notes: {"script": script}, synthesize=lambda *args: spoken.append(1) or _audio(*args))
        self.assertEqual(result["status"], "failed")
        self.assertIn("Scott Adams", result["error"])
        self.assertEqual(spoken, [])

    def test_fact_check_drops_and_falls_back(self):
        from podcast_sogd import apply_fact_check, extract_claims, judge_claims, pick_fact_checker, script_text
        script = {
            "sections": [{
                "id": "cold_open",
                "turns": [{"speaker": "kimi", "text": "Alpha is up. Markets held. Rates eased. [unsourced] Beta fell. Gamma held."}],
            }],
        }
        claims = extract_claims(script)
        verdicts = {claim["id"]: {"keep": True} for claim in claims}
        applied = apply_fact_check(script, claims, verdicts)
        self.assertNotIn("[unsourced]", script_text(applied["script"]))
        self.assertTrue(applied["ok"])
        self.assertLessEqual(applied["drop_ratio"], 0.30)
        self.assertTrue(applied["dropped"])

        many = [{"id": f"c{i}", "text": f"Claim {i} stands.", "sourced": i < 6} for i in range(10)]
        failed = apply_fact_check(script, many, {claim["id"]: {"keep": True} for claim in many})
        self.assertFalse(failed["ok"])
        self.assertGreater(failed["drop_ratio"], 0.30)

        def down(*args, **kwargs):
            raise RuntimeError("ollama down")

        def grok_ok(*args, **kwargs):
            return {"c1": {"keep": False}}

        judged = judge_claims([{"id": "c1", "text": "nope", "sourced": True}], [],
                              ollama_ok=True, ollama_fn=down, grok_fn=grok_ok)
        self.assertEqual(judged["provider"], "grok")
        self.assertTrue(judged.get("fallback"))
        self.assertEqual(pick_fact_checker(False), "grok")
        self.assertEqual(pick_fact_checker(True), "ollama")

    def test_disclosure_and_existing_disclaimer(self):
        from podcast_engine import DEFAULT_DISCLAIMER_INTRO, DEFAULT_DISCLAIMER_OUTRO
        from podcast_sogd import DISCLOSURE, ensure_disclosure, script_text
        script = ensure_disclosure(_script(30))
        self.assertTrue(script_text(script).startswith(DISCLOSURE) or DISCLOSURE in script_text(script))
        self.assertIn("not investment advice", DEFAULT_DISCLAIMER_INTRO.lower())
        self.assertIn("not investment advice", DEFAULT_DISCLAIMER_OUTRO.lower())
        source = (ROOT / "podcast_sogd.py").read_text(encoding="utf-8")
        self.assertNotIn("disclaimer_intro", source)
        self.assertIn("synthesize_episode(", source)

    def test_loudnorm_second_pass_uses_measured_values(self):
        from podcast_engine import LOUDNORM_FILTER, loudnorm_apply_filter
        measured = {
            "input_i": "-23.4",
            "input_tp": "-3.1",
            "input_lra": "8.2",
            "input_thresh": "-34.0",
            "target_offset": "0.5",
        }
        second = loudnorm_apply_filter(measured)
        self.assertTrue(second.startswith(LOUDNORM_FILTER))
        self.assertIn("measured_I=-23.4", second)
        self.assertIn("measured_TP=-3.1", second)
        self.assertIn("measured_LRA=8.2", second)
        self.assertIn("measured_thresh=-34.0", second)
        self.assertIn("offset=0.5", second)
        self.assertIn("linear=true", second)
        source = (ROOT / "podcast_engine.py").read_text(encoding="utf-8")
        self.assertIn("loudnorm_apply_filter(measured)", source)
        self.assertIn("LOUDNORM_FILTER}:print_format=json", source)

    def test_schedule_dst_hold_and_feed_filter(self):
        from podcast_feed import render_show_feed
        from podcast_sogd import plan_tick, publish_decision
        tz = ZoneInfo("America/Los_Angeles")
        spring = datetime(2026, 3, 8, 6, 35, tzinfo=tz)
        self.assertEqual(spring.utcoffset(), timedelta(hours=-7))
        self.assertEqual(plan_tick(spring, None)["action"], "generate")
        self.assertEqual(plan_tick(datetime(2026, 3, 8, 6, 30, tzinfo=tz), None)["action"], "sleep")
        pending = {
            "status": "ready_pending",
            "published_at": datetime(2026, 3, 8, 7, 0, tzinfo=tz),
        }
        self.assertEqual(plan_tick(datetime(2026, 3, 8, 6, 50, tzinfo=tz), pending)["reason"], "hold")
        self.assertEqual(plan_tick(datetime(2026, 3, 8, 7, 0, tzinfo=tz), pending)["action"], "release")
        fall = datetime(2026, 11, 1, 6, 35, tzinfo=tz)
        self.assertEqual(fall.utcoffset(), timedelta(hours=-8))
        self.assertEqual(plan_tick(fall, None)["action"], "generate")

        early = publish_decision(
            datetime(2026, 10, 26, 6, 50, tzinfo=tz),
            datetime(2026, 10, 26, 7, 0, tzinfo=tz),
            auto_publish=True,
        )
        self.assertEqual(early["status"], "ready_pending")
        self.assertEqual(early["published_at"].hour, 7)
        late = publish_decision(
            datetime(2026, 10, 26, 7, 12, tzinfo=tz),
            datetime(2026, 10, 26, 7, 0, tzinfo=tz),
            auto_publish=True,
        )
        self.assertEqual(late["status"], "published")
        self.assertEqual(late["published_at"].hour, 7)
        self.assertEqual(late["published_at"].minute, 12)

        held = self._run(now=datetime(2026, 10, 26, 6, 50, tzinfo=tz))
        self.assertEqual(held["status"], "ready_pending")
        self.assertEqual(held["published_at"].astimezone(tz).hour, 7)
        finished_late = self._run(now=datetime(2026, 10, 26, 7, 12, tzinfo=tz))
        self.assertEqual(finished_late["status"], "published")

        past = datetime.now(timezone.utc) - timedelta(hours=1)
        future = datetime.now(timezone.utc) + timedelta(hours=2)
        hidden = render_show_feed("systems-over-goals", [
            {"episode_guid": "hold-1", "title": "Held", "published_at": past, "byte_size": 100, "status": "ready_pending"},
            {"episode_guid": "future-1", "title": "Future", "published_at": future, "byte_size": 100, "status": "published"},
            {"episode_guid": "live-1", "title": "Live", "published_at": past, "byte_size": 100, "status": "published"},
        ], request_base="https://example.test")
        self.assertNotIn("hold-1", hidden)
        self.assertNotIn("future-1", hidden)
        self.assertIn("live-1", hidden)

    def test_one_per_date_and_cost_cap(self):
        from podcast_sogd import date_guard, run_daily_episode
        self.assertFalse(date_guard({"status": "published"})["ok"])
        self.assertTrue(date_guard({"status": "failed"})["ok"])
        self.assertTrue(date_guard({"status": "published"}, force=True)["ok"])

        calls = []

        def scout(day):
            calls.append(day)
            return {"stories": _stories(), "usage": {}}

        skipped = run_daily_episode(
            date(2026, 10, 26),
            existing={"status": "published"},
            scout=scout,
        )
        self.assertEqual(skipped["status"], "skipped")
        self.assertEqual(calls, [])

        stored = []
        replaced = self._run(force=True, existing={"status": "published"}, store_put=stored.append)
        self.assertNotEqual(replaced["status"], "skipped")
        self.assertEqual(len(stored), 1)

        def expensive(day):
            return {"stories": _stories(), "usage": {"cost_usd": 41}}

        lens_calls = []
        capped = run_daily_episode(
            date(2026, 10, 26),
            cost_cap=40,
            scout=expensive,
            lens=lambda stories: lens_calls.append(1) or {"notes": []},
            writer=lambda stories, notes: {"script": _script()},
            fact_checker=lambda claims, stories, provider: {"verdicts": {}, "usage": {}},
            synthesize=_audio,
            store_put=stored.append,
        )
        self.assertEqual(capped["status"], "cost_cap_hit")
        self.assertEqual(lens_calls, [])
        self.assertEqual(len(stored), 1)

        blocked = run_daily_episode(
            date(2026, 10, 26),
            month_spend=40,
            cost_cap=40,
            scout=lambda day: calls.append("nope") or {"stories": _stories()},
        )
        self.assertEqual(blocked["status"], "cost_cap_hit")
        self.assertNotIn("nope", calls)

    def test_voice_defaults_round_trip_and_routes(self):
        from podcast_sogd import default_voice, normalize_voice
        base = default_voice("systems-over-goals")
        self.assertEqual(base["provider"], "xai")
        self.assertEqual(base["voice"], "kepler")
        saved = normalize_voice({"provider": "xai", "voice": "Kepler", "speed": 1})
        self.assertEqual(normalize_voice(saved), saved)
        retired = normalize_voice({"provider": "openai", "voice": "onyx", "speed": 1})
        self.assertEqual(retired["provider"], "xai")
        self.assertEqual(retired["voice"], "kepler")
        self.assertEqual(default_voice("dga-hitech")["voice"], "leo")
        server = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
        engine = (ROOT / "podcast_sogd.py").read_text(encoding="utf-8")
        self.assertIn('"/api/podcast/{show}/voice"', server)
        self.assertIn('"/api/podcast/tts/voices"', server)
        self.assertIn('"/api/podcast/tts/preview"', server)
        self.assertIn("generate-daily", server)
        self.assertIn("status IS NULL OR status = 'published'", server)
        self.assertIn("_sogd_scheduler_worker", server)
        self.assertIn("pg_try_advisory_lock", engine)
        self.assertIn("analyst_podcast_episodes_show_date", engine)
        self.assertIn("podcast_runs", engine)

    def _run(self, **overrides):
        from podcast_sogd import run_daily_episode

        def keep(claims, stories, provider):
            return {"verdicts": {claim["id"]: {"keep": True} for claim in claims}, "usage": {}}

        kwargs = dict(
            force=False,
            existing=None,
            month_spend=0,
            cost_cap=40,
            scout=lambda day: {"stories": _stories(), "usage": {"cost_usd": 0.1, "x_search_calls": 1}},
            lens=lambda stories: {"notes": [], "usage": {"cost_usd": 0.1}},
            writer=lambda stories, notes: {"script": _script(), "usage": {"cost_usd": 0.2}},
            fact_checker=keep,
            ollama_ok=False,
            synthesize=_audio,
        )
        kwargs.update(overrides)
        return run_daily_episode(date(2026, 10, 26), **kwargs)


if __name__ == "__main__":
    unittest.main()
