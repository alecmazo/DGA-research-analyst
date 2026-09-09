"""Track boards must switch without waiting on Yahoo / DCF rebuild."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _fn_src(name: str) -> str:
    text = (ROOT / "api" / "server.py").read_text()
    start = text.index(f"def {name}")
    nxt = text.find("\ndef ", start + 1)
    return text[start:nxt]


def test_board_quotes_skip_yahoo_and_yfinance():
    body = _fn_src("_builder_board_quotes")
    assert "_QUOTE_CACHE" in body
    assert "_db_quotes" in body
    assert "batch_quotes(" not in body
    assert "market_data" not in body
    assert "get_quotes" not in body


def test_list_board_uses_fast_board_quotes():
    body = _fn_src("_builder_list_board")
    assert "_builder_board_quotes" in body
    assert "batch_quotes(" not in body
    # One-time hist repair is not on the click path.
    assert "_builder_repair_wrong_anchors" not in body


def test_board_get_does_not_force_dcf_rebuild():
    body = _fn_src("builder_list_board_get")
    assert "force=True" not in body
    assert "force=False" in body


def test_builder_page_caches_and_prefetches_boards():
    src = (ROOT / "web/gp-app/src/pages/BuilderPage.tsx").read_text()
    assert "boardCache" in src
    assert "fetchBoard" in src
    assert "boardCache.current[l.id]" in src
    assert "await fetchBoard(l.id, false)" in src
    # Boards tab must not wait on construct candidates.
    assert "listsLoading" in src
    assert "candsLoading" in src
    assert "Promise.all([loadLists(), loadCandidates" not in src
