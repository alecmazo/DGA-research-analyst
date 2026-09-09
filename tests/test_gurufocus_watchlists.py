"""GuruFocus watchlists are snapshotted and listed on Builder."""

from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from domains.gurufocus_watchlists import get_list, list_summaries  # noqa: E402


def test_seed_has_every_watchlist():
    data = json.loads((ROOT / "api/data/gurufocus_watchlists.json").read_text())
    names = {x["name"] for x in data["lists"]}
    assert len(data["lists"]) == 37
    assert "Watchlist 2021" in names
    assert "tech" in names
    assert "Commodities" in names
    assert "10B-50B Banks" in names
    stocks = sum(x["stock_count"] for x in data["lists"])
    assert stocks >= 680


def test_first_added_dates_present():
    data = json.loads((ROOT / "api/data/gurufocus_watchlists.json").read_text())
    wl = next(x for x in data["lists"] if x["name"] == "Watchlist 2021")
    txn = next(s for s in wl["stocks"] if s["symbol"] == "TXN")
    assert txn["date_first_added"] == "2021-10-12"
    assert txn["cost_per_share"] is not None


def test_summaries_put_overview_first():
    d = list_summaries()
    assert d["ok"]
    assert d["lists"][0]["id"] == "overview"
    assert d["list_count"] == 37
    ov = get_list("overview")
    assert ov["ok"]
    assert ov["list"]["stock_count"] >= 680


def test_builder_tab_label():
    src = (ROOT / "web/gp-app/src/pages/BuilderPage.tsx").read_text()
    assert "Gurufocus" in src
    assert "GuruFocusTab" in src
    assert "tab === 'gurufocus'" in src
