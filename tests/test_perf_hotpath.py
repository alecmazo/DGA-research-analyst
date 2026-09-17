"""Hot-path performance contracts — no live Railway, no full-store walk."""
from __future__ import annotations

import ast
import inspect
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _fn_src(path: Path, name: str) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.AsyncFunctionDef) and node.name == name:
            return ast.get_source_segment(path.read_text(encoding="utf-8"), node) or ""
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(path.read_text(encoding="utf-8"), node) or ""
    raise AssertionError(f"{name} not found in {path}")


def test_health_and_build_are_async():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    kinds = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in (
            "health", "build_version",
        ):
            kinds[node.name] = type(node).__name__
    assert kinds.get("health") == "AsyncFunctionDef", kinds
    assert kinds.get("build_version") == "AsyncFunctionDef", kinds


def test_list_reports_sql_skips_valuation_json():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    # The list SELECT must not detoast valuation_approaches JSONB.
    start = src.find("def list_reports")
    chunk = src[start : start + 12000]
    assert "FROM analyst_reports" in chunk
    # column may still appear as empty list in the payload, not in SELECT
    sel = chunk.split("FROM analyst_reports")[0]
    assert "valuation_approaches," not in sel
    assert "dcf_user_fcf" not in sel
    assert "excel_model" not in chunk


def test_watchlist_has_sub_2s_paint_wall():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    start = src.find("def watchlist_get")
    chunk = src[start : start + 8000]
    assert "_WL_PAINT_S = 1.2" in chunk
    assert "budget_s=2.0" not in chunk


def test_financials_settings_cached():
    body = (ROOT / "api/domains/_financials_body.py").read_text(encoding="utf-8")
    assert "_FIN_SETTINGS_CACHE" in body
    assert "_FIN_SETTINGS_TTL_S" in body
