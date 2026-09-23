"""Grok + Gamma analyze must not die on an unbounded live-search call."""
import time
from pathlib import Path

from DGA_analyst import _bounded_call

ROOT = Path(__file__).resolve().parents[1]


def test_bounded_call_returns_instead_of_hanging():
    t0 = time.time()
    val, err = _bounded_call(lambda: time.sleep(5), 0.3)
    elapsed = time.time() - t0
    assert val is None
    assert isinstance(err, TimeoutError)
    assert elapsed < 2.0


def test_analyze_does_not_blame_gamma_for_llm_timeout():
    src = (ROOT / "DGA_analyst.py").read_text(encoding="utf-8")
    hb = src.split("def call_llm_with_heartbeat")[1].split("def extract_thesis_snippet")[0]
    assert "disable Gamma" not in hb
    grok = src.split("def call_grok")[1].split("def call_claude")[0]
    assert "GROK_LIVE_SEARCH_TIMEOUT_S" in grok
    assert "_bounded_call" in grok
    gamma = src.split("def _gamma_generate")[1].split("def analyze_ticker")[0]
    assert '"folderIds": [GAMMA_FOLDER_ID] if GAMMA_FOLDER_ID else None' not in gamma
    assert 'payload["folderIds"]' in gamma
