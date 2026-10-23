"""Generate on one account writes that account, with the model he picked.

The year-to-date table stores fund_id as UUID. Comparing it to a text array
dropped the clicked account's trades. get_ytd_attribution then returned every
fund, so the section was not his book. The request also ignored his model.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = (ROOT / "api" / "server.py").read_text(encoding="utf-8")


def _fn(name: str, until: str) -> str:
    return SRC.split(f"def {name}", 1)[1].split(until, 1)[0]


def test_one_account_generate_uses_that_account_and_the_chosen_model():
    activity = _fn("_quarterly_activity_context", "\n_QUARTERLY_LETTER_SYSTEM")
    assert "fund_id::text = ANY" in activity

    section = _fn(
        "research_quarterly_letter_fund_section",
        '@app.get("/api/quarterly-letter/funds")',
    )
    assert "fund_ids=[fund_id]" in section
    assert "ACCOUNT:" in section
    assert "Choose a model." in section
    assert 'provider == "local"' in section
    assert "has no live holdings to write from." in section
    assert "No live positions for" not in section
    assert "127.0.0.1" not in section
    assert "ollama" not in section.lower()

    kick = _fn("_qletter_kick", "def research_quarterly_letter_intro")
    assert '"llm_provider": provider' in kick
    assert '"get_ytd_attribution"' in kick
    assert '"read_saved_report"' in kick

    theses = _fn("_qletter_thesis_block", "def _qletter_provider")
    assert "No thesis is saved" in theses
