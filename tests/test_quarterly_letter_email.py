"""Publish-to-LP emails the assigned investor, or the GP who confirmed."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "api/server.py"

AL_DEF = {
    "id": "5a705a9c-28cb-4013-9368-f1686b79049e",
    "name": "Ind",
    "short_name": "AL-DEF",
    "fund_type": "managed_account",
}
EM_DEF = {
    "id": "0b320621-9998-4264-8574-bdabafb90691",
    "name": "EM Defensive",
    "short_name": "EM-DEF",
    "fund_type": "managed_account",
}


def _fn_src(name: str) -> str:
    text = SERVER.read_text(encoding="utf-8")
    tree = ast.parse(text)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(text, node) or ""
    raise AssertionError(f"{name} not found")


def _recipients():
    ns: dict = {"re": __import__("re")}
    exec(_fn_src("_valid_email_addr"), ns)
    exec(_fn_src("_qletter_recipients"), ns)
    return ns["_qletter_recipients"]


def test_unassigned_account_emails_the_gp_who_confirmed():
    pick = _recipients()
    users = [
        {"role": "lp", "email": "e.mazo@outlook.com", "name": "Eugene Mazo",
         "managed_account_ids": ["EM DEFENSIVE"], "fund_memberships": {}},
        {"role": "lp", "email": "anatolymazo@gmail.com", "name": "Anatoly Mazo",
         "managed_account_ids": ["ANAT TOD"], "fund_memberships": {}},
        {"role": "gp", "email": "alecmazo1@gmail.com", "name": "Alec Mazo",
         "managed_account_ids": [], "fund_memberships": {}},
        {"role": "lp", "email": "me@demo.dgacapital.com", "name": "Demo",
         "demo_mode": True, "managed_account_ids": ["Northridge SMA"]},
    ]
    got, fallback = pick(users, AL_DEF, "alecmazo1@gmail.com")
    assert fallback is True
    assert [r["email"] for r in got] == ["alecmazo1@gmail.com"]


def test_assigned_account_emails_that_investor_only():
    pick = _recipients()
    users = [
        {"role": "lp", "email": "e.mazo@outlook.com", "name": "Eugene Mazo",
         "managed_account_ids": ["EM DEFENSIVE"], "fund_memberships": {}},
        {"role": "gp", "email": "alecmazo1@gmail.com", "name": "Alec Mazo",
         "managed_account_ids": [], "fund_memberships": {}},
    ]
    got, fallback = pick(users, EM_DEF, "alecmazo1@gmail.com")
    assert fallback is False
    assert [r["email"] for r in got] == ["e.mazo@outlook.com"]


def test_demo_login_is_not_a_recipient():
    pick = _recipients()
    users = [
        {"role": "lp", "email": "me@demo.dgacapital.com", "name": "Demo",
         "demo_mode": True, "managed_account_ids": ["AL-DEF"]},
    ]
    got, fallback = pick(users, AL_DEF, "alecmazo1@gmail.com")
    assert fallback is True
    assert [r["email"] for r in got] == ["alecmazo1@gmail.com"]
