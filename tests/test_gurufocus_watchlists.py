"""GuruFocus watchlists are snapshotted and listed on Builder."""

from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from domains.gurufocus_watchlists import (  # noqa: E402
    get_list,
    list_summaries,
    parse_tickers,
    snapshot_symbols,
    stock_row,
)


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


def test_parse_tickers_splits_commas_and_spaces():
    assert parse_tickers("nvda, AMD  rklb") == ["NVDA", "AMD", "RKLB"]
    assert parse_tickers(["LUNR", "lunr", "PL"]) == ["LUNR", "PL"]


def test_add_merges_without_duplicating_snapshot():
    data = json.loads((ROOT / "api/data/gurufocus_watchlists.json").read_text())
    space = next(x for x in data["lists"] if x["name"] == "Space")
    lid = str(space["id"])
    have = snapshot_symbols(lid)
    assert "FLY" in have
    extra = [stock_row("NEWCO", "Space", {"price": 10.0, "pct_change": 1.5}, "2026-09-09")]
    out = get_list(lid, extra_stocks=extra)
    syms = [s["symbol"] for s in out["list"]["stocks"]]
    assert "NEWCO" in syms
    assert out["list"]["stock_count"] == space["stock_count"] + 1


def test_ui_add_field_sits_next_to_watchlist_name():
    src = (ROOT / "web/gp-app/src/pages/builder/GuruFocusTab.tsx").read_text()
    assert "titleRow" in src
    assert "Add tickers" in src
    assert "/tickers" in src
    assert "active !== 'overview'" in src
    css = (ROOT / "web/gp-app/src/pages/builder/GuruFocusTab.module.css").read_text()
    assert ".titleRow" in css
    assert ".addInput" in css


def test_server_has_add_tickers_route():
    text = (ROOT / "api" / "server.py").read_text()
    assert '@app.post("/api/v2/builder/gurufocus/{list_id}/tickers")' in text
    assert "gurufocus_local_tickers" in text
