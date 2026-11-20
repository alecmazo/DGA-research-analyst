"""Saved Reports shows a Gamma button when a deck link is stored."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_saved_reports_row_opens_the_gamma_deck():
    saved = (ROOT / "web/gp-app/src/components/desk/SavedReports.tsx").read_text()
    assert "rep.gamma_url" in saved
    assert "Open the Gamma deck" in saved
    assert "pillGamma" in saved
    assert "Gamma" in saved
    assert "e.stopPropagation()" in saved
    api = (ROOT / "web/gp-app/src/lib/api.ts").read_text()
    assert "gamma_url?: string | null" in api


def test_later_analyze_keeps_an_existing_gamma_link():
    server = (ROOT / "api/server.py").read_text()
    keep = "gamma_url           = COALESCE(EXCLUDED.gamma_url, analyst_reports.gamma_url)"
    assert server.count(keep) == 2
