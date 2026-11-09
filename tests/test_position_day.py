"""Open-position day dollars and the monthly YTD path."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "web" / "gp-app" / "src" / "pages" / "fund" / "positionDay.ts"


def _call(fn: str, arg_js: str):
    script = f"""
import {{ {fn} }} from {json.dumps(str(HELPER))};
process.stdout.write(JSON.stringify({fn}({arg_js})));
"""
    out = subprocess.run(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout)


def test_day_dollars_are_the_move_from_the_prior_close():
    # 10 shares, prior close 90, last 100. Percent is 11.111..., value is $1,000.
    # The position made $100, not $111.
    dollars = _call("positionDayDollars", "1000, (100 - 90) / 90 * 100")
    assert abs(dollars - 100) < 0.01


def test_a_down_day_is_negative_dollars():
    # Last 80, prior 100, value $800. Lost $200.
    dollars = _call("positionDayDollars", "800, (80 - 100) / 100 * 100")
    assert abs(dollars - (-200)) < 0.01


def test_cash_and_missing_quotes_stay_blank():
    assert _call("positionDayDollars", "1000, null") is None
    assert _call("positionDayDollars", "null, 1.2") is None


def test_each_month_carries_the_compounded_ytd():
    path = _call(
        "portfolioYtdPath",
        json.dumps([
            {"return_pct": 4.07},
            {"return_pct": -0.40},
            {"return_pct": None, "skip": True},
        ]),
    )
    assert abs(path[0] - 4.07) < 1e-9
    expected = ((1.0407 * 0.996) - 1) * 100
    assert abs(path[1] - expected) < 1e-9
    assert abs(path[2] - expected) < 1e-9
