"""The local brief is the right-hand rail on Ideas, Financials, and the desk."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_brief_lists_installed_models_and_defaults_to_gpt_oss():
    src = _read("web/gp-app/src/lib/localOllama.ts")
    brief = _read("web/gp-app/src/components/desk/CompanyBrief.tsx")
    assert "export async function listInstalledModels" in src
    assert "brief: 'dga.local.brief.model'" in src
    assert "listInstalledModels" in brief
    assert "LOCAL_PICK_KEYS.brief" in brief
    assert "'gpt-oss'" in brief
    assert "Do not invent prices" in brief


def test_brief_opens_on_ideas_financials_and_desk_lists():
    ideas = _read("web/gp-app/src/pages/IdeasPage.tsx")
    desk = _read("web/gp-app/src/pages/DeskPage.tsx")
    financials = _read("web/gp-app/src/pages/FinancialsPage.tsx")
    assert "CompanyBrief" in ideas
    assert "setSelected(ticker)" in ideas
    assert ideas.count("setBriefTk") == 0
    assert desk.count("setBriefTk(tk)") == 2
    assert 'variant="overlay"' in desk
    assert "TopMovers onPeek={openPeek}" in desk.replace("\n", " ")
    assert "CompanyBrief" in financials
    assert "data-local-brief" in ideas
    assert "data-local-brief" in financials
