"""On this Mac, frontier desk reports and local reports sit side by side."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_local_page_compares_desk_and_local_reports():
    page = (ROOT / "web/gp-app/src/pages/LocalPage.tsx").read_text(encoding="utf-8")
    css = (ROOT / "web/gp-app/src/pages/LocalPage.module.css").read_text(encoding="utf-8")
    saved = (ROOT / "web/gp-app/src/components/desk/SavedReports.tsx").read_text(encoding="utf-8")
    assert "Run desk reports" in page
    pair = page.split('className={`${styles.pair} ${styles.saved}`}', 1)[1].split("\n      </div>", 1)[0]
    assert pair.count("<SavedReports") == 2
    assert "Desk saved reports" in pair
    assert "frontier" in pair
    assert "Saved Local Reports" in pair
    desk, local = pair.split("<SavedReports", 2)[1:]
    assert "provider=" not in desk
    assert 'provider="local"' in local
    assert "provider = 'grok'" in saved
    assert "local ? '/api/local/reports' : '/api/reports'" in saved
    assert "grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)" in css
    narrow = css.split("@media (max-width: 960px)", 1)[1]
    assert ".pair" in narrow
    assert "grid-template-columns: 1fr" in narrow
