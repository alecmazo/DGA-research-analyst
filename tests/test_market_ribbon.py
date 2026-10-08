"""The index tape paints its own green and red. Global pos/neg vanish on navy."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "api/server.py"


def _fn_src(name: str) -> str:
    text = SERVER.read_text(encoding="utf-8")
    tree = ast.parse(text)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(text, node) or ""
    raise AssertionError(f"{name} not found")


def _quote_ns() -> dict:
    ns: dict = {}
    for name in (
        "_as_of_et_date",
        "_quote_from_current_session",
        "_clean_quote_px",
        "_clean_quote_pct",
        "_quote_fields",
    ):
        exec(_fn_src(name), ns)
    ns["_us_session_date_str"] = lambda: "2026-10-08"
    return ns


def test_chart_session_date_keeps_day_percent():
    """A Yahoo chart as_of is the ET session date, not UTC midnight."""
    ns = _quote_ns()
    assert ns["_as_of_et_date"]("2026-10-08") == "2026-10-08"
    # A real UTC instant just after midnight is still the prior ET day.
    assert ns["_as_of_et_date"]("2026-10-08T00:30:00+00:00") == "2026-10-07"
    assert ns["_as_of_et_date"]("2026-10-08T17:52:40+00:00") == "2026-10-08"
    px, pct = ns["_quote_fields"](7742.07, -0.79, "2026-10-08")
    assert px == 7742.07
    assert pct == -0.79
    _px, stale = ns["_quote_fields"](7742.07, -0.79, "2026-10-07")
    assert stale is None
    _px, live = ns["_quote_fields"](772.6, -0.59, "2026-10-08T17:46:39+00:00")
    assert live == -0.59
    assert ns["_quote_from_current_session"]("2026-10-08") is True


def test_ribbon_uses_module_up_down_not_global_pos():
    tsx = (ROOT / "web/gp-app/src/components/layout/MarketRibbon.tsx").read_text()
    css = (ROOT / "web/gp-app/src/components/layout/MarketRibbon.module.css").read_text()
    assert "pctClass" not in tsx
    assert "styles.up" in tsx
    assert "styles.down" in tsx
    assert ".chg.pos" not in css
    assert ".chg.neg" not in css
    assert ".up" in css and "#4ade80" in css
    assert ".down" in css and "#f87171" in css
    assert "animation: none" in css
