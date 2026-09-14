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
    assert "docs/continuity/PRODUCT_LOG.md" in src
    # Short briefing must NOT embed the entire CONTINUITY.md
    pack_fn = src.split("def _continuity_pack")[1].split("def ")[0]
    assert "PRODUCT_LOG.md" in pack_fn
    assert "cont_md" not in pack_fn
