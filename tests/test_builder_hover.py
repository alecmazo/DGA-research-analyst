"""Builder board hover snapshot must close when the pointer leaves the list."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_builder_schedules_close_on_row_leave():
    src = (ROOT / "web/gp-app/src/pages/BuilderPage.tsx").read_text()
    assert "scheduleClose" in src
    assert "onBoardLeave" in src
    # Row leave used to only cancel the open timer — peek stayed on screen.
    leave = src.split("const onBoardLeave", 1)[1].split("\n  }", 1)[0]
    assert "scheduleClose" in leave
    assert "setPeekTk(null)" in src
    assert "closePeek" in src


def test_builder_peek_keeps_then_closes_on_card_leave():
    src = (ROOT / "web/gp-app/src/pages/BuilderPage.tsx").read_text()
    assert "onHoverEnter={clearCloseTimer}" in src
    assert "onHoverLeave={scheduleClose}" in src
    peek = (ROOT / "web/gp-app/src/components/layout/StockPeek.tsx").read_text()
    assert "onHoverEnter" in peek
    assert "onMouseLeave={onHoverLeave}" in peek


def test_passthrough_peek_has_no_page_dim():
    css = (ROOT / "web/gp-app/src/components/layout/StockPeek.module.css").read_text()
    block = css.split(".overlayPass", 1)[1].split("}", 1)[0]
    assert "transparent" in block
    assert "rgba(10, 22, 40, 0.12)" not in block
