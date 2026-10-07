"""The ship groups the book by story, and the sea follows the S&P in a straight line."""
import json
from pathlib import Path

from api.domains.portfolio_classify import classify
from api.domains.portfolio_ship import (
    build_ship,
    create_router,
    part_for,
    weather_t,
)

ROOT = Path(__file__).resolve().parents[1]


def _book(rows):
    return {"positions": rows, "as_of": "21:00 UTC", "book_as_of": "2026-10-07"}


def _row(symbol, value, name=None):
    return {"symbol": symbol, "name": name or symbol, "market_value": value}


def test_weather_is_a_straight_line_from_worst_to_perfect():
    assert weather_t(2) == 1
    assert weather_t(3) == 1
    assert weather_t(2.01) == 1
    assert weather_t(-3) == 0
    assert weather_t(-5) == 0
    assert weather_t(-3.2) == 0
    assert weather_t(0) == 0.6
    assert abs(weather_t(1) - 0.8) < 1e-9
    assert abs(weather_t(-1) - 0.4) < 1e-9
    assert weather_t(None) == 0.6
    assert weather_t(float("nan")) == 0.6
    # Halfway from −3 to +2 is −0.5, and that sits at t = 0.5.
    assert abs(weather_t(-0.5) - 0.5) < 1e-9


def test_story_groups_do_not_follow_gics_for_the_bridge_or_the_stern():
    assert classify("TSLA")["sector"] == "Consumer Discretionary"
    assert part_for("TSLA") == "bridge"
    assert part_for("META") == "bridge"
    assert part_for("AMZN") == "bridge"
    assert part_for("GOOG") == "mast"
    assert part_for("ZZZZ") == "deck"
    for sym in ("IBRX", "FMCC", "FNMA", "FMCCJ", "FMCCS", "FMCCM", "FMCCN", "FNMAP"):
        assert part_for(sym) == "stern", sym
    assert part_for("C") == "bow"
    assert part_for("WFC") == "bow"
    assert part_for("MOH") == "hull"
    assert part_for("BSX") == "hull"
    assert part_for("SPCX") == "aero"
    assert part_for("UBER") == "cargo"
    assert classify("UBER")["sector"] == "Industrials"
    assert part_for("CEG") == "keel"
    assert part_for("SPAXX") == "anchor"
    assert part_for("FZDXX") == "anchor"
    assert part_for("SPAXX*") == "anchor"
    assert part_for("CASH") == "anchor"
    assert "portfolio_ship" not in (ROOT / "api/domains/portfolio_classify.py").read_text()


def test_zero_weight_parts_are_omitted_and_symbols_stay_separate():
    payload = build_ship(
        _book([
            _row("TSLA", 100, "Tesla"),
            _row("META", 50, "Meta"),
            _row("C", 40, "Citigroup"),
            _row("FMCC", 30, "Freddie Mac"),
            _row("FMCCJ", 10, "Freddie preferred"),
            _row("IBRX", 20, "ImmunityBio"),
            _row("SPAXX", 10, "Fidelity Gov"),
            _row("ZZZZ", 0, "Empty"),
            _row("NOPE", None, "Missing"),
        ]),
        1.0,
        privacy=False,
    )
    parts = {row["part"] for row in payload["sectors"]}
    assert parts == {"bridge", "bow", "stern", "anchor"}
    assert "midship" not in parts
    assert "mast" not in parts
    assert "cargo" not in parts
    stern = next(row for row in payload["sectors"] if row["part"] == "stern")
    assert [item["symbol"] for item in stern["holdings"]] == ["FMCC", "IBRX", "FMCCJ"]
    assert stern["holdings"][0]["market_value"] == 30
    bridge = next(row for row in payload["sectors"] if row["part"] == "bridge")
    assert [item["symbol"] for item in bridge["holdings"]] == ["TSLA", "META"]
    assert bridge["name"] == "Technology (core)"
    assert abs(payload["weather"]["t"] - 0.8) < 1e-9
    assert payload["spx"]["known"] is True
    assert payload["spx"]["change_pct"] == 1
    assert payload["show_dollars"] is True
    assert payload["total_value"] == 260
    weights = sum(row["weight_pct"] for row in payload["sectors"])
    assert abs(weights - 100) < 0.05


def test_a_missing_spx_print_is_the_flat_day_sea_and_marked_unknown():
    payload = build_ship(_book([_row("CEG", 10)]), None, privacy=False)
    assert payload["weather"]["t"] == 0.6
    assert payload["spx"]["known"] is False
    assert payload["spx"]["change_pct"] is None
    assert payload["spx"]["symbol"] == "^GSPC"
    assert payload["sectors"][0]["part"] == "keel"


def test_demo_and_weights_strip_position_dollars():
    book = _book([_row("TSLA", 80, "Tesla"), _row("WFC", 20, "Wells")])

    def claims(_request):
        return {"role": "gp", "demo_mode": True, "email": "demo@dgacapital.com"}

    hidden = create_router(
        claims,
        positions_fn=lambda _request: book,
        spx_fn=lambda: -3,
    ).routes[0].endpoint(object(), privacy="dollars")
    assert hidden["show_dollars"] is False
    assert hidden["total_value"] is None
    assert hidden["weather"]["t"] == 0
    blob = json.dumps(hidden)
    assert "$" not in blob
    for sector in hidden["sectors"]:
        assert sector["market_value"] is None
        for holding in sector["holdings"]:
            assert holding["market_value"] is None
            assert holding["weight_pct"] > 0

    def gp(_request):
        return {"role": "gp", "demo_mode": False, "email": "a@dgacapital.com"}

    shown = create_router(
        gp,
        positions_fn=lambda _request: book,
        spx_fn=lambda: 2,
    ).routes[0].endpoint(object(), privacy="auto")
    assert shown["show_dollars"] is True
    assert shown["total_value"] == 100
    assert shown["weather"]["t"] == 1
    assert shown["sectors"][0]["market_value"] == 80


def test_industrials_aerospace_and_the_misfiled_names():
    assert classify("MSFT")["sector"] == "Information Technology"
    assert classify("NKE")["sector"] == "Consumer Discretionary"
    assert classify("HHH")["sector"] == "Real Estate"
    assert part_for("MSFT") == "bridge"
    assert part_for("NVDA") == "bridge"
    assert part_for("NKE") == "staples"
    assert part_for("HHH") == "cabins"
    assert part_for("DLR") == "cabins"
    assert part_for("EQIX") == "cabins"
    assert part_for("IRM") == "cabins"
    assert part_for("SPG") == "cabins"
    assert part_for("CAT") == "deck"
    assert part_for("DE") == "deck"
    assert part_for("VRT") == "deck"
    assert part_for("J") == "deck"
    assert part_for("36966TKX9") == "aero"
    assert part_for("NFLX") == "mast"
    assert part_for("CMCSA") == "mast"
    assert part_for("FMCKP") == "stern"
    assert classify("FMCKP")["sector"] == "Financials"
    assert part_for("FNMAS") == "stern"
    assert part_for("FREGP") == "stern"
    assert part_for("OKLO") == "keel"
    assert part_for("SMR") == "keel"
    assert part_for("NEE") == "keel"
    assert part_for("MLM") == "midship"
    assert part_for("VMC") == "midship"
    assert part_for("PYPL") == "bow"
    assert part_for("BRKB") == "bow"
    assert part_for("NLYPRF") == "bow"
    assert part_for("SPY") == "market"
    assert part_for("IWM") == "market"
    assert part_for("QQQM") == "market"
    payload = build_ship(
        _book([
            _row("CAT", 10),
            _row("SPCX", 8),
            _row("UBER", 6),
            _row("NKE", 5),
            _row("MSFT", 20),
            _row("FMCC", 4),
            _row("FMCKP", 3),
        ]),
        0,
        privacy=True,
    )
    by = {row["part"]: row for row in payload["sectors"]}
    assert by["deck"]["name"] == "Industrials"
    assert by["aero"]["name"] == "Aerospace"
    assert [item["symbol"] for item in by["aero"]["holdings"]] == ["SPCX"]
    assert by["cargo"]["name"] == "Consumer Discretionary"
    assert by["staples"]["name"] == "Consumer Staples"
    assert by["bridge"]["name"] == "Technology (core)"
    assert [item["symbol"] for item in by["stern"]["holdings"]] == ["FMCC", "FMCKP"]
    assert "$" not in json.dumps(payload)


def test_ship_route_is_mounted_and_the_city_route_stays_off():
    server = (ROOT / "api" / "server.py").read_text()
    assert "def _mount_portfolio_ship" in server
    assert "from api.domains.portfolio_ship import create_router" in server
    assert "def _mount_portfolio_city" not in server
    assert "from api.domains.portfolio_city import create_router" not in server
