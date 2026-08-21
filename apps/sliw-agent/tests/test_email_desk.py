"""Contacted book + email trail + Edyta draft KV."""

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


class EmailDeskTests(unittest.TestCase):
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
        crm.ensure_dirs()

    def tearDown(self) -> None:
        for p in reversed(self._patches):
            p.stop()
        self.tmp.cleanup()

    def test_append_email_log_and_contacted_list(self) -> None:
        corp = crm.upsert_prospect(
            company="Genentech",
            industry="Biotech",
            contacts=[{"name": "Pat", "email": "pat@gene.com"}],
            book="corporate",
        )
        planner = crm.upsert_prospect(
            company="Vanessa Pence Events",
            industry="Wedding planner",
            contacts=[{"name": "Vanessa", "email": "vanessa@vanessapenceevents.com"}],
            book="wedding",
        )
        scored = crm.upsert_prospect(company="Not yet", book="corporate")
        saved_to = crm.upsert_prospect(company="To-only", book="corporate")
        crm.record_last_contacted(saved_to["id"], email="ops@to-only.com")

        crm.set_stage(corp["id"], "contacted", note="Sent")
        crm.append_email_log(
            corp["id"],
            to="pat@gene.com",
            subject="First dance for the team offsite",
            body="Hi Pat —",
            kind="sent",
            note="Marked contacted",
        )
        crm.append_email_log(
            planner["id"],
            to="vanessa@vanessapenceevents.com",
            subject="Partnership",
            body="Hi Vanessa —",
            kind="sent",
        )

        # duplicate of last entry is ignored
        crm.append_email_log(
            planner["id"],
            to="vanessa@vanessapenceevents.com",
            subject="Partnership",
            body="Hi Vanessa —",
            kind="sent",
        )

        rows = crm.contacted_prospects()
        ids = {p["id"] for p in rows}
        self.assertIn(corp["id"], ids)
        self.assertIn(planner["id"], ids)
        self.assertNotIn(scored["id"], ids)
        self.assertNotIn(saved_to["id"], ids)

        gene = crm.get_prospect(corp["id"])
        self.assertEqual(len(gene.get("email_log") or []), 1)
        self.assertEqual(gene["email_log"][0]["subject"], "First dance for the team offsite")
        self.assertEqual(gene["last_contacted_email"], "pat@gene.com")

        planner_p = crm.get_prospect(planner["id"])
        self.assertEqual(len(planner_p.get("email_log") or []), 1)

    def test_manual_contacted_and_delete(self) -> None:
        planner = crm.upsert_prospect(
            company="Blissful Events",
            industry="Wedding planner",
            contacts=[{"name": "Samar", "email": "samar@blissfuleventplanning.com"}],
            book="wedding",
        )
        pid = planner["id"]
        on = crm.set_contacted(pid, True)
        self.assertEqual(on.get("stage"), "contacted")
        self.assertFalse(on.get("uncontacted"))
        self.assertTrue(crm.prospect_is_contacted(on))
        ids = {p["id"] for p in crm.contacted_prospects()}
        self.assertIn(pid, ids)

        off = crm.set_contacted(pid, False)
        self.assertEqual(off.get("stage"), "scored")
        self.assertTrue(off.get("uncontacted"))
        self.assertFalse(crm.prospect_is_contacted(off))
        ids = {p["id"] for p in crm.contacted_prospects()}
        self.assertNotIn(pid, ids)

        gone = crm.delete_prospect(pid)
        self.assertTrue(gone.get("deleted"))
        self.assertIsNone(crm.get_prospect(pid))
        by_name = [p for p in crm.list_prospects(book="wedding") if p.get("company") == "Blissful Events"]
        self.assertEqual(by_name, [])

        again = crm.upsert_prospect(
            company="Blissful Events",
            industry="Wedding planner",
            book="wedding",
        )
        self.assertNotEqual(again["id"], pid)
        self.assertIsNotNone(crm.get_prospect(again["id"]))

    def test_email_drafts_kv(self) -> None:
        blob = {"drafts": []}
        item = {
            "id": "draft-abc",
            "title": "Planner first touch",
            "subject": "Hello",
            "body": "Hi —",
        }
        blob["drafts"].insert(0, item)
        saved = crm.save_kv("email_drafts", blob)
        loaded = crm.load_kv("email_drafts")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["drafts"][0]["title"], "Planner first touch")
        self.assertIn("_updated_at", saved)


if __name__ == "__main__":
    unittest.main()
