"""Corporate Hunter ranking: People/EX/Events/L&D over raw top-N."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_APP_ROOT = Path(__file__).resolve().parents[1]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from sliw_agent.contact_finder import (  # noqa: E402
    _domain_from_website,
    _hunter_domain_search,
    _parse_hunter_emails,
    _pick_primary,
    find_contacts,
)


def _email(
    *,
    value: str,
    first: str,
    last: str,
    position: str,
    email_type: str = "personal",
    confidence: int = 94,
    seniority: str = "senior",
    department: str = "",
) -> dict:
    return {
        "value": value,
        "first_name": first,
        "last_name": last,
        "position": position,
        "type": email_type,
        "confidence": confidence,
        "seniority": seniority,
        "department": department,
        "linkedin": "",
    }


# Fixture addresses only — not real people.
ENGINEER = _email(
    value="alex.engineer@example.com",
    first="Alex",
    last="Engineer",
    position="Staff Software Engineer",
    department="it",
)
HEAD_OF_PEOPLE = _email(
    value="priya.people@example.com",
    first="Priya",
    last="People",
    position="Head of People",
    department="hr",
    seniority="executive",
)
EVENT_MANAGER = _email(
    value="morgan.events@example.com",
    first="Morgan",
    last="Events",
    position="Event Manager",
    department="operations",
)
GENERIC_INFO = _email(
    value="info@example.com",
    first="",
    last="",
    position="",
    email_type="generic",
    confidence=70,
    seniority="",
    department="",
)
SALES_AE = _email(
    value="sam.ae@example.com",
    first="Sam",
    last="Seller",
    position="Account Executive",
    department="sales",
)
HRBP = _email(
    value="jordan.hrbp@example.com",
    first="Jordan",
    last="Partner",
    position="HRBP",
    department="hr",
)
WEDDING_PLANNER = _email(
    value="casey.planner@example.com",
    first="Casey",
    last="Planner",
    position="Lead Wedding Planner",
    department="management",
)


class FakeResp:
    def __init__(self, payload: dict, status: int = 200):
        self.status_code = status
        self._payload = payload
        self.text = ""

    def json(self):
        return self._payload


def _ok(emails: list[dict], org: str = "Example") -> FakeResp:
    return FakeResp({"data": {"emails": emails, "organization": org}})


class DomainOverrideTests(unittest.TestCase):
    def test_known_corporate_domains(self):
        self.assertEqual(_domain_from_website("", "Anthropic"), "anthropic.com")
        self.assertEqual(_domain_from_website("", "Airbnb"), "airbnb.com")
        self.assertEqual(_domain_from_website("", "Notion"), "notion.so")
        self.assertEqual(_domain_from_website("", "Rippling"), "rippling.com")
        self.assertEqual(_domain_from_website("", "Asana"), "asana.com")
        self.assertEqual(_domain_from_website("", "Pinterest"), "pinterest.com")


class RankingTests(unittest.TestCase):
    def test_people_ex_beats_engineer_and_event_manager_is_above_engineer(self):
        parsed = _parse_hunter_emails([ENGINEER, HEAD_OF_PEOPLE, EVENT_MANAGER])
        emails = [c["email"] for c in parsed]
        self.assertEqual(emails[0], HEAD_OF_PEOPLE["value"])
        self.assertIn(EVENT_MANAGER["value"], emails)
        self.assertLess(
            emails.index(EVENT_MANAGER["value"]),
            emails.index(ENGINEER["value"]),
        )
        primary = _pick_primary(parsed, wedding_mode=False)
        self.assertEqual(primary["email"], HEAD_OF_PEOPLE["value"])
        self.assertEqual(primary["title"], "Head of People")
        self.assertTrue(parsed[0]["people_ex"])
        self.assertGreater(
            next(c for c in parsed if c["email"] == HEAD_OF_PEOPLE["value"])["role_fit_score"],
            next(c for c in parsed if c["email"] == ENGINEER["value"])["role_fit_score"],
        )

    def test_generic_inbox_is_not_primary_when_people_ex_exists(self):
        parsed = _parse_hunter_emails([GENERIC_INFO, ENGINEER, HEAD_OF_PEOPLE])
        primary = _pick_primary(parsed, wedding_mode=False)
        self.assertEqual(primary["email"], HEAD_OF_PEOPLE["value"])
        self.assertNotEqual(primary.get("type"), "generic")

    def test_sales_ae_ranks_below_hrbp_and_people(self):
        parsed = _parse_hunter_emails([SALES_AE, HRBP, HEAD_OF_PEOPLE])
        emails = [c["email"] for c in parsed]
        self.assertEqual(emails[0], HEAD_OF_PEOPLE["value"])
        self.assertLess(emails.index(HRBP["value"]), emails.index(SALES_AE["value"]))


class HunterFetchTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"HUNTER_API_KEY": "test-key-not-real"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_open_search_without_people_ex_continues_to_hr(self):
        calls: list[dict] = []

        def fake_get(url, params=None, timeout=None):
            calls.append({k: v for k, v in (params or {}).items() if k != "api_key"})
            if (params or {}).get("department") == "hr":
                return _ok([HEAD_OF_PEOPLE, EVENT_MANAGER])
            if (params or {}).get("type") == "personal":
                return _ok([])
            if (params or {}).get("offset"):
                return _ok([])
            # Open search: Hunter raw top-N engineers only
            return _ok([ENGINEER] * 10)

        with patch("sliw_agent.contact_finder.requests.get", side_effect=fake_get):
            result = _hunter_domain_search("example.com", company="Example", limit=10)

        depts = [c.get("department") for c in calls]
        self.assertIn("hr", depts)
        emails = [c["email"] for c in result["contacts"]]
        self.assertEqual(emails[0], HEAD_OF_PEOPLE["value"])
        self.assertGreaterEqual(result["diagnostics"]["hunter_emails_fetched"], 2)
        self.assertGreaterEqual(result["diagnostics"]["people_ex_hits"], 2)

    def test_stops_early_once_three_strong_personal(self):
        calls: list[dict] = []
        strong = [
            HEAD_OF_PEOPLE,
            EVENT_MANAGER,
            _email(
                value="lee.ld@example.com",
                first="Lee",
                last="Learning",
                position="VP Learning and Development",
                department="hr",
            ),
        ]

        def fake_get(url, params=None, timeout=None):
            calls.append({k: v for k, v in (params or {}).items() if k != "api_key"})
            return _ok(strong)

        with patch("sliw_agent.contact_finder.requests.get", side_effect=fake_get):
            result = _hunter_domain_search("example.com", limit=10)

        self.assertEqual(len(calls), 1)
        self.assertNotIn("department", calls[0])
        self.assertEqual(result["diagnostics"]["people_ex_hits"], 3)

    def test_offset_page_two_when_still_empty(self):
        calls: list[dict] = []

        def fake_get(url, params=None, timeout=None):
            p = {k: v for k, v in (params or {}).items() if k != "api_key"}
            calls.append(p)
            if p.get("offset") == 10:
                return _ok([HEAD_OF_PEOPLE])
            return _ok([ENGINEER])

        with patch("sliw_agent.contact_finder.requests.get", side_effect=fake_get):
            result = _hunter_domain_search("example.com", limit=10)

        self.assertTrue(any(c.get("offset") == 10 for c in calls))
        self.assertEqual(result["contacts"][0]["email"], HEAD_OF_PEOPLE["value"])

    def test_find_contacts_sets_why_primary_and_skips_generic(self):
        def fake_get(url, params=None, timeout=None):
            if (params or {}).get("department") == "hr":
                return _ok([HEAD_OF_PEOPLE])
            return _ok([GENERIC_INFO, ENGINEER])

        with patch("sliw_agent.contact_finder.requests.get", side_effect=fake_get):
            result = find_contacts(company="Example", website="https://example.com")

        self.assertEqual(result["primary"]["email"], HEAD_OF_PEOPLE["value"])
        self.assertEqual(result["contacts"][0]["email"], HEAD_OF_PEOPLE["value"])
        diag = result["hunter_diagnostics"]
        self.assertIn("hunter_emails_fetched", diag)
        self.assertIn("people_ex_hits", diag)
        self.assertIn("why_primary", diag)
        self.assertIn("People/EX", diag["why_primary"])
        self.assertNotIn("test-key", str(diag))

    def test_wedding_mode_breaks_after_open_search(self):
        calls: list[dict] = []

        def fake_get(url, params=None, timeout=None):
            calls.append({k: v for k, v in (params or {}).items() if k != "api_key"})
            return _ok([WEDDING_PLANNER, SALES_AE])

        with patch("sliw_agent.contact_finder.requests.get", side_effect=fake_get):
            result = find_contacts(
                company="Example Venue",
                website="https://example.com",
                wedding_mode=True,
            )

        self.assertEqual(len(calls), 1)
        self.assertTrue(result["wedding_mode"])
        self.assertEqual(result["primary"]["source"], "hunter.io")
        self.assertEqual(result["primary"]["email"], WEDDING_PLANNER["value"])


if __name__ == "__main__":
    unittest.main()
