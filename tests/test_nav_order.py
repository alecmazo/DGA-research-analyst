"""The top menu can be reordered. The first page opens with the portal."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_menu_move_puts_the_first_page_on_open():
    lib = (ROOT / "web/gp-app/src/lib/navOrder.ts").read_text(encoding="utf-8")
    top = (ROOT / "web/gp-app/src/components/layout/Topbar.tsx").read_text(encoding="utf-8")
    app = (ROOT / "web/gp-app/src/App.tsx").read_text(encoding="utf-8")
    assert "dga.nav.order" in lib
    assert "export function shiftNav" in lib
    assert "export function placeNavBefore" in lib
    assert "export function portalHomePath" in lib
    assert "munger: '/munger'" in lib
    assert "desk: '/desk'" in lib
    assert "Move menu" in top
    assert "Move ${label} left" in top
    assert "Move ${label} right" in top
    assert "placeNavBefore" in top
    assert "path=\"desk\"" in app
    assert "<HomeGate />" in app
    assert "portalHomePath" in app


def test_shift_and_home_follow_the_saved_order():
    import json
    import subprocess

    script = r"""
import { NAV_IDS, placeNavBefore, portalHomePath, shiftNav } from './web/gp-app/src/lib/navOrder.ts'
const mungerFirst = NAV_IDS.filter((id) => id !== 'munger')
mungerFirst.unshift('munger')
const stepped = NAV_IDS.reduce((order) => shiftNav(order, 'munger', -1), [...NAV_IDS])
const dropped = placeNavBefore(NAV_IDS, 'munger', 'desk')
console.log(JSON.stringify({
  home: portalHomePath(false, mungerFirst),
  desk: portalHomePath(false, NAV_IDS),
  book: portalHomePath(false, ['book', 'munger', 'desk']),
  local: portalHomePath(false, ['local', 'ideas']),
  localMac: portalHomePath(true, ['local', 'ideas']),
  stepped: stepped[0],
  dropped: dropped.slice(0, 2),
}))
"""
    out = subprocess.check_output(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        cwd=ROOT,
        text=True,
    )
    data = json.loads(out)
    assert data["home"] == "/munger"
    assert data["desk"] == "/desk"
    assert data["book"] == "/munger"
    assert data["local"] == "/ideas"
    assert data["localMac"] == "/local"
    assert data["stepped"] == "munger"
    assert data["dropped"] == ["munger", "desk"]
