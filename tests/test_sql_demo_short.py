"""_sql_demo_short must be safe to embed in parameterized psycopg2 SQL.

SUP_20260911_a8cea52d: LIKE 'DEMO%' inside an f-string query that also
passed %s args made psycopg2 raise IndexError: tuple index out of range
on GET /api/v2/lp/me/positions for live LPs (Eugene / mobile Portfolio).
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _fn_src(name: str) -> str:
    text = (ROOT / "api" / "server.py").read_text()
    start = text.index(f"def {name}")
    nxt = text.find("\ndef ", start + 1)
    return text[start:nxt]


def _sql_demo_short(is_demo: bool) -> str:
    """Mirror of api.server._sql_demo_short — keep in lockstep via source asserts."""
    op = "=" if is_demo else "<>"
    return f"LEFT(UPPER(COALESCE(short_name,'')), 4) {op} 'DEMO'"


def test_sql_demo_short_source_has_no_like_percent():
    src = _fn_src("_sql_demo_short")
    returns = "\n".join(l for l in src.splitlines() if "return" in l)
    assert "LIKE" not in returns
    assert "LEFT(" in src
    assert "DEMO%" not in returns
    assert "SUP_20260911_a8cea52d" in src


def test_sql_demo_short_fragment_has_no_percent():
    assert "%" not in _sql_demo_short(False)
    assert "%" not in _sql_demo_short(True)
    assert "DEMO" in _sql_demo_short(False)
    assert "<>" in _sql_demo_short(False)
    assert "=" in _sql_demo_short(True)


def test_positions_style_query_pyformat_does_not_indexerror():
    """Reproduce the LP managed-account query shape from lp_me_positions."""
    pred = _sql_demo_short(False)
    sql = (
        "SELECT id, name, short_name FROM funds "
        "WHERE fund_type = 'managed_account' "
        "AND (UPPER(short_name) = ANY(%s) OR UPPER(name) = ANY(%s)) "
        f"AND {pred}"
    )
    acct = ["EM DEFENSIVE"]
    # Python % formatting is what psycopg2 pyformat uses under the hood.
    bound = sql % (acct, acct)
    assert "EM DEFENSIVE" in bound
    assert "DEMO" in bound


def test_old_like_fragment_would_indexerror():
    """Lock the original failure mode so we don't regress to LIKE '%'."""
    old = "UPPER(COALESCE(short_name,'')) NOT LIKE 'DEMO%'"
    sql = (
        "SELECT 1 WHERE (UPPER(short_name) = ANY(%s) OR UPPER(name) = ANY(%s)) "
        f"AND {old}"
    )
    raised = False
    try:
        sql % (["EM DEFENSIVE"], ["EM DEFENSIVE"])
    except (IndexError, ValueError, TypeError):
        raised = True
    assert raised, "old LIKE 'DEMO%' fragment must still collide with %s params"
