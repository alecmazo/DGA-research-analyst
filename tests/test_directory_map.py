"""Settings → Directories is the map of this checkout and its branches."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_settings_directory_map_shows_the_checkout_and_branches():
    page = (ROOT / "web/gp-app/src/pages/SettingsPage.tsx").read_text(encoding="utf-8")
    section = (ROOT / "web/gp-app/src/pages/settings/DirectorySection.tsx").read_text(encoding="utf-8")
    data = (ROOT / "web/gp-app/src/pages/settings/directoryMap.ts").read_text(encoding="utf-8")
    rule = (ROOT / ".cursor/rules/directory-map.mdc").read_text(encoding="utf-8")
    assert "Directories" in page
    assert "#set-directories" in page
    assert "DirectorySection" in page
    assert "On this Mac" in section
    assert "Inside the checkout" in section
    assert "Branches" in section
    assert "/Users/dplvideo/.grok/worktrees/DGA-Research-Portal/2026-07-13-3a2bb445" in data
    assert "dga-research-portal" in data
    assert "scripts/ollama_desk.py" in data
    assert "A branch is a line of commits, not another folder." in data
    assert "directoryMap.ts" in rule
    assert "DIRECTORY_UPDATED" in data
