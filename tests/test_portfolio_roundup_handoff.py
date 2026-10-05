"""Portfolio Roundup starts from the strategist card and Podcasts follows the job."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_standing_roundup_opens_podcasts_on_the_job():
    card = (ROOT / "web/gp-app/src/components/desk/StrategistCard.tsx").read_text()
    head, result = card.split("{result && (", 1)
    assert "Generate Portfolio Roundup" in head
    assert "Generate Portfolio Roundup" not in result
    assert "roundup=" in card
    assert "fund_ids: selected" in card
    assert "parse_only" not in card.split("const handoffRoundup", 1)[1].split(
        "const handoffReview", 1
    )[0]
    page = (ROOT / "web/gp-app/src/pages/PodcastsPage.tsx").read_text()
    assert "searchParams.get('roundup')" in page
    assert "pollScriptStatus(job)" in page
    srv = (ROOT / "api/server.py").read_text()
    fn = srv.split("def podcast_generate_portfolio_roundup")[1].split("\n@app.")[0]
    assert "fund_ids" in fn
    assert "_load_fund_positions" in fn
    assert "_combine_fund_positions" in fn
    assert 'claims.get("demo_mode")' in fn
    assert "Need at least 5 tickers" in fn
