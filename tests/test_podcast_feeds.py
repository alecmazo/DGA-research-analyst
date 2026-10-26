"""Podcast feed, media URL, and TTS provider checks. unittest only."""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PodcastFeedTests(unittest.TestCase):
    def setUp(self):
        self._env = {
            k: os.environ.get(k)
            for k in (
                "PODCAST_MEDIA_BASE_URL",
                "PODCAST_FEED_BASE_URL",
                "PODCAST_RSS_OWNER_EMAIL",
                "PODCAST_RSS_TITLE",
                "PODCAST_TTS_PROVIDER",
                "PODCAST_MEDIA_STORE",
                "PODCAST_MEDIA_DIR",
            )
        }
        for key in self._env:
            os.environ.pop(key, None)

    def tearDown(self):
        for key, val in self._env.items():
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val

    def test_guid_unique_across_regenerations(self):
        from podcast_feed import mint_episode_guid, render_show_feed

        first = mint_episode_guid()
        second = mint_episode_guid()
        self.assertNotEqual(first, second)
        uuid.UUID(first)
        uuid.UUID(second)
        now = datetime.now(timezone.utc)
        xml = render_show_feed(
            "dga-hitech",
            [
                _episode(first, now),
                _episode(second, now + timedelta(minutes=1)),
            ],
            request_base="https://portfolio.dgacapital.com",
            media_base="https://cdn.example/audio",
            feed_base="",
        )
        self.assertEqual(xml.count("<guid"), 2)
        self.assertIn(first, xml)
        self.assertIn(second, xml)
        self.assertLess(xml.index(second), xml.index(first))

    def test_legacy_guid_preserved(self):
        from podcast_feed import legacy_episode_guid, render_show_feed

        guid = legacy_episode_guid("intc", "debate")
        self.assertEqual(guid, "INTC::debate")
        xml = render_show_feed(
            "dga-hitech",
            [_episode(guid, datetime.now(timezone.utc))],
            request_base="https://portfolio.dgacapital.com",
            media_base="",
            feed_base="",
        )
        self.assertIn(">INTC::debate</guid>", xml)
        server = (ROOT / "api/server.py").read_text(encoding="utf-8")
        self.assertIn("ticker || '::' || COALESCE(format, 'debate')", server)

    def test_enclosure_length_positive_and_media_base(self):
        from podcast_feed import render_show_feed

        os.environ["PODCAST_MEDIA_BASE_URL"] = "https://cdn.example/audio"
        xml = render_show_feed(
            "dga-hitech",
            [
                _episode("11111111-1111-4111-8111-111111111111", datetime.now(timezone.utc), byte_size=0),
                _episode("22222222-2222-4222-8222-222222222222", datetime.now(timezone.utc), byte_size=48211),
            ],
            request_base="https://portfolio.dgacapital.com",
            feed_base="",
        )
        self.assertNotIn('length="0"', xml)
        self.assertIn('length="48211"', xml)
        self.assertIn(
            "https://cdn.example/audio/dga-hitech/22222222-2222-4222-8222-222222222222.mp3",
            xml,
        )
        self.assertNotIn("11111111-1111-4111-8111-111111111111", xml)

    def test_required_tags_owner_and_alias(self):
        from podcast_feed import UnknownShow, render_show_feed
        from podcast_shows import stable_podcast_guid

        eps = [_episode("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", datetime.now(timezone.utc))]
        kwargs = dict(
            request_base="https://portfolio.dgacapital.com",
            media_base="https://cdn.example/audio",
            feed_base="",
        )
        alias = render_show_feed(None, eps, **kwargs)
        named = render_show_feed("dga-hitech", eps, **kwargs)
        self.assertEqual(alias, named)
        for needle in (
            "xmlns:itunes=",
            "xmlns:podcast=",
            "xmlns:atom=",
            "xmlns:content=",
            "itunes:owner",
            "alecmazo1@gmail.com",
            "itunes:type",
            "podcast:locked",
            "podcast:guid",
            'isPermaLink="false"',
            "itunes:episodeType",
            "itunes:explicit",
            "atom:link",
            "en-us",
        ):
            self.assertIn(needle, alias)
        self.assertNotIn("itunes:block", alias)
        self.assertIn(stable_podcast_guid("dga-hitech"), alias)
        self.assertEqual(
            stable_podcast_guid("dga-hitech"),
            "5eaa1fec-3a22-5494-b4f2-29e9f54c582a",
        )
        empty = render_show_feed("systems-over-goals", [], **kwargs)
        self.assertIn("Systems Over Goals Daily", empty)
        self.assertNotIn("<item>", empty)
        with self.assertRaises(UnknownShow):
            render_show_feed("not-a-show", [], **kwargs)

    def test_server_routes_share_one_renderer(self):
        src = (ROOT / "api/server.py").read_text(encoding="utf-8")
        self.assertIn("analyst_podcast_episodes", src)
        self.assertIn("mint_episode_guid", src)
        self.assertNotIn('length="0"', src)
        self.assertIn('def podcast_rss_feed', src)
        self.assertIn('def podcast_show_rss', src)
        self.assertIn("return _podcast_feed_response(None, request)", src)
        self.assertIn("return _podcast_feed_response(show, request)", src)
        self.assertIn('raise HTTPException(404, "unknown show")', src)
        self.assertIn('path.endswith("/rss.xml")', src)

    def test_media_store_uses_base_url(self):
        from podcast_media import get_media_store

        tmp = tempfile.mkdtemp()
        os.environ["PODCAST_MEDIA_STORE"] = "local"
        os.environ["PODCAST_MEDIA_DIR"] = tmp
        os.environ["PODCAST_MEDIA_BASE_URL"] = "https://cdn.example/audio"
        store = get_media_store()
        store.put("dga-hitech/abc.mp3", b"ID3fake")
        self.assertEqual(store.size("dga-hitech/abc.mp3"), 7)
        self.assertEqual(
            store.url("dga-hitech/abc.mp3"),
            "https://cdn.example/audio/dga-hitech/abc.mp3",
        )
        self.assertTrue((Path(tmp) / "dga-hitech" / "abc.mp3").is_file())

    def test_tts_provider_selection_and_voices(self):
        from podcast_tts import KokoroLocalTTS, OpenAITTS, XaiTTS, get_provider

        os.environ.pop("PODCAST_TTS_PROVIDER", None)
        mini = get_provider("gpt-4o-mini-tts")
        self.assertIsInstance(mini, OpenAITTS)
        self.assertEqual(mini.model, "gpt-4o-mini-tts")
        self.assertIn("ballad", mini.voices())
        hd = get_provider("tts-1-hd")
        self.assertNotIn("ballad", hd.voices())
        self.assertIn("alloy", hd.voices())

        os.environ["PODCAST_TTS_PROVIDER"] = "kokoro"
        self.assertIsInstance(get_provider(), KokoroLocalTTS)
        os.environ["PODCAST_TTS_PROVIDER"] = "xai"
        xai = get_provider()
        self.assertIsInstance(xai, XaiTTS)
        self.assertIn("eve", xai.voices())

    def test_loudnorm_filter_string(self):
        from podcast_engine import LOUDNORM_FILTER, apply_loudnorm

        self.assertEqual(LOUDNORM_FILTER, "loudnorm=I=-16:TP=-1.5:LRA=11")
        src = Path(podcast_engine_source()).read_text(encoding="utf-8")
        self.assertIn("LOUDNORM_FILTER}:print_format=json", src)
        self.assertIn("measured_I=", src)
        self.assertIn('"-ar", "44100"', src)
        self.assertIn('"-b:a", "128k"', src)
        self.assertTrue(callable(apply_loudnorm))


def podcast_engine_source() -> Path:
    return ROOT / "podcast_engine.py"


def _episode(guid: str, when: datetime, byte_size: int = 12000) -> dict:
    return {
        "episode_guid": guid,
        "ticker": "INTC",
        "format": "debate",
        "title": "Intel",
        "summary": "A note.",
        "published_at": when,
        "duration_sec": 600,
        "byte_size": byte_size,
    }


if __name__ == "__main__":
    unittest.main()
