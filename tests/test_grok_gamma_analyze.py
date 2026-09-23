"""Grok + Gamma analyze must not die on an unbounded live-search call."""
import time
from pathlib import Path

from DGA_analyst import _bounded_call, looks_like_unfinished_report

ROOT = Path(__file__).resolve().parents[1]


def test_bounded_call_returns_instead_of_hanging():
    t0 = time.time()
    val, err = _bounded_call(lambda: time.sleep(5), 0.3)
    elapsed = time.time() - t0
    assert val is None
    assert isinstance(err, TimeoutError)
    assert elapsed < 2.0


def test_adbe_preamble_is_not_a_report():
    stub = (
        "I will pull the last 90 days of ADBE news, M&A, and earnings "
        "before writing the report, then lock every financial table to "
        "the verified SEC block."
    )
    assert looks_like_unfinished_report(stub)
    assert not looks_like_unfinished_report(
        "## Investment thesis\n\nAdobe is a hold.\n\n## Price target\n\n$400\n" * 20
    )


def test_fresh_store_skips_live_sec():
    src = (ROOT / "DGA_analyst.py").read_text(encoding="utf-8")
    impl = src.split("def _analyze_ticker_impl")[1].split("def run_portfolio_summary")[0]
    assert "ANALYZE_STORE_FRESH_DAYS" in impl
    assert "_need_sec = not _store_ok" in impl
    assert "skipped live SEC" in impl


def test_equity_report_does_not_use_live_search():
    src = (ROOT / "DGA_analyst.py").read_text(encoding="utf-8")
    impl = src.split("def _analyze_ticker_impl")[1].split("def run_portfolio_summary")[0]
    assert "_live = False" in impl
    grok = src.split("def call_grok")[1].split("def call_claude")[0]
    assert 'GROK_REPORT_EFFORT' in grok
    assert '"reasoning_effort": effort' in grok
    assert "max_tokens=max_out" in grok
    assert "max_retries=0" in grok or "max_retries=0" in src
    assert "stream=True" in grok


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
