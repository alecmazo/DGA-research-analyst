"""The index tape paints its own green and red. Global pos/neg vanish on navy."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_ribbon_uses_module_up_down_not_global_pos():
    tsx = (ROOT / "web/gp-app/src/components/layout/MarketRibbon.tsx").read_text()
    css = (ROOT / "web/gp-app/src/components/layout/MarketRibbon.module.css").read_text()
    assert "pctClass" not in tsx
    assert "styles.up" in tsx
    assert "styles.down" in tsx
    assert ".chg.pos" not in css
    assert ".chg.neg" not in css
    assert ".up" in css and "#4ade80" in css
    assert ".down" in css and "#f87171" in css
    assert "animation: none" in css
