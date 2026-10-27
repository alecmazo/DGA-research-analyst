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
        from datetime import date
        from podcast_sogd import (
            SOGD_STYLE,
            intro_for_date,
            voice_for_day,
        )

        first = intro_for_date(date(2026, 10, 27))
        second = intro_for_date(date(2026, 10, 28))
        self.assertNotEqual(first, second)
        self.assertEqual(first, intro_for_date(date(2026, 10, 27)))
        self.assertIn(first, SOGD_STYLE["intros"])
        self.assertGreaterEqual(len(SOGD_STYLE["intros"]), 4)
        self.assertFalse(SOGD_STYLE["voice_rotation"])
        saved = {"provider": "xai", "voice": "kepler", "speed": 1.0}
        held = voice_for_day(saved, date(2026, 10, 27), rotate=False)
        self.assertEqual(held["voice"], "kepler")
        spun = voice_for_day({**saved, "rotate": True}, date(2026, 10, 27))
        other = voice_for_day({**saved, "rotate": True}, date(2026, 10, 28))
        self.assertIn(spun["voice"], SOGD_STYLE["voice_pool"])
        self.assertNotEqual(spun["voice"], other["voice"])
        source = (ROOT / "podcast_sogd.py").read_text(encoding="utf-8")
        self.assertIn("intro_for_date", source)
        page = (ROOT / "web/gp-app/src/pages/podcasts/SogdDaily.tsx").read_text(encoding="utf-8")
        self.assertIn("Rotate the voice", page)

    def test_chapters_skip_by_topic(self):
        from podcast_feed import render_show_feed
        from podcast_sogd import (
            PILOT_GUID,
            PILOT_SHOW_NOTES,
            chapters_document,
            pilot_episode,
            resolve_chapters,
        )

        chapters = resolve_chapters(PILOT_SHOW_NOTES, 1430, None)
        titles = [row["title"] for row in chapters]
        self.assertEqual(chapters[0]["startTime"], 0)
        self.assertIn("Iran: deal or strike", titles)
        self.assertIn("Israel votes", titles)
        self.assertIn("The Fed, one week out", titles)
        self.assertIn("Anthropic IPO", titles)
        self.assertIn("Ebola", titles)
        self.assertIn("Oleshky ceasefire", titles)
        self.assertLess(chapters[-1]["startTime"], 1430)
        self.assertEqual(chapters_document(chapters)["version"], "1.2.0")
        xml = render_show_feed(
            "systems-over-goals",
            [pilot_episode()],
            request_base="https://portfolio.dgacapital.com",
            media_base="https://cdn.example/audio",
            feed_base="https://portfolio.dgacapital.com",
        )
        self.assertIn("podcast:chapters", xml)
        self.assertIn(f"/api/podcast/systems-over-goals/{PILOT_GUID}/chapters.json", xml)
        server = (ROOT / "api/server.py").read_text(encoding="utf-8")
        self.assertIn('"/chapters.json"', server)
        page = (ROOT / "web/gp-app/src/pages/podcasts/SogdDaily.tsx").read_text(encoding="utf-8")
        self.assertIn("Skip to", page)


if __name__ == "__main__":
    unittest.main()
