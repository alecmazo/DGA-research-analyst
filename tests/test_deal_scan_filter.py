"""Deal table can be limited to cash, or to cash and stock, without another scan."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_scan_results_let_you_choose_the_offer():
    src = (ROOT / "web/gp-app/src/pages/MergerArbPage.tsx").read_text(encoding="utf-8")
    assert 'label="Type"' in src
    assert "Cash only" in src
    assert "Cash and stock" in src
    scan = (ROOT / "web/gp-app/src/pages/DealScan.tsx").read_text(encoding="utf-8")
    assert "dealLine" not in scan
    assert "subjectOf" not in scan
    assert "buyerPhrase" not in scan
