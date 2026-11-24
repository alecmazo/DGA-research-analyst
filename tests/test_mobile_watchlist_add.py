"""The phone adds a ticker to the same watchlist the desk uses."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_phone_add_writes_the_desk_watchlist():
    client = (ROOT / "mobile/src/api/client.js").read_text(encoding="utf-8")
    assert "request('/api/watchlist'" in client
    assert "JSON.stringify({ ticker:" in client
    assert "request(`/api/watchlist/${ticker}`" not in client
    board = (ROOT / "mobile/src/screens/WatchlistBoardScreen.js").read_text(encoding="utf-8")
    assert "Add ticker" in board
    assert "api.addToWatchlist" in board
    assert "api.getWatchlist(true)" in board
    assert "hold to remove" in board
    server = (ROOT / "api/server.py").read_text(encoding="utf-8")
    add = server.split("def watchlist_add")[1].split("\ndef ")[0]
    assert "_bust_watchlist_paint(lp_id)" in add
    assert "_wl_add_db(lp_id, tk)" in add
