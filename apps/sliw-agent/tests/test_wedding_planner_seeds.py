"""Planner seed import: named personal emails, no duplicate of the original 20."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_APP_ROOT = Path(__file__).resolve().parents[1]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from sliw_agent import crm  # noqa: E402
from sliw_agent import wedding_agent  # noqa: E402
from sliw_agent.wedding_agent import import_wedding_library  # noqa: E402

NEW_PLANNERS = {
    "Vanessa Pence Events": "vanessa@vanessapenceevents.com",
    "Laurie Arons Special Events": "laurie@lauriearons.com",
    "Amazáe Events": "crystal@amazae.com",
    "Blissful Events": "samar@blissfuleventplanning.com",
    "Despina Craig Events": "despinacraigevents@gmail.com",
}


class PlannerSeedImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        data = Path(self.tmp.name)
        self._patches = [
            patch.object(crm, "DATA_DIR", data),
            patch.object(crm, "WEDDING_CRM_PATH", data / "wedding_crm.json"),
            patch.object(crm, "CRM_PATH", data / "crm.json"),
            patch.object(crm, "OUTREACH_DIR", data / "outreach"),
            patch.object(crm, "DECKS_DIR", data / "decks"),
            patch.object(crm, "BRIEFS_DIR", data / "briefs"),
            patch.object(crm, "WEDDING_OUTREACH_DIR", data / "wedding_outreach"),
            patch.object(crm, "WEDDING_DECKS_DIR", data / "wedding_decks"),
            patch.object(crm, "WEDDING_BRIEFS_DIR", data / "wedding_briefs"),
            patch.object(crm, "_pg_ok", False),
            patch.object(crm, "_pg_ready", False),
            patch.object(crm, "_use_postgres", lambda: False),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self) -> None:
        for p in reversed(self._patches):
            p.stop()
        self.tmp.cleanup()

    def _by_company(self) -> dict[str, list[dict]]:
        out: dict[str, list[dict]] = {}
        for p in crm.list_prospects(book="wedding"):
            out.setdefault(p["company"], []).append(p)
        return out

    def _assert_new_planners(self, by_company: dict[str, list[dict]]) -> None:
        for name, email in NEW_PLANNERS.items():
            self.assertEqual(len(by_company.get(name) or []), 1, name)
            contacts = by_company[name][0].get("contacts") or []
            emails = [c.get("email") for c in contacts]
            self.assertIn(email, emails, name)
            primary = next(c for c in contacts if c.get("email") == email)
            self.assertEqual(primary.get("source"), "seed")
            self.assertNotEqual(by_company[name][0].get("stage"), "contacted")

    def test_growing_list_then_reimport_does_not_duplicate(self) -> None:
        original = [
            row
            for row in wedding_agent.load_wedding_library()
            if row.get("company") not in NEW_PLANNERS
        ]
        with patch.object(wedding_agent, "load_wedding_library", return_value=original):
            first = import_wedding_library(rescore_existing=False)
        self.assertEqual(first["imported"], len(original))
        self.assertNotIn("Vanessa Pence Events", self._by_company())

        grown = import_wedding_library(rescore_existing=False)
        self.assertEqual(grown["imported"], 5)

        by = self._by_company()
        self._assert_new_planners(by)
        self.assertEqual(len(by.get("Contagious Events") or []), 1)

        again = import_wedding_library(rescore_existing=True)
        self.assertEqual(again["imported"], 0)
        by2 = self._by_company()
        self.assertEqual(len(by2), len(by))
        for name, rows in by2.items():
            self.assertEqual(len(rows), 1, name)
        self._assert_new_planners(by2)


if __name__ == "__main__":
    unittest.main()
