"""Two-layer continuity kit: short briefing + product encyclopedia."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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
    assert "You do not clone" in tsx
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
