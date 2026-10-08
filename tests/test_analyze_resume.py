"""Analyze Ticker must still show progress after leaving Desk and coming back."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_analyze_card_reattaches_live_job():
    src = (ROOT / "web/gp-app/src/components/desk/AnalyzeCard.tsx").read_text(
        encoding="utf-8"
    )
    assert "ACTIVE_JOB_KEY" in src
    assert "dga.analyze.active.v1" in src
    assert "followJob" in src
    assert "/api/jobs" in src
    assert "Still running" in src
    assert "pollAbort" in src


def test_poll_job_honors_abort_signal():
    src = (ROOT / "web/gp-app/src/lib/jobs.ts").read_text(encoding="utf-8")
    assert "signal?: AbortSignal" in src
    assert "status: 'aborted'" in src
    assert "signal?.aborted" in src


def test_list_jobs_route_exists():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    assert '@app.get("/api/jobs")' in src
    assert "def list_jobs" in src
    assert 'WEB_BUILD_VERSION = "ui731-20261008-city-view"' in src
    analyst = (ROOT / "DGA_analyst.py").read_text(encoding="utf-8")
    assert '_optional_env("GROK_MODEL", "grok-4.7")' in analyst
    assert '"agentic"' in analyst and '"default": "grok"' in analyst
    assert '"grok-4.7":' in analyst
