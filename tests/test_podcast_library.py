"""Manual episode upload and erase. No production database."""
from __future__ import annotations

import unittest
from pathlib import Path

import podcast_library as lib

ROOT = Path(__file__).resolve().parents[1]


class MemStore:
    def __init__(self):
        self.files = {}
        self.deleted = []

    def put(self, key, data):
        self.files[key] = data

    def delete(self, key):
        self.deleted.append(key)
        self.files.pop(key, None)

    def local_path(self, key):
        return None

    def dropbox_path(self, key):
        return None


class FakeCursor:
    def __init__(self, row=None):
        self.row = row
        self.ops = []
        self.description = []

    def execute(self, sql, params=None):
        compact = " ".join(sql.split())
        self.ops.append((compact, params))
        if compact.startswith("SELECT"):
            self.description = [
                ("episode_guid",),
                ("media_key",),
                ("audio_local_path",),
                ("audio_dropbox_path",),
            ]
        else:
            self.description = []

    def fetchone(self):
        return self.row


class FakeConn:
    def __init__(self, row=None):
        self.cur = FakeCursor(row)
        self.committed = False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _mp3(seconds_of_128k: int = 1) -> bytes:
    header = bytes.fromhex("fffb9000")
    audio = header + b"\x00" * (128000 // 8 * seconds_of_128k)
    tag = b"ID3" + b"\x04\x00\x00" + b"\x00\x00\x00\x00"
    return tag + audio


class PodcastLibraryTests(unittest.TestCase):
    def test_upload_publishes_without_taking_the_daily_date(self):
        store = MemStore()
        conn = FakeConn()
        result = lib.upload_episode(
            "systems-over-goals",
            _mp3(),
            "Grok Bot Episode.mp3",
            connect=lambda: conn,
            store=store,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["title"], "Grok Bot Episode")
        self.assertEqual(result["show"], "systems-over-goals")
        self.assertGreater(result["duration_sec"], 0.5)
        self.assertEqual(len(store.files), 1)
        insert = conn.cur.ops[-1]
        self.assertIn("episode_date", insert[0])
        self.assertIn("NULL", insert[0])
        self.assertIn("'published'", insert[0])
        self.assertGreater(insert[1][6], 0.5)
        self.assertTrue(conn.committed)

    def test_upload_keeps_title_and_guid_when_the_file_matches(self):
        guid = "11546341-0cb4-5cda-8267-26668ac6a3cc"
        blob = _mp3()
        store = MemStore()
        store.files[f"systems-over-goals/{guid}.mp3"] = blob
        store.get = lambda key: store.files.get(key)
        conn = FakeConn({
            "episode_guid": guid,
            "episode_title": "Systems Over Goals Daily — Oct 27, 2026: Iran's deal-or-strike moment (Pilot)",
            "published_at": "2026-10-27T14:00:00+00:00",
            "byte_size": len(blob),
            "media_key": f"systems-over-goals/{guid}.mp3",
            "duration_sec": 1430,
        })
        result = lib.upload_episode(
            "systems-over-goals",
            blob,
            "systems-over-goals-daily_pilot_2026-10-27_v4_kepler.mp3",
            connect=lambda: conn,
            store=store,
        )
        self.assertTrue(result["kept"])
        self.assertEqual(result["episode_guid"], guid)
        self.assertIn("Iran", result["title"])
        self.assertFalse(any(op[0].startswith("INSERT") for op in conn.cur.ops))

    def test_upload_rejects_a_non_mp3_and_an_unknown_show(self):
        store = MemStore()
        conn = FakeConn()
        with self.assertRaises(lib.UploadRejected):
            lib.upload_episode(
                "systems-over-goals",
                b"not audio",
                "notes.txt",
                connect=lambda: conn,
                store=store,
            )
        self.assertEqual(store.files, {})
        with self.assertRaises(LookupError):
            lib.upload_episode(
                "no-such-show",
                _mp3(),
                "episode.mp3",
                connect=lambda: conn,
                store=store,
            )

    def test_erase_deletes_the_row_and_the_file(self):
        guid = "11546341-0cb4-5cda-8267-26668ac6a3cc"
        store = MemStore()
        store.files[f"systems-over-goals/{guid}.mp3"] = b"mp3"
        conn = FakeConn({
            "episode_guid": guid,
            "media_key": f"systems-over-goals/{guid}.mp3",
            "audio_local_path": "",
            "audio_dropbox_path": "",
        })
        result = lib.erase_episode(
            "systems-over-goals",
            guid,
            connect=lambda: conn,
            store=store,
        )
        self.assertTrue(result["ok"])
        sql = " ".join(op[0] for op in conn.cur.ops)
        self.assertIn("DELETE FROM analyst_podcast_episodes", sql)
        self.assertIn("DELETE FROM analyst_podcasts", sql)
        self.assertIn(f"systems-over-goals/{guid}.mp3", store.deleted)
        self.assertTrue(conn.committed)

    def test_erase_missing_episode_does_not_delete_files(self):
        store = MemStore()
        conn = FakeConn(None)
        with self.assertRaises(LookupError):
            lib.erase_episode(
                "systems-over-goals",
                "missing-guid",
                connect=lambda: conn,
                store=store,
            )
        self.assertEqual(store.deleted, [])

    def test_phone_follows_the_desk_and_hitech_opens_quietly(self):
        phone = (ROOT / "mobile/src/screens/PodcastScreen.js").read_text(encoding="utf-8")
        engine = (ROOT / "podcast_engine.py").read_text(encoding="utf-8")
        self.assertNotIn("screenCacheFresh", phone)
        self.assertIn("setInterval", phone)
        self.assertIn("8000", phone)
        self.assertIn("useAppResume", phone)
        self.assertIn("intro_v4_soft.mp3", engine)
        self.assertIn("DISCLAIMER_SPEED = 1.45", engine)
        self.assertIn("HITECH_INTRO_EXTRA_DB = -10.0", engine)
        self.assertTrue((ROOT / "podcast/stings/intro_v4_soft.mp3").is_file())
        self.assertTrue((ROOT / "branding/sogd-cover.jpg").is_file())
        from podcast_feed import _image_info
        info = _image_info((ROOT / "branding/sogd-cover.jpg").read_bytes())
        self.assertIsNotNone(info)
        w, h, rgb = info
        self.assertEqual((w, h, rgb), (1400, 1400, True))

    def test_studio_exposes_the_menu_and_the_drop_target(self):
        player = (ROOT / "web/gp-app/src/pages/podcasts/ChapterPlayer.tsx").read_text(encoding="utf-8")
        page = (ROOT / "web/gp-app/src/pages/PodcastsPage.tsx").read_text(encoding="utf-8")
        server = (ROOT / "api/server.py").read_text(encoding="utf-8")
        self.assertIn('aria-label="Episode menu"', player)
        self.assertIn("Erase episode", player)
        self.assertIn("Drop an MP3 to add an episode", page)
        self.assertIn("/episodes/upload", page)
        self.assertIn('"/api/podcast/{show}/episodes/upload"', server)
        self.assertIn('"/api/podcast/{show}/episodes/{guid}"', server)


if __name__ == "__main__":
    unittest.main()
