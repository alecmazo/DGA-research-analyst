"""Portfolio recommendations open in their own window, not inside the card."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _fn(src: str, name: str) -> str:
    start = src.index(f"def {name}")
    nxt = src.find("\ndef ", start + 4)
    return src[start:] if nxt < 0 else src[start:nxt]


def test_portfolio_save_is_not_a_ticker_note():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    save = _fn(src, "local_portfolio_save")
    assert "local_portfolio_reports" in save
    assert "lp_id" in save
    assert "analyst_reports" not in save
    assert "_persist_analysis_text" not in save
    assert "dropbox" not in save.lower()
    assert "@app.get(\"/api/local/portfolio-reports\")" in src
    assert "@app.get(\"/api/local/portfolio-reports/{report_id}\")" in src
    one = _fn(src, "local_portfolio_report_one")
    assert "id = %s AND lp_id = %s" in one


def test_local_page_lists_reviews_beside_portfolio():
    page = (ROOT / "web/gp-app/src/pages/LocalPage.tsx").read_text(encoding="utf-8")
    assert "Portfolio recommendations" in page
    assert "openPortfolioReport" in page
    assert "/api/local/portfolio-save" in page
    assert "review?.answer" not in page
    css = (ROOT / "web/gp-app/src/pages/LocalPage.module.css").read_text(encoding="utf-8")
    assert ".pair" in css
    app = (ROOT / "web/gp-app/src/App.tsx").read_text(encoding="utf-8")
    assert 'path="local-portfolio"' in app
    window = (ROOT / "web/gp-app/src/pages/LocalPortfolioPage.tsx").read_text(encoding="utf-8")
    assert "md-table" not in window
    assert "renderMd" in window
    sheet = (ROOT / "web/gp-app/src/pages/LocalPortfolioPage.module.css").read_text(encoding="utf-8")
    assert ".md-table" in sheet
