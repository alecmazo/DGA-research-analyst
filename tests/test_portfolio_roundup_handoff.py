"""Portfolio Roundup starts from a saved strategist review. Podcasts follows the job."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_roundup_is_on_the_saved_review_not_beside_run_review():
    card = (ROOT / "web/gp-app/src/components/desk/StrategistCard.tsx").read_text()
    head, result = card.split("{result && (", 1)
    assert "Run review" in head
    assert "Generate Portfolio Roundup" not in card
    assert "handoffRoundup" not in card
    assert "Portfolio roundup" in result
    assert "void handoffReview(rv)" in card
    handoff = card.split("const handoffReview", 1)[1].split("const viewArchive", 1)[0]
    assert "review_id: rv.id" in handoff
    assert "fund_ids:" not in handoff
    assert "roundup=" in card
    page = (ROOT / "web/gp-app/src/pages/PodcastsPage.tsx").read_text()
    assert "searchParams.get('roundup')" in page
    assert "pollScriptStatus(job)" in page
    srv = (ROOT / "api/server.py").read_text()
    fn = srv.split("def podcast_generate_portfolio_roundup")[1].split("\n@app.")[0]
    assert "review_id" in fn
    assert "fund_ids" in fn
    assert "_load_fund_positions" in fn
    assert "_combine_fund_positions" in fn
    assert 'claims.get("demo_mode")' in fn
    assert "Need at least 5 tickers" in fn
    persist = srv.split("def _persist_strategist_review")[1].split("\ndef ")[0]
    assert "positions" in persist
    book = srv.split("def _book_from_strategist_review")[1].split("\n@app.")[0]
    assert "has_book" in book or "stored" in book
    assert "_fund_id_by_exact_name" in book
    engine = (ROOT / "podcast_engine.py").read_text()
    gen = engine.split("def generate_portfolio_roundup_script")[1].split("\ndef ")[0]
    assert "review_brief" in gen
    assert "COMMITTEE REVIEW ON FILE" in gen
