"""Two-layer continuity kit: short briefing + product encyclopedia."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_financials_page_shows_what_the_company_does():
    sheet = (ROOT / "web/gp-app/src/pages/financials/ValueLineSheet.tsx").read_text()
    assert 'title="📈 Financials"' in sheet
    assert "defaultOpen={false}" not in sheet
    dash = (ROOT / "web/gp-app/src/pages/financials/CompanyDashboard.tsx").read_text()
    assert "business_summary" in dash
    body = (ROOT / "api/domains/_financials_body.py").read_text()
    assert "def _company_business_summary" in body
    assert "sec-10k" in body
    assert '/api/financials/{ticker}/statements' in body
    sheet = (ROOT / "web/gp-app/src/pages/financials/ValueLineSheet.tsx").read_text()
    assert "Income statement" in sheet
    assert "id === 'assets'" in sheet
    assert "_warm_quotes_for_comps(list(fins.keys())" not in body


def test_continuity_files_exist():
    kit = ROOT / "docs" / "continuity"
    assert (kit / "README.md").is_file()
    assert (kit / "HANDOFF.md").is_file()
    assert (kit / "PRODUCT_LOG.md").is_file()
    assert (ROOT / "CONTINUITY.md").is_file()


def test_product_log_covers_surfaces():
    text = (ROOT / "docs" / "continuity" / "PRODUCT_LOG.md").read_text()
    for needle in (
        "Desk",
        "Financials",
        "Builder",
        "Accounts",
        "Options",
        "Valuation",
        "Support tickets",
        "WEB_BUILD_VERSION",
        "demo@dgacapital.com",
        "DCF User",
        "SnapTrade",
    ):
        assert needle in text, needle


def test_sliw_videos_are_not_redeployed():
    ignore = (ROOT / ".railwayignore").read_text()
    assert "apps/sliw-agent/**/*.mp4" in ignore
    assert "apps/sliw-agent/**/*.mp4" in (ROOT / ".dockerignore").read_text()
    src = (ROOT / "api" / "server.py").read_text()
    assert "/data/sliw-media" in src
    assert "if dest.is_file():" in src
    assert "A file already on the volume is left alone" in src


def test_analyze_step_graphics():
    steps = ROOT / "web" / "gp-app" / "public" / "analyze-steps"
    for name in (
        "filings",
        "financials",
        "market",
        "write",
        "word",
        "deck",
        "upload",
        "done",
    ):
        assert (steps / f"{name}.mp4").is_file(), name
        assert (steps / f"{name}.jpg").is_file(), name
    src = (ROOT / "web" / "gp-app" / "src" / "components" / "ui" / "AnalysisScene.tsx").read_text()
    assert "stepPack" in src
    assert "analyze-steps" in src


def test_server_has_two_layer_endpoints():
    src = (ROOT / "api" / "server.py").read_text()
    assert '@app.get("/api/continuity/handoff")' in src
    assert '@app.get("/api/continuity/product-log")' in src
    assert '@app.get("/api/continuity/version-log")' in src
    assert '@app.get("/api/continuity/package")' in src
    assert "docs/continuity/PRODUCT_LOG.md" in src
    # Short briefing must NOT embed the entire CONTINUITY.md
    pack_fn = src.split("def _continuity_pack")[1].split("def ")[0]
    assert "PRODUCT_LOG.md" in pack_fn
    assert "cont_md" not in pack_fn


def test_briefing_agent_gets_the_repo():
    """Alec copies/pastes. The new agent clones or pulls. No Terminal homework."""
    src = (ROOT / "api" / "server.py").read_text()
    pack_fn = src.split("def _continuity_pack")[1].split("def ")[0]
    assert "Copy briefing for next agent" in pack_fn
    assert "github.com/alecmazo/DGA-research-analyst" in pack_fn
    assert "Get the code yourself" in pack_fn
    assert "log in to GitHub" in pack_fn
    assert "Do **not** ask him to open Terminal" in pack_fn
    assert "you, the agent" in pack_fn
    tsx = (ROOT / "web/gp-app/src/pages/settings/HandoffSection.tsx").read_text()
    assert "On the <em>new</em> computer: clone" not in tsx
    assert "Copy briefing for next agent" in tsx
    assert "Copy mobile speed prompt" in tsx
    assert "You do not clone" in tsx
    speed = src.split("def _continuity_speed_prompt")[1].split("def ")[0]
    assert "docs/mobile-speed/CHECKLIST.md" in speed
    assert "docs/mobile-speed/RUNS.md" in speed
    assert "docs/continuity/PRODUCT_LOG.md" in speed
    assert "CONTINUITY.md" in speed
    assert "LLM_COORDINATION.md" in speed
    assert "python3 docs/mobile-speed/measure.py" in speed
    assert "speed_paste_markdown" in src
    assert "cont_md" not in speed
    readme = (ROOT / "docs/continuity/README.md").read_text()
    assert "Alec does **not** clone" in readme
    handoff = (ROOT / "docs/continuity/HANDOFF.md").read_text()
    assert "Get the code yourself" in handoff
    assert "log in to GitHub" in handoff
    assert "support fix trail" in pack_fn.lower() or "fix trail" in pack_fn
    assert "/api/support/tickets" in pack_fn
    assert "Download package" in tsx
    assert "Download briefing" not in tsx
    assert "Download product log" not in tsx
    assert "Download version log" not in tsx
    assert "records" in tsx.lower()
    assert "GitHub" in tsx
    assert "fix trail" in tsx.lower()
