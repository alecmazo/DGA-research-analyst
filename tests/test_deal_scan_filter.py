"""Scan results can be limited to cash, or to cash and stock, without another scan."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_scan_results_let_you_choose_the_offer():
    src = (ROOT / "web/gp-app/src/pages/DealScan.tsx").read_text(encoding="utf-8")
    assert 'aria-label="Offer type"' in src
    assert ">Cash only<" in src
    assert ">Cash and stock<" in src
    assert "offerKind" in src
    assert "consideration_type" in src
