"""Pilot episode, feed block, and the Systems Over Goals Daily style guide."""
from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SogdPilotTests(unittest.TestCase):
    def test_pilot_feed_has_guid_length_duration_and_block(self):
        from podcast_feed import render_show_feed
        from podcast_sogd import (
            PILOT_BYTE_SIZE,
            PILOT_DESCRIPTION,
            PILOT_DURATION_SEC,
            PILOT_GUID,
            PILOT_SHOW_NOTES,
            pilot_episode,
        )

        xml = render_show_feed(
            "systems-over-goals",
            [pilot_episode()],
            request_base="https://portfolio.dgacapital.com",
            media_base="https://cdn.example/audio",
            feed_base="https://portfolio.dgacapital.com",
        )
        self.assertIn(PILOT_GUID, xml)
        self.assertIn(f'length="{PILOT_BYTE_SIZE}"', xml)
        self.assertIn(f">{PILOT_DURATION_SEC}<", xml)
        self.assertIn("<itunes:block>Yes</itunes:block>", xml)
        self.assertIn("<itunes:episode>1</itunes:episode>", xml)
        self.assertIn('isPermaLink="false"', xml)
        self.assertIn("Tue, 27 Oct 2026 14:00:00 +0000", xml)
        self.assertIn("Daily News", xml)
        self.assertIn(PILOT_DESCRIPTION, xml)
        self.assertIn("Iran: deal or strike", xml)
        self.assertIn(PILOT_SHOW_NOTES.splitlines()[0], xml)
        self.assertNotIn("exempt reporting adviser", xml)
        self.assertIn(
            f"https://cdn.example/audio/systems-over-goals/{PILOT_GUID}.mp3",
            xml,
        )

    def test_hitech_alias_and_unknown_show(self):
        from podcast_feed import UnknownShow, render_show_feed
        from podcast_sogd import PILOT_GUID

        kwargs = dict(
            request_base="https://portfolio.dgacapital.com",
            media_base="",
            feed_base="",
        )
        alias = render_show_feed(None, [], **kwargs)
        named = render_show_feed("dga-hitech", [], **kwargs)
        self.assertEqual(alias, named)
        self.assertIn("DGA HiTech Podcast", alias)
        self.assertNotIn(PILOT_GUID, alias)
        with self.assertRaises(UnknownShow):
            render_show_feed("not-a-show", [], **kwargs)
        server = (ROOT / "api/server.py").read_text(encoding="utf-8")
        self.assertIn('"/api/podcast/{show}/rss.xml"', server)
        self.assertIn('raise HTTPException(404, "unknown show")', server)
        self.assertIn("return _podcast_feed_response(None, request)", server)

    def test_import_guid_is_stable(self):
        import podcast_sogd as sogd

        blob = b"pilot-bytes-for-the-idempotent-import"
        saved_size = sogd.PILOT_BYTE_SIZE
        saved_md5 = sogd.PILOT_MD5
        sogd.PILOT_BYTE_SIZE = len(blob)
        sogd.PILOT_MD5 = hashlib.md5(blob).hexdigest()
        puts = []
        sql = []

        class Store:
            def put(self, key, data):
                puts.append((key, data))

            def local_path(self, key):
                return None

            def dropbox_path(self, key):
                return ""

        class Conn:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def cursor(self):
                return self

            def execute(self, statement, params=None):
                sql.append((statement, params))

            def commit(self):
                sql.append(("COMMIT", None))

        try:
            folder = Path(tempfile.mkdtemp())
            audio = folder / "pilot.mp3"
            audio.write_bytes(blob)
            store = Store()
            first = sogd.import_sogd_pilot(path=audio, connect=lambda: Conn(), store=store)
            second = sogd.import_sogd_pilot(path=audio, connect=lambda: Conn(), store=store)
        finally:
            sogd.PILOT_BYTE_SIZE = saved_size
            sogd.PILOT_MD5 = saved_md5

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertEqual(first["episode_guid"], sogd.PILOT_GUID)
        self.assertEqual(second["episode_guid"], sogd.PILOT_GUID)
        self.assertEqual(first["status"], "published")
        self.assertEqual(puts[0][0], puts[1][0])
        self.assertEqual(puts[0][0], f"systems-over-goals/{sogd.PILOT_GUID}.mp3")
        inserts = [params for statement, params in sql if params and "INSERT INTO analyst_podcast_episodes" in statement]
        self.assertEqual(len(inserts), 2)
        self.assertEqual(inserts[0][0], sogd.PILOT_GUID)
        self.assertEqual(inserts[1][0], sogd.PILOT_GUID)

        missing = sogd.import_sogd_pilot(
            path=folder / "missing.mp3",
            connect=lambda: (_ for _ in ()).throw(AssertionError("db")),
            store=Store(),
        )
        self.assertFalse(missing["ok"])
        self.assertEqual(missing["status"], "missing")
        self.assertEqual(missing["episode_guid"], sogd.PILOT_GUID)

    def test_style_guide_constants(self):
        from podcast_sogd import SOGD_STYLE, SOGD_STYLE_GUIDE, style_prompt, word_bounds

        self.assertIs(SOGD_STYLE_GUIDE, SOGD_STYLE)
        self.assertEqual(SOGD_STYLE["stories_min"], 4)
        self.assertEqual(SOGD_STYLE["stories_max"], 5)
        self.assertEqual(word_bounds(), (3700, 4400))
        self.assertEqual(SOGD_STYLE["voice"], "kepler")
        self.assertTrue(SOGD_STYLE["text_normalization"])
        self.assertEqual(SOGD_STYLE["pause"], "[pause]")
        self.assertEqual(SOGD_STYLE["long_pause"], "[long-pause]")
        self.assertEqual(SOGD_STYLE["breath_max"], 2)
        self.assertEqual(SOGD_STYLE["speed_min"], 0.96)
        self.assertEqual(SOGD_STYLE["speed_max"], 1.02)
        self.assertEqual(SOGD_STYLE["opening_speed"], 0.97)
        self.assertEqual(SOGD_STYLE["gap_within_story"], (0.45, 1.1))
        self.assertEqual(SOGD_STYLE["gap_recap"], (1.0, 1.5))
        self.assertEqual(SOGD_STYLE["gap_between_stories"], (1.6, 2.2))
        self.assertEqual(SOGD_STYLE["gap_preview"], (1.2, 1.6))
        self.assertEqual(SOGD_STYLE["pad_sec"], 1.5)
        self.assertEqual(SOGD_STYLE["highpass_hz"], 70)
        self.assertEqual(SOGD_STYLE["lufs"], -16)
        self.assertEqual(SOGD_STYLE["peak_dbtp"], -1.5)
        self.assertEqual(SOGD_STYLE["bitrate_kbps"], 96)
        self.assertEqual(SOGD_STYLE["channels"], 1)
        self.assertLessEqual(SOGD_STYLE["max_bytes"], 25 * 1024 * 1024)
        self.assertEqual(SOGD_STYLE["publish_local"], "07:00")
        prompt = style_prompt()
        self.assertIn("Good morning", prompt)
        self.assertIn("No AI disclosure at the top", prompt)
        self.assertIn("[long-pause]", prompt)
        self.assertIn("[breath]", prompt)
        self.assertEqual(SOGD_STYLE["prompt"], prompt)
        source = (ROOT / "podcast_sogd.py").read_text(encoding="utf-8")
        self.assertIn('SOGD_STYLE["prompt"]', source)
        self.assertIn("master_sogd_mp3", source)
        page = (ROOT / "web/gp-app/src/pages/PodcastsPage.tsx").read_text(encoding="utf-8")
        self.assertIn("Spotify off. Apple off.", page)
        daily = (ROOT / "web/gp-app/src/pages/podcasts/SogdDaily.tsx").read_text(encoding="utf-8")
        self.assertIn("show_notes", daily)

    def test_varied_intros_and_optional_voice_rotation(self):
        from datetime import date, timedelta
        from podcast_sogd import (
            SOGD_STYLE,
            _script_payload,
            intro_prompt,
            intro_style_for_date,
            voice_for_day,
        )
        from tests.test_sogd_pipeline import _audio, _script, _stories

        ids = [row["id"] for row in SOGD_STYLE["intros"]]
        self.assertEqual(ids, ["classic", "cold_open", "question", "preview"])
        self.assertEqual(SOGD_STYLE["voice_mode"], "fixed")
        self.assertEqual(SOGD_STYLE["voice_pool"], ("kepler", "eve", "orion", "lux"))
        monday = date(2026, 10, 26)
        styles = [intro_style_for_date(monday + timedelta(days=i)) for i in range(7)]
        style_ids = [row["id"] for row in styles]
        self.assertEqual(style_ids[0], "classic")
        self.assertTrue(all(a != b for a, b in zip(style_ids, style_ids[1:])))
        self.assertLessEqual(sum(1 for row in styles if row["explain_show"]), 2)
        self.assertEqual(intro_style_for_date(monday)["id"], intro_style_for_date(monday)["id"])
        skipped = intro_style_for_date(monday, recent=["classic"])
        self.assertNotEqual(skipped["id"], "classic")
        brief = intro_prompt(date(2026, 10, 27), ["classic", "question"])
        self.assertIn("Last intros: classic, question", brief)
        self.assertIn("Today's intro style is", brief)

        saved = {"provider": "xai", "voice": "ara", "speed": 1.0, "voice_mode": "fixed"}
        held = voice_for_day(saved, date(2026, 10, 27), mode="fixed")
        self.assertEqual(held["voice"], "ara")
        spun = voice_for_day({**saved, "voice_mode": "rotate"}, date(2026, 10, 27))
        again = voice_for_day({**saved, "voice_mode": "rotate"}, date(2026, 10, 27))
        other = voice_for_day({**saved, "voice_mode": "rotate"}, date(2026, 10, 28))
        self.assertEqual(spun["voice"], again["voice"])
        self.assertIn(spun["voice"], SOGD_STYLE["voice_pool"])
        self.assertNotEqual(spun["voice"], other["voice"])
        override = voice_for_day(
            {**saved, "voice_mode": "rotate", "voice_override": "lux"},
            date(2026, 10, 27),
        )
        self.assertEqual(override["voice"], "lux")

        def keep(claims, stories, provider):
            return {"verdicts": {claim["id"]: {"keep": True} for claim in claims}, "usage": {}}

        from podcast_sogd import run_daily_episode
        common = dict(
            existing=None,
            month_spend=0,
            cost_cap=40,
            scout=lambda day: {"stories": _stories(), "usage": {}},
            lens=lambda stories: {"notes": [], "usage": {}},
            writer=lambda stories, notes: {"script": _script(), "usage": {}},
            fact_checker=keep,
            ollama_ok=False,
            synthesize=_audio,
        )
        monday_run = run_daily_episode(monday, **common)
        tuesday_run = run_daily_episode(monday + timedelta(days=1), **common)
        self.assertTrue(monday_run["ok"], monday_run.get("error"))
        self.assertEqual(monday_run["intro_style"], "classic")
        self.assertNotEqual(monday_run["intro_style"], tuesday_run["intro_style"])
        self.assertEqual(_script_payload(monday_run)["intro_style"], "classic")

        page = (ROOT / "web/gp-app/src/pages/podcasts/SogdDaily.tsx").read_text(encoding="utf-8")
        self.assertIn("Voice mode", page)
        self.assertIn("ChapterPlayer", page)

    def test_chapters_skip_by_topic(self):
        from podcast_feed import CHAPTERS_MEDIA_TYPE, render_show_feed
        from podcast_sogd import (
            PILOT_GUID,
            chapters_document,
            chapters_from_row,
            chapters_public_body,
            chapter_notes_prefix,
            pilot_episode,
        )

        episode = pilot_episode()
        chapters = episode["chapters"]
        starts = [row["startTime"] for row in chapters]
        self.assertEqual(starts[0], 0)
        self.assertTrue(all(isinstance(start, float) and start == start for start in starts))
        self.assertTrue(all(b > a for a, b in zip(starts, starts[1:])))
        self.assertTrue(all(start < 1430 for start in starts))
        self.assertTrue(all(row["title"] for row in chapters))
        prefix = chapter_notes_prefix(chapters)
        self.assertEqual(
            prefix,
            "\n".join([
                "00:00 Intro & today's five stories",
                "01:43 1. Iran: deal or strike",
                "07:09 2. Israel votes",
                "11:11 3. The Fed, one week out",
                "14:51 4. Anthropic goes public",
                "18:35 5. Ebola and your next flight",
                "22:11 Wrap: Oleshky ceasefire & close",
            ]),
        )
        document = chapters_document(chapters)
        self.assertEqual(document["version"], "1.2.0")
        self.assertEqual(CHAPTERS_MEDIA_TYPE, "application/json+chapters")
        self.assertTrue(all(isinstance(row["startTime"], float) and row["title"] for row in document["chapters"]))
        self.assertEqual(chapters_public_body(chapters), document)
        self.assertIsNone(chapters_public_body(None))
        self.assertIsNone(chapters_public_body([]))
        self.assertEqual(chapters_from_row({"show_notes": "1. **Nope**", "duration_sec": 30}), [])

        xml = render_show_feed(
            "systems-over-goals",
            [episode],
            request_base="https://portfolio.dgacapital.com",
            media_base="https://cdn.example/audio",
            feed_base="https://portfolio.dgacapital.com",
        )
        chapter_url = (
            "https://portfolio.dgacapital.com/api/podcast/systems-over-goals/"
            f"episodes/{PILOT_GUID}/chapters.json"
        )
        self.assertIn(f'<podcast:chapters url="{chapter_url}" type="application/json+chapters"/>', xml)
        self.assertGreaterEqual(xml.count("00:00 Intro & today's five stories"), 2)
        self.assertIn(prefix, xml)
        bare = dict(episode)
        bare["chapters"] = []
        quiet = render_show_feed(
            "systems-over-goals",
            [bare],
            request_base="https://portfolio.dgacapital.com",
            media_base="https://cdn.example/audio",
            feed_base="https://portfolio.dgacapital.com",
        )
        self.assertNotIn("podcast:chapters", quiet)
        hitech = render_show_feed(
            "dga-hitech",
            [{
                "episode_guid": "no-chapters",
                "title": "HiTech",
                "summary": "No chapters here",
                "byte_size": 1200,
                "duration_sec": 40,
            }],
            request_base="https://portfolio.dgacapital.com",
            media_base="https://cdn.example/audio",
            feed_base="https://portfolio.dgacapital.com",
        )
        self.assertNotIn("podcast:chapters", hitech)
        server = (ROOT / "api/server.py").read_text(encoding="utf-8")
        self.assertIn('"/api/podcast/{show}/episodes/{guid}/chapters.json"', server)
        self.assertIn("CHAPTERS_MEDIA_TYPE", server)
        self.assertIn('raise HTTPException(404, "not found")', server)
        player = (ROOT / "web/gp-app/src/pages/podcasts/ChapterPlayer.tsx").read_text(encoding="utf-8")
        hitech_page = (ROOT / "web/gp-app/src/pages/PodcastsPage.tsx").read_text(encoding="utf-8")
        self.assertIn("Skip to", player)
        self.assertIn("Previous chapter", player)
        self.assertIn("Next chapter", player)
        self.assertIn("chapterOn", player)
        self.assertIn("ChapterPlayer", hitech_page)
        import inspect
        import podcast_sogd as sogd
        self.assertNotIn("write_chapter_id3", inspect.getsource(sogd.import_sogd_pilot))
        self.assertNotIn("master_sogd_mp3", inspect.getsource(sogd.import_sogd_pilot))


if __name__ == "__main__":
    unittest.main()
