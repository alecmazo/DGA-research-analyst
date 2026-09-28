"""The Local page agent stays on the financial store and Yahoo. No paid model."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from api.domains.local_desk import (
    format_store_financials,
    parse_tool_call,
    run_local_agent,
)


class LocalDeskTests(unittest.TestCase):
    def test_prose_is_not_a_tool(self):
        self.assertIsNone(parse_tool_call("Apple revenue was $100."))
        call = parse_tool_call('{"tool":"yahoo_news","ticker":"AAPL"}')
        self.assertEqual(call["tool"], "yahoo_news")

    def test_store_snapshot_names_the_source(self):
        text = format_store_financials("AAPL", [{
            "period_type": "annual",
            "fy": 2025,
            "period_end": "2025-09-27",
            "revenue": 416161,
        }])
        self.assertIn("company_financials store", text)
        self.assertIn("416161", text)
        self.assertIn("No rows", format_store_financials("ZZZ", []))

    def test_agent_reads_the_store_then_answers(self):
        seen = []

        def chat(_system, user):
            seen.append(user)
            if len(seen) == 1:
                return '{"tool":"company_financials","ticker":"AAPL"}'
            return "Stored revenue is 416161."

        def rows(ticker, _period):
            self.assertEqual(ticker, "AAPL")
            return [{"period_type": "annual", "fy": 2025, "revenue": 416161}]

        with patch("api.domains.local_desk.check_local_health", return_value={"ok": True}):
            out = run_local_agent("How large is AAPL?", rows_fn=rows, chat_fn=chat)
        self.assertTrue(out["ok"])
        self.assertIn("416161", out["answer"])
        self.assertEqual(out["steps"][0]["tool"], "company_financials")
        self.assertIn("company_financials store", seen[1])


if __name__ == "__main__":
    unittest.main()
