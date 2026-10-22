"""Process start must not import pandas, Yahoo, or EDGAR.

SUP_20261022_281244dc: /health waited on those libraries because api.server
imported them while binding. They load on first use instead.
"""
from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "api" / "server.py"
BANNED = ("yfinance", "pandas", "DGA_analyst", "edgar", "sec_edgar_xbrl")


def test_server_source_has_no_top_level_heavy_imports():
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    for node in tree.body:
        names: list[str] = []
        if isinstance(node, ast.Import):
            names = [alias.name.split(".")[0] for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [(node.module or "").split(".")[0]]
        hit = sorted(set(names) & set(BANNED))
        assert not hit, hit


def test_importing_server_does_not_load_heavy_libs():
    script = """
import sys
sys.path.insert(0, %r)
import api.server as server
banned = %r
loaded = [name for name in banned if name in sys.modules]
assert not loaded, loaded
assert server._YFINANCE_OK.__class__.__name__ == "_YFinanceReady"
assert type(server.analyst).__name__ == "_LazyAnalyst"
assert "DGA_analyst" not in sys.modules
assert "yfinance" not in sys.modules
print("ok")
""" % (str(ROOT), BANNED)
    proc = subprocess.run(
        [sys.executable, "-c", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, (proc.stdout[-2000:] + proc.stderr[-2000:])
    assert "ok" in proc.stdout
