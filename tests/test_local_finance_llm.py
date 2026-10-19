"""Offline tests for the local finance provider and Yahoo news helper."""

from __future__ import annotations

import json
import unittest
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from api.domains.local_finance_llm import (
    OFFLINE_MESSAGE,
    call_chunks_table,
    check_local_health,
    fit_local_context,
    llm_model_catalog,
    local_fast_model,
    local_model,
    local_model_list,
)
from api.domains.yahoo_finance_news import (
    EMPTY_NOTE,
    clear_news_cache,
    fetch_yahoo_finance_news,
    format_yahoo_news_block,
)


PT = ZoneInfo("America/Los_Angeles")


class YahooNewsTests(unittest.TestCase):
    def setUp(self):
        clear_news_cache()

    def test_dedupe_sort_and_empty_note(self):
        xml = """<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>Older headline</title>
            <link>https://finance.yahoo.com/a</link>
            <pubDate>Mon, 01 Sep 2026 15:00:00 GMT</pubDate>
            <description>old summary</description>
            <source>Yahoo Finance</source>
          </item>
          <item>
            <title>Newer headline</title>
            <link>https://finance.yahoo.com/b</link>
            <pubDate>Tue, 02 Sep 2026 15:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Newer headline</title>
            <link>https://finance.yahoo.com/b?dup=1</link>
            <pubDate>Tue, 02 Sep 2026 16:00:00 GMT</pubDate>
          </item>
        </channel></rss>"""
        with patch("api.domains.yahoo_finance_news._http_get", return_value=xml):
            items = fetch_yahoo_finance_news("AAPL", force=True)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["title"], "Newer headline")
        self.assertEqual(items[1]["title"], "Older headline")
        self.assertIn("PT", items[0]["published_label"])
        self.assertIsInstance(items[0]["published"], datetime)
        self.assertEqual(items[0]["published"].tzinfo, PT)
        block = format_yahoo_news_block("AAPL", items)
        self.assertIn("Newer headline", block)
        self.assertLess(block.index("Newer headline"), block.index("Older headline"))
        self.assertIn(EMPTY_NOTE, format_yahoo_news_block("AAPL", []))

    def test_cache_skips_second_fetch(self):
        xml = """<?xml version="1.0"?><rss><channel>
          <item><title>One</title><link>https://finance.yahoo.com/z</link>
          <pubDate>Tue, 02 Sep 2026 15:00:00 GMT</pubDate></item>
        </channel></rss>"""
        with patch("api.domains.yahoo_finance_news._http_get", return_value=xml) as get:
            fetch_yahoo_finance_news("MSFT", force=True)
            fetch_yahoo_finance_news("MSFT")
        self.assertEqual(get.call_count, 1)

    def test_rss_failure_uses_yfinance(self):
        def boom(_url, timeout=8.0):
            raise OSError("rss down")

        backup = [{
            "title": "Backup headline",
            "publisher": "Reuters",
            "link": "https://finance.yahoo.com/backup",
            "published": datetime(2026, 9, 2, 9, 0, tzinfo=PT),
            "summary": "from yfinance",
        }]
        with patch("api.domains.yahoo_finance_news._http_get", side_effect=boom), \
             patch("api.domains.yahoo_finance_news._from_yfinance", return_value=backup):
            items = fetch_yahoo_finance_news("NVDA", force=True)
        self.assertEqual(items[0]["title"], "Backup headline")
        self.assertEqual(items[0]["summary"], "from yfinance")


class LocalContextTests(unittest.TestCase):
    def test_trim_drops_oldest_news_then_oldest_fy(self):
        news = "\n".join([
            "=== FREE CATALYST HEADLINES — AAPL (Yahoo Finance, newest first) ===",
            "- [new] " + ("N" * 140),
            "- [old] " + ("O" * 140),
        ])
        fy = "\n".join([
            "FY2024 | " + ("A" * 220),
            "FY2020 | " + ("B" * 220),
        ])
        text = "=== VERIFIED FINANCIAL DATA ===\n" + fy + "\n\n" + news
        trimmed, note = fit_local_context(text, num_ctx=130, reserve_tokens=20)
        self.assertLess(note.index("oldest news"), note.index("least recent"))
        self.assertNotIn("O" * 40, trimmed)
        self.assertNotIn("N" * 40, trimmed)
        self.assertNotIn("FY2020", trimmed)
        self.assertIn("FY2024", trimmed)

    def test_health_offline_and_present(self):
        with patch("api.domains.local_finance_llm.urllib.request.urlopen", side_effect=OSError("down")):
            offline = check_local_health()
        self.assertFalse(offline["ok"])
        self.assertEqual(offline["message"], OFFLINE_MESSAGE)

        class _Resp:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return json.dumps({
                    "models": [{"name": "gpt-oss-20b-finance:latest"}]
                }).encode()

        with patch("api.domains.local_finance_llm.urllib.request.urlopen", return_value=_Resp()):
            ok = check_local_health()
        self.assertTrue(ok["ok"])
        self.assertEqual(ok["model"], "gpt-oss-20b-finance")
        self.assertTrue(any(c["model"] == "gpt-oss-20b-finance" and c["installed"] for c in ok["configured"]))
        self.assertTrue(any(c["model"] == "gemma4:26b" and not c["installed"] for c in ok["configured"]))


class LocalModelHelpersTests(unittest.TestCase):
    def test_local_model_list_and_resolve(self):
        self.assertIn("gpt-oss-20b-finance", local_model_list())
        self.assertEqual(local_model(), "gpt-oss-20b-finance")
        self.assertEqual(local_model("gemma4:12b"), "gemma4:12b")
        self.assertEqual(local_model("gemma4:26b"), "gemma4:26b")
        self.assertEqual(local_model("not-a-real-model"), "gpt-oss-20b-finance")
        self.assertEqual(local_model(""), "gpt-oss-20b-finance")
        self.assertEqual(local_model(None), "gpt-oss-20b-finance")
        self.assertEqual(local_fast_model(), "gemma4:12b")

    def test_catalog_lists_allowlist_and_ping(self):
        with patch("api.domains.local_finance_llm.urllib.request.urlopen", side_effect=OSError("down")):
            offline = llm_model_catalog(timeout=0.2)
        self.assertEqual(offline["default"], "gpt-oss-20b-finance")
        self.assertIn("gemma4:26b", offline["models"])
        self.assertIn("gemma4:12b", offline["models"])
        self.assertFalse(offline["reachable"])

        class _Resp:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self, _n=256):
                return b"{}"

        with patch("api.domains.local_finance_llm.urllib.request.urlopen", return_value=_Resp()):
            online = llm_model_catalog(timeout=0.2)
        self.assertTrue(online["reachable"])
        self.assertEqual(online["models"][0], "gpt-oss-20b-finance")

    def test_call_chunks_table_keeps_live_index_separate(self):
        self.assertEqual(
            call_chunks_table("text-embedding-3-small", provider="openai"),
            "call_chunks",
        )
        self.assertEqual(
            call_chunks_table("nomic-embed-text", provider="ollama"),
            "call_chunks__nomic_embed_text",
        )
        self.assertEqual(
            call_chunks_table("qwen3-embedding:4b", provider="ollama"),
            "call_chunks__qwen3_embedding_4b",
        )


if __name__ == "__main__":
    unittest.main()
