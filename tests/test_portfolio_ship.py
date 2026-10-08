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
    assert "from api.domains.portfolio_ship import create_router, fetch_market_caps" in server
    assert "caps_fn=fetch_market_caps" in server
    assert "def _mount_portfolio_city" not in server
    assert "from api.domains.portfolio_city import create_router" not in server


def test_market_cap_is_public_and_a_missing_cap_stays_empty():
    from api.domains.portfolio_ship import market_cap_from_nasdaq, parse_market_cap

    assert parse_market_cap("4,946,697,311,000") == 4946697311000
    assert parse_market_cap("$1.2T") == 1.2e12
    assert parse_market_cap("N/A") is None
    assert parse_market_cap(None) is None
    assert market_cap_from_nasdaq(
        {"data": {"summaryData": {"MarketCap": {"value": "1,000"}}}}
    ) == 1000
    payload = build_ship(
        _book([_row("TSLA", 80, "Tesla"), _row("WFC", 20, "Wells")]),
        0,
        privacy=True,
        caps={"TSLA": 800_000_000_000, "WFC": None, "NOPE": 5},
    )
    blob = json.dumps(payload)
    assert "$" not in blob
    by = {row["part"]: row for row in payload["sectors"]}
    caps = {item["symbol"]: item["market_cap"] for item in by["bridge"]["holdings"]}
    caps.update({item["symbol"]: item["market_cap"] for item in by["bow"]["holdings"]})
    assert caps["TSLA"] == 800_000_000_000
    assert caps["WFC"] is None
    assert by["bridge"]["market_value"] is None


def test_caps_hook_is_optional_and_a_failure_keeps_the_book():
    book = _book([_row("TSLA", 80), _row("WFC", 20)])

    def claims(_request):
        return {"role": "gp", "demo_mode": True, "email": "demo@dgacapital.com"}

    def boom(_symbols):
        raise RuntimeError("nasdaq down")

    hidden = create_router(
        claims,
        positions_fn=lambda _request: book,
        spx_fn=lambda: 0,
        caps_fn=boom,
    ).routes[0].endpoint(object(), privacy="auto")
    assert hidden["sectors"]
    assert hidden["sectors"][0]["holdings"][0]["market_cap"] is None
    assert "$" not in json.dumps(hidden)

    def caps(symbols):
        return {sym: 2_000_000_000 if sym == "TSLA" else None for sym in symbols}

    shown = create_router(
        claims,
        positions_fn=lambda _request: book,
        spx_fn=lambda: 1,
        caps_fn=caps,
    ).routes[0].endpoint(object(), privacy="dollars")
    blob = json.dumps(shown)
    assert "$" not in blob
    assert shown["show_dollars"] is False
    tsla = next(item for item in shown["sectors"][0]["holdings"] if item["symbol"] == "TSLA")
    assert tsla["market_cap"] == 2_000_000_000
    assert tsla["market_value"] is None


def test_preferreds_stay_in_financials_and_a_new_name_uses_its_sector():
    assert part_for("NLY") == "bow"
    assert part_for("NLYPF") == "bow"
    assert part_for("NLY-PF") == "bow"
    assert part_for("NLYPRF") == "bow"
    assert part_for("WFC", sector_fn=lambda _sym: "Health Care") == "bow"

    def looked(sym):
        assert sym == "XYZ"
        return "Health Care"

    assert part_for("XYZ", sector_fn=looked) == "hull"
    assert part_for("XYZ") == "deck"

    def refuse(_sym):
        raise AssertionError("a known sleeve must not ask for a sector")

    payload = build_ship(
        _book([
            _row("WFC", 50, "Wells Fargo"),
            _row("C", 40, "Citigroup"),
            _row("NLYPF", 10, "Annaly preferred"),
        ]),
        0,
        privacy=True,
        caps={"WFC": 250_000_000_000, "C": 150_000_000_000, "NLYPF": 800_000_000},
        sector_fn=refuse,
    )
    bow = next(row for row in payload["sectors"] if row["part"] == "bow")
    caps = {item["symbol"]: item["market_cap"] for item in bow["holdings"]}
    assert caps == {
        "WFC": 250_000_000_000,
        "C": 150_000_000_000,
        "NLYPF": 800_000_000,
    }
    assert "$" not in json.dumps(payload)


def test_company_card_uses_the_issuer_and_does_not_invent_numbers():
    from api.domains.portfolio_ship import (
        build_company_card,
        choose_statement_row,
        statement_candidates,
    )

    assert "NLY" in statement_candidates("NLYPRF")
    assert "NLY" in statement_candidates("NLYPF")
    annual = {
        "period_type": "annual",
        "period_end": "2025-12-31",
        "entity_name": "Annaly Capital Management",
        "revenue": 100,
        "operating_income": 20,
        "net_income": 10,
        "operating_cash_flow": 40,
        "capex": -3,
        "free_cash_flow": 37,
        "cash": 5,
        "total_assets": 1000,
        "total_liabilities": 800,
        "stockholders_equity": 200,
        "total_debt": 700,
    }
    thin = {"period_type": "annual", "period_end": "2024-12-31", "revenue": 1}
    assert choose_statement_row([thin, annual])["period_end"] == "2025-12-31"
    assert choose_statement_row([{"period_type": "annual"}]) is None

    def rows(ticker):
        return [annual] if ticker == "NLY" else []

    card = build_company_card("NLYPRF", rows)
    assert card["symbol"] == "NLYPRF"
    assert card["statement_symbol"] == "NLY"
    assert card["balance_sheet"]["equity"] == 200
    assert card["income"]["net_income"] == 10
    assert card["cash_flow"]["free_cash_flow"] == 37
    assert "market_value" not in card
    empty = build_company_card("ZZZZ", lambda _ticker: [])
    assert empty["ok"] is True
    assert empty["statement_symbol"] is None
    assert empty["balance_sheet"] is None
    assert empty["income"] is None
    assert empty["cash_flow"] is None


def test_company_route_is_registered_after_the_book():
    def claims(_request):
        return {"role": "gp"}

    routes = create_router(
        claims,
        positions_fn=lambda _request: _book([]),
        spx_fn=lambda: 0,
        caps_fn=lambda _symbols: {},
    ).routes
    assert routes[0].path == "/api/v2/gp/portfolio-ship"
    assert routes[1].path == "/api/v2/gp/portfolio-ship/company/{symbol}"
