"""LP Settings keeps every login, and Edit shows the assigned accounts."""
from pathlib import Path

from api.domains.lp_planning import canonical_managed_account_ids
from auth_v2 import merge_overlay_record

ROOT = Path(__file__).resolve().parents[1]

FUNDS = [
    {"id": "1", "name": "EM Defensive", "short_name": "EM-DEF"},
    {"id": "2", "name": "Anat Defensive", "short_name": "ANAT-DEF"},
    {"id": "3", "name": "Anatoly IRA", "short_name": "ANAT-IRA"},
    {"id": "4", "name": "EdRoth IRA", "short_name": "ED-ROTH"},
    {"id": "5", "name": "Dennis Defensive", "short_name": "DEN-DEF"},
    {"id": "6", "name": "Goldenberg Event", "short_name": "GOLD-EVENT"},
]


def test_edit_labels_match_the_account_on_the_checkbox():
    assert canonical_managed_account_ids(["EM DEFENSIVE"], FUNDS) == ["EM Defensive"]
    assert canonical_managed_account_ids(["EM-DEF"], FUNDS) == ["EM Defensive"]
    assert canonical_managed_account_ids(
        ["Anatoly Ind", "Anatoly IRA"],
        FUNDS,
    ) == ["Anatoly IRA", "Anat Defensive"]
    assert canonical_managed_account_ids(["Goldenberg Event"], FUNDS) == ["Goldenberg Event"]


def test_an_unknown_assignment_is_kept():
    assert canonical_managed_account_ids(
        ["Dennis Defensive", "Old Nickname"],
        FUNDS,
    ) == ["Dennis Defensive", "Old Nickname"]


def test_assignment_save_does_not_drop_the_password():
    merged = merge_overlay_record(
        {
            "email": "lp@example.com",
            "name": "LP",
            "role": "lp",
            "password_hash_hex": "abc",
            "password_salt_hex": "def",
            "managed_account_ids": ["Old"],
        },
        {"fund_memberships": {"DGA Capital Fund I, LP": "DY"}, "managed_account_ids": ["Dennis Defensive"]},
    )
    assert merged["password_hash_hex"] == "abc"
    assert merged["password_salt_hex"] == "def"
    assert merged["email"] == "lp@example.com"
    assert merged["managed_account_ids"] == ["Dennis Defensive"]
    assert merged["fund_memberships"]["DGA Capital Fund I, LP"] == "DY"


def test_bulk_save_does_not_delete_other_lps():
    server = (ROOT / "api" / "server.py").read_text()
    auth = (ROOT / "auth_v2.py").read_text()
    assert "NOT (lp_id = ANY" not in server
    assert "DELETE FROM lp_credentials_kv" not in server.split("def _db_save_lp_overlay")[1].split("def _db_delete_lp_overlay")[0]
    assert "def _db_delete_lp_overlay" in server
    assert "_OVERLAY_DB_DELETE" in auth
    assert "merge_overlay_record" in server
