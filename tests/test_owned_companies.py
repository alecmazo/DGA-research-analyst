"""Owned Companies is a display split of the watchlist, not a second list."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _owned_on_watchlist():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    start = src.find("def owned_on_watchlist")
    end = src.find("\ndef _held_tickers")
    ns: dict = {}
    exec(src[start:end], ns)
    return ns["owned_on_watchlist"]


def test_owned_on_watchlist_is_the_intersection():
    owned_on_watchlist = _owned_on_watchlist()
    held = {"AAPL", "NVDA"}
    assert owned_on_watchlist(["msft", "AAPL", "aapl", "", "NVDA"], held) == [
        "AAPL",
        "NVDA",
    ]
    assert owned_on_watchlist(["MSFT"], held) == []
    assert owned_on_watchlist([], held) == []


def test_watchlist_payload_names_owned_tickers():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    start = src.find("def watchlist_get")
    chunk = src[start : src.find("def mobile_home")]
    assert "owned_on_watchlist" in chunk
    assert '"owned_tickers": owned_tickers' in chunk
    assert "_held_tickers(demo=_request_is_demo(request))" in chunk
    assert "_dga_book_tickers" not in chunk


def test_desk_seats_owned_under_the_watchlist():
    board = (ROOT / "web/gp-app/src/components/desk/DeskBoard.tsx").read_text(
        encoding="utf-8"
    )
    assert "| 'owned'" in board
    assert "seatOwnedUnderWatchlist" in board
    assert "owned: { x: 0, y: 376, w: 400, h: 220 }" in board
    desk = (ROOT / "web/gp-app/src/pages/DeskPage.tsx").read_text(encoding="utf-8")
    assert "title: 'Owned Companies'" in desk
    assert "trackingRows" in desk
    assert "owned_tickers" in desk
    mobile = (ROOT / "mobile/src/screens/WatchlistBoardScreen.js").read_text(
        encoding="utf-8"
    )
    assert ">Owned Companies</SectionHeader>" in mobile
    assert "trackingRows" in mobile
