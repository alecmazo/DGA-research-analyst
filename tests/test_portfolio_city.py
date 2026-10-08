"""Portfolio City groups the positions book. It does not invent a missing fact."""
import json
import math
import re
from pathlib import Path

from api.domains.portfolio_city import (
    H_MAX,
    H_MIN,
    SecCache,
    build_city,
    decide_privacy,
    snapshot_from_facts,
)
from api.domains.portfolio_city import create_router

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "portfolio_city"


def _load():
    return json.loads((FIX / "city_fixture.json").read_text())


def _city(**kwargs):
    raw = _load()
    privacy = kwargs.pop("privacy", False)
    book = kwargs.pop("positions", raw["positions"])
    facts = kwargs.pop("fundamentals", raw["fundamentals"])
    return build_city(book, facts, privacy=privacy)


def _by_id(payload):
    return {company["id"]: company for company in payload["companies"]}


def _check(node, schema, root):
    if "$ref" in schema:
        ref = schema["$ref"]
        assert ref.startswith("#/"), ref
        target = root
        for part in ref[2:].split("/"):
            target = target[part]
        _check(node, target, root)
        return
    types = schema.get("type")
    if isinstance(types, str):
        types = [types]
    if node is None:
        assert types is None or "null" in types, schema
        return
    if types:
        py = {"object": dict, "array": list, "string": str, "number": (int, float), "integer": int}
        assert any(isinstance(node, py[kind]) for kind in types if kind != "null"), (node, types)
        if "number" in types and isinstance(node, bool):
            raise AssertionError(node)
    if "const" in schema:
        assert node == schema["const"]
    if "enum" in schema:
        assert node in schema["enum"]
    if isinstance(node, (int, float)) and not isinstance(node, bool):
        if "minimum" in schema:
            assert node >= schema["minimum"]
        if "maximum" in schema:
            assert node <= schema["maximum"]
    if isinstance(node, str) and "pattern" in schema:
        assert re.match(schema["pattern"], node), node
    if isinstance(node, dict):
        for key in schema.get("required") or []:
            assert key in node, key
        props = schema.get("properties") or {}
        for key, value in node.items():
            if key in props:
                _check(value, props[key], root)
    if isinstance(node, list) and "items" in schema:
        for item in node:
            _check(item, schema["items"], root)


def test_schema_accepts_dollars_and_privacy():
    schema = json.loads((FIX / "portfolio-city.schema.json").read_text())
    full = _city()
    hidden = _city(privacy=True)
    _check(full, schema, schema)
    _check(hidden, schema, schema)
    assert "$" not in json.dumps(hidden)
    assert hidden["portfolio"]["total_value"] is None
    tsla = _by_id(hidden)["tsla"]
    assert tsla["position_value"] is None
    assert tsla["market_cap"] == 100_000_000_000
    assert tsla["book_equity"] == 10_000_000_000
    for holder in tsla["holders"]:
        assert holder["position_value"] is None


def test_book_sums_across_managed_and_lp_and_matches_within_a_dollar():
    raw = _load()
    payload = _city()
    rows = raw["positions"]["positions"]
    row_total = sum(row["market_value"] for row in rows)
    assert abs(payload["portfolio"]["total_value"] - row_total) < 1
    companies = _by_id(payload)
    assert abs(sum(company["position_value"] for company in payload["companies"]) - row_total) < 1
    assert abs(sum(company["weight"] for company in payload["companies"]) - 1) < 1e-6
    tsla = companies["tsla"]
    assert tsla["position_value"] == 100_000
    assert len(tsla["holders"]) == 2
    assert [band["source_type"] for band in tsla["bands"]] == ["managed_account", "lp_fund"]
    assert tsla["bands"][0]["share"] == 0.6
    assert abs(tsla["bands"][1]["share"] - 0.4) < 1e-9
    hidden = _by_id(_city(privacy=True))["tsla"]
    assert [band["source_type"] for band in hidden["bands"]] == ["managed_account", "lp_fund"]
    assert hidden["bands"][0]["share"] == 0.6


def test_gse_is_one_tower_and_preferreds_are_not_market_cap():
    gse = _by_id(_city())["gse"]
    assert gse["position_value"] == 17_500
    assert {member["ticker"] for member in gse["members"]} == {"FMCC", "FMCCJ", "FNMAP"}
    # FMCC 2 * 1e9 shares + FNMA 3 * 1e9 shares. The preferred price of 8 is not added.
    assert gse["market_cap"] == 5_000_000_000
    assert gse["book_equity"] == 9_000_000_000
    assert gse["total_assets"] == 3_000_000_000_000
    assert gse["equity_to_market_cap"] == 1.8
    assert gse["equity_band"] == {"side": "up", "fraction": 1.0}
    assert "FMCC" in gse["total_assets_as_of"] and "FNMA" in gse["total_assets_as_of"]
    assert gse["archetype"] == "speculative_beacon"
    assert gse["animation"]["flicker"] == 0.6


def test_gse_market_cap_is_null_when_either_common_is_missing():
    raw = _load()
    facts = dict(raw["fundamentals"])
    facts.pop("FNMA")
    gse = _by_id(_city(fundamentals=facts))["gse"]
    assert gse["market_cap"] is None
    assert gse["book_equity"] is None
    assert gse["equity_to_market_cap"] is None
    assert gse["equity_band"] is None
    assert gse["size"]["height_by_market_cap"] is None
    assert gse["position_value"] == 17_500


def test_market_cap_is_price_times_shares_with_no_millions_heuristic():
    book = {"book_as_of": "2026-10-07", "positions": [{
        "symbol": "AAA",
        "name": "Alpha",
        "account_name": "Managed",
        "source_type": "managed_account",
        "stake_pct": 100,
        "market_value": 1000,
        "last_price": 10,
    }]}
    facts = {"AAA": {"shares": 500, "shares_as_of": "2026-01-01", "market_cap_fallback": 9_999_999}}
    company = build_city(book, facts, privacy=False)["companies"][0]
    assert company["market_cap"] == 5000

    facts["AAA"] = {"shares": None, "market_cap_fallback": 999}
    company = build_city(book, facts, privacy=False)["companies"][0]
    assert company["market_cap"] == 999


def test_equity_band_ratio_and_drawn_fraction():
    def one(book_equity, cap_shares=1_000_000_000, price=100):
        book = {"as_of": "2026-10-07", "positions": [{
            "symbol": "C",
            "account_name": "Managed",
            "source_type": "managed_account",
            "market_value": 100,
            "last_price": price,
        }]}
        facts = {"C": {"shares": cap_shares, "book_equity": book_equity, "book_equity_as_of": "2025-12-31"}}
        return build_city(book, facts, privacy=False)["companies"][0]

    green = one(10_000_000_000)
    assert green["market_cap"] == 100_000_000_000
    assert green["equity_to_market_cap"] == 0.1
    assert green["equity_band"] == {"side": "up", "fraction": 0.1}

    red = one(-20_000_000_000)
    assert red["equity_to_market_cap"] == -0.2
    assert red["equity_band"] == {"side": "down", "fraction": 0.2}

    deep = one(-80_000_000_000)
    assert deep["equity_to_market_cap"] == -0.8
    assert deep["equity_band"]["fraction"] == 0.45

    rich = one(150_000_000_000)
    assert rich["equity_to_market_cap"] == 1.5
    assert rich["equity_band"]["fraction"] == 1.0

    blank = one(None)
    assert blank["equity_to_market_cap"] is None
    assert blank["equity_band"] is None


def test_heights_follow_sqrt_and_assets_follow_log10():
    payload = _city()
    companies = payload["companies"]
    cap_max = max(company["market_cap"] for company in companies if company["market_cap"])
    pos_max = max(company["position_value"] for company in companies)
    for company in companies:
        cap = company["market_cap"]
        if company["id"] == "cash":
            assert company["size"]["height_by_market_cap"] is None
            assert company["size"]["footprint_by_market_cap"] == 12
            assert company["equity_band"] is None
        elif not cap:
            assert company["size"]["height_by_market_cap"] is None
        else:
            expect = H_MIN + (H_MAX - H_MIN) * math.sqrt(cap / cap_max)
            assert abs(company["size"]["height_by_market_cap"] - expect) <= 0.1
        expect_pos = H_MIN + (H_MAX - H_MIN) * math.sqrt(company["position_value"] / pos_max)
        assert abs(company["size"]["height_by_position_value"] - expect_pos) <= 0.1
    # The smaller asset base sits at the floor of the log scale and the larger at the top.
    by_id = _by_id(payload)
    assert by_id["tsla"]["size"]["height_by_total_assets"] == H_MIN
    assert by_id["gse"]["size"]["height_by_total_assets"] == H_MAX
    assert by_id["spcx"]["size"]["height_by_total_assets"] is None
    assert payload["scale"]["market_cap"] == "sqrt"
    assert payload["companies"][0]["size"]["metric_default"] == "market_cap"


def test_tsla_keeps_gics_sector_and_the_tech_archetype():
    tsla = _by_id(_city())["tsla"]
    assert tsla["sector"] == "Consumer Discretionary"
    assert tsla["archetype"] == "tech_neon"
    assert tsla["archetype_override"] is True
    assert tsla["animation"]["flicker"] == 0
    assert tsla["daily_change_pct"] == 1.5
    assert tsla["volatility_1y"] is None


def test_failed_sec_lookup_is_null_and_cached():
    calls = {"n": 0}

    def fetch(_cik):
        calls["n"] += 1
        raise RuntimeError("sec down")

    clock = {"t": 1_000.0}
    cache = SecCache(fetch, clock=lambda: clock["t"], sleep=lambda _s: None, min_interval=0.1)
    assert cache.facts("0001") is None
    clock["t"] += 10
    assert cache.facts("0001") is None
    assert calls["n"] == 1
    company = build_city(
        {"positions": [{
            "symbol": "C",
            "account_name": "Managed",
            "source_type": "managed_account",
            "market_value": 10,
            "last_price": 2,
        }]},
        {},
        privacy=False,
    )["companies"][0]
    assert company["market_cap"] is None
    assert company["book_equity"] is None
    assert company["total_assets"] is None


def test_snapshot_uses_common_shares_not_diluted_or_millions():
    facts = {"facts": {"us-gaap": {
        "WeightedAverageNumberOfDilutedSharesOutstanding": {"units": {"shares": [
            {"end": "2025-12-31", "val": 9_000_000, "form": "10-K", "filed": "2026-02-01"},
        ]}},
        "CommonStockSharesOutstanding": {"units": {"shares": [
            {"end": "2024-12-31", "val": 400, "form": "10-K", "filed": "2025-02-01"},
            {"end": "2025-12-31", "val": 500, "form": "10-K", "filed": "2026-02-01"},
        ]}},
        "StockholdersEquity": {"units": {"USD": [
            {"end": "2025-12-31", "val": -12, "form": "10-K", "filed": "2026-02-01"},
        ]}},
        "Assets": {"units": {"USD": [
            {"end": "2025-09-30", "val": 90, "form": "10-Q", "filed": "2025-11-01"},
            {"end": "2025-12-31", "val": 80, "form": "10-K", "filed": "2026-02-01"},
        ]}},
    }}}
    snap = snapshot_from_facts(facts)
    assert snap["shares"] == 500
    assert snap["book_equity"] == -12
    assert snap["total_assets"] == 80
    assert snapshot_from_facts(None)["shares"] is None


def test_demo_and_weights_strip_position_dollars_on_the_route():
    raw = _load()

    def claims(_request):
        return {"role": "gp", "demo_mode": True, "email": "demo@dgacapital.com"}

    router = create_router(
        claims,
        positions_fn=lambda _request: raw["positions"],
        fundamentals_fn=lambda _symbols: raw["fundamentals"],
    )
    endpoint = router.routes[0].endpoint
    hidden = endpoint(object(), metric="market_cap", privacy="dollars")
    assert hidden["portfolio"]["total_value"] is None
    assert "$" not in json.dumps(hidden)
    assert _by_id(hidden)["tsla"]["market_cap"] == 100_000_000_000

    def gp(_request):
        return {"role": "gp", "demo_mode": False, "email": "a@dgacapital.com"}

    shown = create_router(
        gp,
        positions_fn=lambda _request: raw["positions"],
        fundamentals_fn=lambda _symbols: raw["fundamentals"],
    ).routes[0].endpoint(object(), metric="position_value", privacy="auto")
    assert shown["portfolio"]["total_value"] == 132_500
    assert shown["metric"] == "position_value"
    assert decide_privacy({"role": "gp", "demo_mode": True}, "dollars") is True
    assert decide_privacy({"role": "lp"}, "dollars") is True
    assert decide_privacy({"role": "gp"}, "weights") is True
    assert decide_privacy({"role": "gp"}, "auto", public_flag="1") is True
    assert decide_privacy({"role": "gp"}, "auto", public_flag="0") is False


def test_city_route_stays_unmounted():
    server = (ROOT / "api" / "server.py").read_text()
    assert "def _mount_portfolio_city" not in server
    assert "from api.domains.portfolio_city import create_router" not in server
    assert server.count("WEB_BUILD_VERSION") >= 1
    assert 'WEB_BUILD_VERSION = "ui730-20261008-lp-roster"' in server
