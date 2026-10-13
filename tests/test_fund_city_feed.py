"""Fund City polls the Ship book. Dollars follow the same privacy rule."""
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.domains.fund_city_feed import (
    FEED_PATH,
    FEED_TOKEN_ENV,
    INDEX_FUNDS,
    build_fund_city,
    create_router,
    feed_token_ok,
    is_feed_path,
    privacy_decision,
)
from api.domains.portfolio_city import PRIVACY_VALUES, decide_privacy
from api.domains.portfolio_classify import DISTRICTS, classify
from api.domains.portfolio_ship import DRAW_ORDER, _ETF

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "fund_city"
TOKEN = "synthetic-feed-token-not-a-secret-32"


@pytest.fixture(autouse=True)
def _clear_feed_env(monkeypatch):
    monkeypatch.delenv(FEED_TOKEN_ENV, raising=False)
    monkeypatch.delenv("PORTFOLIO_CITY_PUBLIC", raising=False)


def _load():
    return json.loads((FIX / "book.json").read_text())


def _feed(**kwargs):
    raw = _load()
    privacy = kwargs.pop("privacy", False)
    book = kwargs.pop("book", raw["positions"])
    caps = kwargs.pop("caps", raw["caps"])
    return build_fund_city(
        book,
        privacy=privacy,
        caps=caps,
        generated_at="2026-10-13T16:00:00Z",
        **kwargs,
    )


def _by_ticker(payload):
    return {row["ticker"]: row for row in payload["holdings"]}


def _req(headers=None, query=None):
    return SimpleNamespace(
        headers=headers or {},
        query_params=query or {},
        state=SimpleNamespace(),
    )


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
        py = {
            "object": dict,
            "array": list,
            "string": str,
            "number": (int, float),
            "integer": int,
            "boolean": bool,
        }
        if isinstance(node, bool) and ("number" in types or "integer" in types):
            raise AssertionError(node)
        assert any(isinstance(node, py[kind]) for kind in types if kind != "null"), (node, types)
    if "const" in schema:
        assert node == schema["const"]
    if "enum" in schema:
        assert node in schema["enum"], node
    if isinstance(node, (int, float)) and not isinstance(node, bool):
        if "minimum" in schema:
            assert node >= schema["minimum"]
        if "maximum" in schema:
            assert node <= schema["maximum"]
    if isinstance(node, str):
        if "pattern" in schema:
            assert re.match(schema["pattern"], node), node
        if "minLength" in schema:
            assert len(node) >= schema["minLength"]
    if isinstance(node, dict):
        props = schema.get("properties") or {}
        if schema.get("additionalProperties") is False:
            extra = set(node) - set(props)
            assert not extra, extra
        for key in schema.get("required") or []:
            assert key in node, key
        for key, value in node.items():
            if key in props:
                _check(value, props[key], root)
    if isinstance(node, list) and "items" in schema:
        for item in node:
            _check(item, schema["items"], root)


def _schema():
    return json.loads((FIX / "fund-city.schema.json").read_text())


def test_schema_matches_ship_parts_and_gics_sectors():
    schema = _schema()
    holding = schema["$defs"]["holding"]["properties"]
    assert set(holding["story_part"]["enum"]) == set(DRAW_ORDER)
    assert set(holding["sector"]["enum"]) == set(DISTRICTS)
    assert INDEX_FUNDS == _ETF


def test_fixture_is_synthetic_and_small():
    raw = _load()
    assert raw["synthetic"] is True
    assert "not the live" in raw["note"].lower() or "Not a real" in raw["note"]
    total = sum(row["market_value"] or 0 for row in raw["positions"]["positions"])
    assert total == 7472
    assert total < 20_000


def test_book_rolls_up_one_row_per_symbol_and_keeps_ship_groups():
    payload = _feed()
    _check(payload, _schema(), _schema())
    rows = _by_ticker(payload)
    assert payload["fund"]["nav"] == 7472
    assert payload["fund"]["cash"] == 500
    assert payload["fund"]["currency"] == "USD"
    assert payload["fund"]["as_of"] == "21:00 UTC"
    assert payload["fund"]["book_as_of"] == "2026-10-07"
    assert payload["fund"]["holdings_count"] == len(payload["holdings"]) == 10
    assert abs(sum(row["weight"] for row in payload["holdings"]) - 1) < 1e-9
    assert abs(sum(row["market_value"] for row in payload["holdings"]) - 7472) < 0.001
    assert "ZZZZ" not in rows and "NOPE" not in rows
    tsla = rows["TSLA"]
    assert tsla["name"] == "Tesla Inc"
    assert tsla["market_value"] == 5359
    assert tsla["shares"] == 15.75
    assert tsla["sector"] == "Consumer Discretionary"
    assert classify("TSLA")["sector"] == "Consumer Discretionary"
    assert tsla["story_part"] == "bridge"
    assert tsla["story_name"] == "Technology (core)"
    assert tsla["market_cap"] == 88000000013
    assert tsla["flags"]["non_equity"] is False
    assert payload["holdings"][0]["ticker"] == "TSLA"
    cash = rows["SPAXX"]
    assert cash["name"] == "Sample Gov MM"
    assert cash["sector"] == "Cash"
    assert cash["story_part"] == "anchor"
    assert cash["flags"]["cash"] is True
    assert cash["flags"]["non_equity"] is True
    assert cash["market_cap"] is None
    assert abs(payload["fund"]["cash_weight"] - cash["weight"]) < 1e-9
    spy = rows["SPY"]
    assert spy["flags"]["index_fund"] is True
    assert spy["story_part"] == "market"
    assert spy["sector"] == classify("SPY")["sector"] == "Industrials"
    assert spy["flags"]["non_equity"] is False
    assert spy["market_cap"] == 512000000003
    qqq = rows["QQQ"]
    assert qqq["flags"]["index_fund"] is True
    assert qqq["story_part"] == "deck"
    fmcc = rows["FMCC"]
    assert fmcc["flags"]["gse_common"] is True
    assert fmcc["flags"]["gse_preferred"] is False
    assert fmcc["flags"]["preferred"] is False
    assert fmcc["flags"]["non_equity"] is False
    assert fmcc["sector"] == "Financials"
    assert fmcc["story_part"] == "stern"
    pref = rows["FMCCJ"]
    assert pref["flags"]["gse_preferred"] is True
    assert pref["flags"]["preferred"] is True
    assert pref["flags"]["gse_common"] is False
    assert pref["flags"]["non_equity"] is True
    assert pref["sector"] == "Financials"
    other = rows["NLYPRF"]
    assert other["flags"]["preferred"] is True
    assert other["flags"]["gse_preferred"] is False
    assert other["flags"]["non_equity"] is True
    assert other["story_part"] == "bow"
    assert other["sector"] == "Financials"
    bond = rows["36966TKX9"]
    assert bond["flags"]["bond_cusip"] is True
    assert bond["flags"]["non_equity"] is True
    assert bond["story_part"] == "aero"
    assert bond["market_cap"] is None
    fake = rows["00000TEST9"]
    assert fake["name"] == "Synthetic bond"
    assert fake["flags"]["bond_cusip"] is True
    assert fake["story_part"] == "deck"
    assert fake["market_cap"] is None
    blob = json.dumps(payload)
    assert "Sample Managed" not in blob
    assert "sample-fund" not in blob
    assert "99999" not in blob
    assert payload["provenance"]["show_dollars"] is True
    assert payload["provenance"]["privacy"] == "dollars"
    assert payload["provenance"]["is_live"] is True
    assert payload["provenance"]["is_demo"] is False
    assert payload["provenance"]["book_status"] == "ok"
    assert payload["provenance"]["withheld_reason"] is None


def test_weights_mode_nulls_position_dollars_and_shares_and_keeps_public_caps():
    hidden = _feed(privacy=True, withheld_reason="privacy=weights", is_demo=False)
    _check(hidden, _schema(), _schema())
    assert hidden["fund"]["nav"] is None
    assert hidden["fund"]["cash"] is None
    assert hidden["fund"]["cash_weight"] > 0
    assert hidden["provenance"]["privacy"] == "weights"
    assert hidden["provenance"]["show_dollars"] is False
    blob = json.dumps(hidden)
    assert "$" not in blob
    for sentinel in ("4242", "1117", "15.75", "12.5", "99999"):
        assert sentinel not in blob
    tsla = _by_ticker(hidden)["TSLA"]
    assert tsla["market_value"] is None
    assert tsla["shares"] is None
    assert tsla["weight"] > 0
    assert tsla["market_cap"] == 88000000013
    assert abs(sum(row["weight"] for row in hidden["holdings"]) - 1) < 1e-9


def test_a_missing_share_count_stays_null_and_an_outage_is_not_an_empty_fund():
    book = {
        "as_of": "21:00 UTC",
        "book_as_of": "2026-10-07",
        "positions": [{"symbol": "C", "name": "Citigroup", "market_value": 10}],
    }
    payload = build_fund_city(book, privacy=False, generated_at="2026-10-13T16:00:00Z")
    assert payload["holdings"][0]["shares"] is None
    assert payload["holdings"][0]["market_value"] == 10
    assert payload["fund"]["nav"] == 10

    down = build_fund_city(
        {"error": "relation tax_lots does not exist", "positions": [
            {"symbol": "TSLA", "market_value": 4242, "total_qty": 12.5},
        ]},
        privacy=False,
        book_ok=False,
        generated_at="2026-10-13T16:00:00Z",
    )
    assert down["provenance"]["book_status"] == "unavailable"
    assert down["provenance"]["is_live"] is False
    assert down["provenance"]["privacy"] == "dollars"
    assert down["provenance"]["show_dollars"] is False
    assert down["fund"]["nav"] is None
    assert down["holdings"] == []
    assert "tax_lots" not in json.dumps(down)

    empty = build_fund_city(
        {"as_of": "21:00 UTC", "book_as_of": "2026-10-07", "positions": []},
        privacy=False,
        generated_at="2026-10-13T16:00:00Z",
    )
    assert empty["provenance"]["book_status"] == "empty"
    assert empty["provenance"]["is_live"] is True
    assert empty["fund"]["nav"] == 0
    assert empty["fund"]["cash"] == 0


def test_unmapped_story_part_can_follow_a_sector_lookup_and_gics_does_not():
    seen = []

    def sector_fn(symbol):
        seen.append(symbol)
        if symbol == "QQQ":
            return "Health Care"
        return None

    payload = _feed(sector_fn=sector_fn)
    rows = _by_ticker(payload)
    assert "TSLA" not in seen
    assert "SPY" not in seen
    assert rows["QQQ"]["story_part"] == "hull"
    assert rows["QQQ"]["sector"] == "Industrials"
    assert rows["TSLA"]["story_part"] == "bridge"


def test_privacy_decision_matches_ship_and_city():
    matrix = [
        ({"role": "gp", "demo_mode": False}, "auto"),
        ({"role": "gp", "demo_mode": False}, "dollars"),
        ({"role": "gp", "demo_mode": False}, "weights"),
        ({"role": "gp", "demo_mode": True}, "dollars"),
        ({"role": "lp", "demo_mode": False}, "auto"),
        ({"role": "admin"}, "auto"),
    ]
    for claims, mode in matrix:
        hide, reason = privacy_decision(claims, mode)
        assert hide is decide_privacy(claims, mode)
        if not hide:
            assert reason is None
        elif mode == "weights":
            assert reason == "privacy=weights"
        elif claims.get("demo_mode"):
            assert reason == "demo_mode"
        else:
            assert reason == "role"
    assert privacy_decision({"role": "gp"}, "auto", )[0] is False


def test_public_flag_hides_dollars_for_a_gp(monkeypatch):
    monkeypatch.setenv("PORTFOLIO_CITY_PUBLIC", "1")
    hide, reason = privacy_decision({"role": "gp", "demo_mode": False}, "dollars")
    assert hide is True
    assert reason == "PORTFOLIO_CITY_PUBLIC"
    assert hide is decide_privacy({"role": "gp"}, "dollars")


def test_machine_token_sees_dollars_and_a_demo_gp_does_not(monkeypatch):
    monkeypatch.setenv(FEED_TOKEN_ENV, TOKEN)
    raw = _load()
    seen = []

    def positions(request):
        seen.append(dict(request.state.auth_claims))
        return raw["positions"]

    def refuse(_request):
        raise HTTPException(401, "Authentication required")

    shown = create_router(
        refuse,
        positions_fn=positions,
        caps_fn=lambda symbols: raw["caps"],
    ).routes[0].endpoint(_req({"Authorization": f"Bearer {TOKEN}"}), privacy="auto")
    assert shown["fund"]["nav"] == 7472
    assert shown["provenance"]["is_live"] is True
    assert shown["provenance"]["is_demo"] is False
    assert shown["provenance"]["show_dollars"] is True
    assert seen[0]["role"] == "gp"
    assert seen[0]["demo_mode"] is False
    assert seen[0]["service"] == "fund_city_feed"
    _check(shown, _schema(), _schema())

    def demo(_request):
        return {"role": "gp", "demo_mode": True, "email": "demo@dgacapital.com"}

    hidden = create_router(
        demo,
        positions_fn=lambda _request: raw["positions"],
        caps_fn=lambda _symbols: raw["caps"],
    ).routes[0].endpoint(_req(), privacy="dollars")
    assert hidden["fund"]["nav"] is None
    assert hidden["provenance"]["is_demo"] is True
    assert hidden["provenance"]["is_live"] is False
    assert hidden["provenance"]["privacy"] == "weights"
    assert hidden["provenance"]["withheld_reason"] == "demo_mode"
    assert "4242" not in json.dumps(hidden)


def test_feed_token_headers_and_the_paths_that_must_not_count(monkeypatch):
    monkeypatch.setenv(FEED_TOKEN_ENV, TOKEN)
    assert feed_token_ok(_req({"authorization": f"bearer {TOKEN}"})) is True
    assert feed_token_ok(_req({"x-fund-city-token": TOKEN})) is True
    assert feed_token_ok(_req(query={"token": TOKEN})) is False
    assert feed_token_ok(_req({"authorization": "Bearer wrong-token-but-long-enough-no"})) is False
    monkeypatch.setenv(FEED_TOKEN_ENV, "short-token")
    assert feed_token_ok(_req({"authorization": "Bearer short-token"})) is False
    monkeypatch.setenv(FEED_TOKEN_ENV, "replace-with-a-random-token")
    assert feed_token_ok(_req({"authorization": "Bearer replace-with-a-random-token"})) is False
    assert is_feed_path("/api/v2/gp/fund-city") is True
    assert is_feed_path("/api/v2/gp/fund-city/") is True
    assert is_feed_path("/api/v2/gp/fund-city-evil") is False
    assert is_feed_path("/api/v2/gp/portfolio-ship") is False
    assert FEED_PATH == "/api/v2/gp/fund-city"


def test_lp_and_missing_auth_do_not_load_the_book():
    calls = []

    def positions(_request):
        calls.append("book")
        return {"positions": []}

    def lp(_request):
        return {"role": "lp", "demo_mode": False}

    router = create_router(lp, positions_fn=positions)
    with pytest.raises(HTTPException) as denied:
        router.routes[0].endpoint(_req(), privacy="auto")
    assert denied.value.status_code == 403
    assert calls == []

    def missing(_request):
        raise HTTPException(401, "Authentication required")

    with pytest.raises(HTTPException) as unauth:
        create_router(missing, positions_fn=positions).routes[0].endpoint(_req(), privacy="weights")
    assert unauth.value.status_code == 401
    assert calls == []

    def gp(_request):
        calls.append("claims")
        return {"role": "gp"}

    with pytest.raises(HTTPException) as bad:
        create_router(gp, positions_fn=positions).routes[0].endpoint(_req(), privacy="nope")
    assert bad.value.status_code == 400
    assert calls == []


def test_weights_query_and_a_caps_failure_keep_the_book(monkeypatch):
    monkeypatch.setenv(FEED_TOKEN_ENV, TOKEN)
    raw = _load()

    hidden = create_router(
        lambda _request: {"role": "gp"},
        positions_fn=lambda _request: raw["positions"],
        caps_fn=lambda _symbols: raw["caps"],
    ).routes[0].endpoint(
        _req({"x-fund-city-token": TOKEN}),
        privacy="weights",
    )
    assert hidden["provenance"]["withheld_reason"] == "privacy=weights"
    assert hidden["fund"]["nav"] is None
    assert _by_ticker(hidden)["C"]["market_cap"] == 150000000017
    assert _by_ticker(hidden)["C"]["shares"] is None

    def boom(_symbols):
        raise RuntimeError("nasdaq down")

    shown = create_router(
        lambda _request: {"role": "gp", "demo_mode": False},
        positions_fn=lambda _request: raw["positions"],
        caps_fn=boom,
    ).routes[0].endpoint(_req({"authorization": f"Bearer {TOKEN}"}), privacy="dollars")
    assert shown["fund"]["nav"] == 7472
    assert shown["holdings"][0]["market_cap"] is None

    def caps_should_not_run(_symbols):
        raise AssertionError("no quotes on an outage")

    down = create_router(
        lambda _request: {"role": "gp"},
        positions_fn=lambda _request: {"positions": [], "error": "db down"},
        caps_fn=caps_should_not_run,
    ).routes[0].endpoint(_req({"authorization": f"Bearer {TOKEN}"}), privacy="auto")
    assert down["provenance"]["book_status"] == "unavailable"
    assert down["provenance"]["privacy"] == "dollars"
    assert down["fund"]["nav"] is None
    assert "db down" not in json.dumps(down)


def test_route_is_mounted_and_the_city_scene_stays_off():
    server = (ROOT / "api" / "server.py").read_text()
    assert "def _mount_fund_city_feed" in server
    assert "from api.domains.fund_city_feed import create_router" in server
    assert "caps_fn=fetch_market_caps" in server
    assert "sector_fn=_yahoo_sector" in server
    assert 'path.rstrip("/") == "/api/v2/gp/fund-city"' in server
    assert "from api.domains.fund_city_feed import attach_service_claims" in server
    assert "def _mount_portfolio_ship" in server
    assert "def _mount_portfolio_city" not in server
    assert "from api.domains.portfolio_city import create_router" not in server
    routes = create_router(lambda _request: {"role": "gp"}).routes
    assert [route.path for route in routes] == [FEED_PATH]
    assert set(PRIVACY_VALUES) == {"auto", "weights", "dollars"}
