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
    assert 'GROK_REPORT_EFFORT' in src
    assert 'get_grok_report_effort()' in grok
    assert '"reasoning_effort": effort' in grok
    assert "max_tokens=max_out" in grok
    assert "get_grok_report_effort()" in grok
    assert 'or "low"' not in grok
    assert "max_retries=0" in grok or "max_retries=0" in src
    assert "stream=True" in grok


def test_grok_47_bill_uses_list_price():
    import DGA_analyst as analyst
    # Under 200k tokens: $2 in / $6 out. 100k in + 10k out = $0.26.
    assert abs(analyst.estimate_grok_cost("grok-4.7", 100_000, 10_000) - 0.26) < 1e-9
    # Cached input is $0.50, not $2.
    assert abs(analyst.estimate_grok_cost(
        "grok-4.7", 100_000, 0, cached_input_tokens=100_000) - 0.05) < 1e-9
    # 200k prompt tokens and above are billed at twice the list rate.
    assert abs(analyst.estimate_grok_cost("grok-4.7", 200_000, 0) - 0.80) < 1e-9
    assert analyst.estimate_grok_cost("grok-4.7", 1_000_000, 1_000_000) == 16.0
    label = analyst.format_analyze_cost({
        "input_tokens": 71188, "output_tokens": 18402, "cost_usd": 0.2528,
    })
    assert label == "71,188 in · 18,402 out · $0.25"
    src = (ROOT / "DGA_analyst.py").read_text(encoding="utf-8")
    grok = src.split("def call_grok")[1].split("def call_claude")[0]
    assert "include_usage" in grok
    impl = src.split("def _analyze_ticker_impl")[1].split("def run_portfolio_summary")[0]
    assert impl.count("usage_capture=_bill") >= 3


def test_cutoff_report_is_not_complete():
    import DGA_analyst as analyst
    body = "# SECTION 7 — VALUATION\n" + ("comps table line\n" * 80)
    assert analyst.report_tail_gap(body, "grok") == "missing the Munger section"
    partial = (
        body
        + "\n# SECTION 8 — The Verdict\nbase case.\n"
        + "### 8.5.1 Circle of Competence\nInside the circle.\n"
        + "### 8.5.2 Invert\nIt loses money if leverage breaks.\n"
        + "### 8.5.3 Moat, Incentives & Two-Track Analysis\n"
        + "The moat is the license. Incentives are mixed.\n"
    )
    gap = analyst.report_tail_gap(partial, "grok")
    assert gap is not None and "8.5.4" in gap and "8.5.7" in gap
    done = partial + (
        "### 8.5.4 Latticework\nModels interact.\n"
        "### 8.5.5 Psychology\nSocial proof.\n"
        "### 8.5.6 Labels\nSIT-ON-YOUR-ASS.\n"
        "### 8.5.7 What Munger Would Likely Do\n"
        + ("Pass. The price does not clear a margin of safety.\n" * 4)
    )
    assert analyst.report_tail_gap(done, "grok") is None


def test_failed_analyze_files_an_auto_ticket():
    src = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    assert "def _analyze_auto_ticket" in src
    assert "clear_analyze_auto_log" in src
    assert "file_analyze_auto_log" in src
    tickets = (ROOT / "api" / "domains" / "support_tickets.py").read_text(encoding="utf-8")
    assert "AUTO_ANALYZE_" in tickets
    assert "auto_analyze" in tickets


def test_analyze_does_not_blame_gamma_for_llm_timeout():
    src = (ROOT / "DGA_analyst.py").read_text(encoding="utf-8")
    hb = src.split("def call_llm_with_heartbeat")[1].split("def extract_thesis_snippet")[0]
    assert "disable Gamma" not in hb
    assert "idle_cap" in hb
    assert "silent_cap" in hb
    grok = src.split("def call_grok")[1].split("def call_claude")[0]
    assert "GROK_LIVE_SEARCH_TIMEOUT_S" in grok
    assert "_bounded_call" in grok
    gamma = src.split("def _gamma_generate")[1].split("def analyze_ticker")[0]
    assert '"folderIds": [GAMMA_FOLDER_ID] if GAMMA_FOLDER_ID else None' not in gamma
    assert 'payload["folderIds"]' in gamma
