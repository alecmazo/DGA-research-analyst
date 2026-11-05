"""Ideas scanners, scores, and the morning plan. No network and no database."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from ideas_cards.catalog import DEFAULT_SETTINGS, DEFAULT_WEIGHTS
from ideas_cards.compose import attach_watch_alerts
from ideas_cards.edgar import edgar_search_link, hit_count, parse_13f_infotable, parse_form4_xml
from ideas_cards.live import (
    constituent_metrics,
    grok_call_cost,
    matching_etfs,
    parse_stooq_csv,
    tickers_from_holdings,
    weekly_universe,
)
from ideas_cards.pipeline import cards_for_bundle, polish_cards, thirteen_f_changes
from ideas_cards.research import write_report
from ideas_cards.schedule import LA, capped_sleep, plan_tick, stage_open
from ideas_cards.scanners import (
    classify_drop,
    overreaction_score,
    scan_13f_changes,
    scan_insider_buys,
    scan_trends,
)
from ideas_cards.scoring import tune_weights
from ideas_cards.service import list_view, pass_card, run_stages, watch_card
from ideas_cards.store import MemoryStore, clean_settings, merge_card


def _bars(prices, start=date(2025, 1, 2)):
    rows = []
    day = start
    for price in prices:
        rows.append({"date": day.isoformat(), "close": float(price)})
        day += timedelta(days=1)
    return rows


def _xlk(i):
    if i < 30:
        return 100 + i * 3
    return 187 - (187 - 120) * ((i - 30) / (139 - 30))


def _book():
    spy = _bars(100 + i * 0.2 for i in range(140))
    xlk = _bars(_xlk(i) for i in range(140))
    xlf = _bars(100 + i * 0.5 for i in range(140))
    mild = _bars(100 if i < 100 else 96 for i in range(140))
    return {"SPY": spy, "XLK": xlk, "XLF": xlf, "XLV": mild}


def test_sector_needs_drawdown_and_both_horizons():
    names = [
        {"ticker": "AAA", "debt_to_equity": 0.2, "current_ratio": 2, "pe": 10, "pe_5y": 20},
        {"ticker": "BBB", "debt_to_equity": 0.4, "pe": 12, "pe_5y": 20},
        {"ticker": "CCC", "debt_to_equity": 1.8, "pe": 14, "pe_5y": 20},
    ]
    cards = cards_for_bundle(
        "sector",
        {"prices": _book(), "constituents": {"XLK": names}},
        DEFAULT_SETTINGS,
        date(2026, 10, 30),
    )
    symbols = [card["ticker"] for card in cards]
    assert "XLK" in symbols
    assert "XLF" not in symbols
    assert "XLV" not in symbols
    card = next(row for row in cards if row["ticker"] == "XLK")
    assert "cyclical or structural" in card["thesis"].lower()
    assert card["names"][0]["ticker"] == "AAA"
    assert any(row["label"].startswith("Valuation") and row["value"] != "n/a" for row in card["key_numbers"])
    assert card["sources"][0]["url"].startswith("https://finance.yahoo.com/quote/")
    assert card["id"] == "sector:XLK"
    assert 0 <= card["score"] <= 100


def test_sector_without_five_year_pe_says_na():
    cards = cards_for_bundle("sector", {"prices": _book(), "constituents": {}}, DEFAULT_SETTINGS, date(2026, 10, 30))
    card = next(row for row in cards if row["ticker"] == "XLK")
    valuation = next(row for row in card["key_numbers"] if row["label"].startswith("Valuation"))
    assert valuation["value"] == "n/a"


def test_weekly_cause_cap_and_overreaction():
    day = date(2026, 10, 20)
    down = _bars([100, 100, 100, 100, 100, 80], start=day)
    small = _bars([100, 100, 100, 100, 100, 70], start=day)
    names = [
        {
            "ticker": "DROP",
            "bars": down,
            "market_cap": 2_000_000_000,
            "headlines": ["Company earnings miss and a guidance cut"],
            "headline_urls": ["https://news.example/drop"],
            "sector_move": -0.01,
            "estimate_revision": -0.02,
            "eps": 4,
        },
        {"ticker": "TINY", "bars": small, "market_cap": 500_000_000, "headlines": ["earnings miss"]},
        {
            "ticker": "TAPE",
            "bars": down,
            "market_cap": 3_000_000_000,
            "headlines": [],
            "sector_move": -0.10,
        },
    ]
    cards = cards_for_bundle("weekly", {"names": names}, DEFAULT_SETTINGS, date(2026, 10, 30))
    by = {card["ticker"]: card for card in cards}
    assert "TINY" not in by
    assert by["DROP"]["id"] == "weekly:DROP"
    assert by["DROP"]["subtype"] == "guidance cut"
    assert by["TAPE"]["subtype"] == "market-wide"
    assert by["DROP"]["signals"]["overreaction"] > 50
    assert any(row["url"] == "https://news.example/drop" for row in by["DROP"]["sources"])
    assert classify_drop(["profit warning", "downgrade"], -0.2, -0.01) == "earnings miss"
    assert overreaction_score(-0.20, 0, 0) == 80


def test_insider_cluster_and_ceo_floor():
    as_of = date(2026, 10, 30)
    trades = [
        {"ticker": "AAA", "insider": "Ann", "role": "Director", "code": "P", "date": "2026-10-20", "value": 100_000},
        {"ticker": "AAA", "insider": "Ben", "role": "Director", "code": "P", "date": "2026-10-21", "value": 80_000},
        {"ticker": "BBB", "insider": "Cara", "role": "Director", "code": "P", "date": "2026-10-22", "value": 100_000},
        {"ticker": "CCC", "insider": "Dan", "role": "Chief Executive Officer", "code": "P", "date": "2026-10-18", "value": 250_000},
        {"ticker": "DDD", "insider": "Eve", "role": "CFO", "code": "P", "date": "2026-09-01", "value": 900_000},
    ]
    hits = scan_insider_buys(trades, as_of=as_of)
    tickers = {row["ticker"] for row in hits}
    assert tickers == {"AAA", "CCC"}
    cards = cards_for_bundle(
        "insider",
        {"trades": trades, "filings_current": [], "filings_prior": []},
        DEFAULT_SETTINGS,
        as_of,
    )
    assert {card["ticker"] for card in cards} == {"AAA", "CCC"}


def test_13f_new_and_large_add_only():
    funds = [{"name": "Berkshire Hathaway", "cik": "0001067983"}]
    prior = [{"fund": "Berkshire Hathaway", "cik": "0001067983", "cusip": "AAA", "issuer": "Acme", "shares": 100, "value": 1}]
    current = [
        {"fund": "Berkshire Hathaway", "cik": "0001067983", "cusip": "AAA", "issuer": "Acme", "shares": 160, "value": 2, "ticker": "ACME"},
        {"fund": "Berkshire Hathaway", "cik": "0001067983", "cusip": "BBB", "issuer": "Bravo", "shares": 10, "value": 5, "ticker": "BRAV"},
        {"fund": "Berkshire Hathaway", "cik": "0001067983", "cusip": "CCC", "issuer": "Calm", "shares": 130, "value": 3, "ticker": "CALM"},
        {"fund": "Other", "cik": "0000000001", "cusip": "ZZZ", "issuer": "Nope", "shares": 10, "value": 9, "ticker": "NOPE"},
    ]
    # Calm is only a 30% add over a missing prior row — give it a prior.
    prior.append({"fund": "Berkshire Hathaway", "cik": "0001067983", "cusip": "CCC", "issuer": "Calm", "shares": 100, "value": 1})
    hits = scan_13f_changes(current, prior, funds, add_pct=0.50)
    changes = {row["ticker"]: row["change"] for row in hits}
    assert changes == {"ACME": "add", "BRAV": "new"}
    store = MemoryStore()
    assert thirteen_f_changes(store, current, funds, 0.50) == []
    assert store.get_blob("13f_has_baseline") is True
    again = thirteen_f_changes(store, current + [{
        "fund": "Berkshire Hathaway", "cik": "0001067983", "cusip": "NEW",
        "issuer": "Newco", "shares": 40, "value": 8, "ticker": "NEW",
    }], funds, 0.50)
    assert any(row["ticker"] == "NEW" and row["change"] == "new" for row in again)


def test_trend_needs_a_positive_signal():
    as_of = date(2026, 10, 30)
    hits = scan_trends(
        ["nuclear", "quiet"],
        mentions={"nuclear": [{"quarter": "prior", "count": 10}, {"quarter": "latest", "count": 16}],
                  "quiet": [{"quarter": "prior", "count": 10}, {"quarter": "latest", "count": 10}]},
        patents={},
        fda=[],
        search={"quiet": 10},
        exposed=[{"theme": "nuclear", "ticker": "URA", "revenue_pct": 40}],
        as_of=as_of,
    )
    assert [row["theme"] for row in hits] == ["nuclear"]
    cards = cards_for_bundle(
        "trend",
        {"mentions": {"nuclear": [{"quarter": "prior", "count": 10}, {"quarter": "latest", "count": 16}]},
         "exposed": [{"theme": "nuclear", "ticker": "URA", "revenue_pct": 40}]},
        DEFAULT_SETTINGS,
        as_of,
    )
    assert cards[0]["sources"][0]["url"].startswith("https://efts.sec.gov/")
    assert "URA" in cards[0]["thesis"]


def test_pass_weights_stay_bounded():
    weights = dict(DEFAULT_WEIGHTS["sector"])
    for _ in range(20):
        weights = tune_weights(weights, "sector", "pass", "structural")
    assert all(5 <= value <= 60 for value in weights.values())
    assert 99 <= sum(weights.values()) <= 101
    assert any(abs(weights[key] - DEFAULT_WEIGHTS["sector"][key]) >= 0.5 for key in weights)
    reinforced = tune_weights(DEFAULT_WEIGHTS["weekly"], "weekly", "dig")
    assert reinforced["overreaction"] > DEFAULT_WEIGHTS["weekly"]["overreaction"]
    same = tune_weights(DEFAULT_WEIGHTS["trend"], "trend", "pass", "not my universe")
    assert 99 <= sum(same.values()) <= 101


def test_plan_tick_week_and_manual():
    friday_early = datetime(2026, 10, 30, 5, 0, tzinfo=LA)
    friday = datetime(2026, 10, 30, 6, 5, tzinfo=LA)
    assert plan_tick(friday_early)["reason"] == "before_start"
    assert plan_tick(friday)["stage"] == "sector"
    assert plan_tick(friday, {"sector": {"status": "succeeded"}})["stage"] == "weekly"
    done = {"sector": {"status": "succeeded"}, "weekly": {"status": "succeeded"}, "insider": {"status": "succeeded"}}
    assert plan_tick(friday, done)["reason"] == "done"
    assert plan_tick(datetime(2026, 10, 31, 10, 0, tzinfo=LA))["reason"] == "weekend"
    sunday = datetime(2026, 11, 1, 6, 5, tzinfo=LA)
    assert plan_tick(sunday)["stage"] == "trend"
    after = plan_tick(sunday, {"trend": {"status": "succeeded"}})
    assert after["reason"] == "done"
    assert 23 * 3600 < after["sleep_sec"] < 24 * 3600
    assert plan_tick(friday, auto=False)["reason"] == "manual"
    assert plan_tick(friday, {"sector": {"attempts": 3, "status": "failed"}})["stage"] == "weekly"
    assert stage_open({"sector": {"status": "succeeded"}}, "sector") is False
    assert capped_sleep(5000) == 900


def test_dated_copies_collapse_to_one_card():
    store = MemoryStore()
    store._cards["sector:URA:2026-10-30"] = {
        "id": "sector:URA:2026-10-30",
        "type": "sector",
        "as_of": "2026-10-30",
        "title": "Uranium old",
        "score": 80,
        "status": "watching",
        "ticker": "URA",
        "watch": {"price": 20},
        "report": "",
        "signals": {},
    }
    store._cards["sector:URA:2026-11-03"] = {
        "id": "sector:URA:2026-11-03",
        "type": "sector",
        "as_of": "2026-11-03",
        "title": "Uranium new",
        "score": 82,
        "status": "new",
        "ticker": "URA",
        "signals": {},
    }
    store._cards["weekly:FICO:2026-10-30"] = {
        "id": "weekly:FICO:2026-10-30",
        "type": "weekly",
        "as_of": "2026-10-30",
        "title": "FICO old",
        "score": 50,
        "status": "dug_in",
        "ticker": "FICO",
        "report": "The note",
        "signals": {},
    }
    store._cards["weekly:FICO:2026-11-03"] = {
        "id": "weekly:FICO:2026-11-03",
        "type": "weekly",
        "as_of": "2026-11-03",
        "title": "FICO new",
        "score": 60,
        "status": "new",
        "ticker": "FICO",
        "signals": {},
    }
    rows = list_view(store)
    by = {row["ticker"]: row for row in rows}
    assert set(by) == {"URA", "FICO"}
    assert by["URA"]["id"] == "sector:URA"
    assert by["URA"]["status"] == "watching"
    assert by["URA"]["title"] == "Uranium new"
    assert by["URA"]["watch"]["price"] == 20
    assert by["FICO"]["id"] == "weekly:FICO"
    assert by["FICO"]["status"] == "dug_in"
    assert by["FICO"]["report"] == "The note"
    assert by["FICO"]["title"] == "FICO new"
    assert set(store._cards) == {"sector:URA", "weekly:FICO"}
    assert list_view(store) and store.collapse_duplicates() == 0


def test_a_later_morning_refreshes_the_same_card():
    store = MemoryStore()
    bundle = {"prices": _book(), "constituents": {}}

    def loader(stage, settings, day, _store):
        if stage != "sector":
            return []
        return cards_for_bundle("sector", bundle, settings, day)

    run_stages(store, ["sector"], date(2026, 10, 30), loader)
    card_id = next(card["id"] for card in store.list_cards() if card.get("ticker") == "XLK")
    assert card_id == "sector:XLK"
    pass_card(store, card_id, "structural", "already looked")
    run_stages(store, ["sector"], date(2026, 11, 3), loader)
    rows = [card for card in store.list_cards() if card.get("ticker") == "XLK"]
    assert len(rows) == 1
    assert rows[0]["id"] == "sector:XLK"
    assert rows[0]["status"] == "passed"
    assert rows[0]["as_of"] == "2026-11-03"
    assert rows[0]["pass_reason"] == "structural"


def test_upsert_preserves_a_pass_and_does_not_duplicate():
    store = MemoryStore()
    as_of = date(2026, 10, 30)
    bundle = {"prices": _book(), "constituents": {}}

    def loader(stage, settings, day, _store):
        if stage != "sector":
            return []
        return cards_for_bundle("sector", bundle, settings, day)

    first = run_stages(store, ["sector"], as_of, loader)
    assert first[0]["cards"] >= 1
    card_id = store.list_cards()[0]["id"]
    pass_card(store, card_id, "structural", "already looked")
    second = run_stages(store, ["sector"], as_of, loader)
    assert second[0]["skipped"] is True
    assert len(store.list_cards()) == first[0]["cards"]
    forced = run_stages(store, ["sector"], as_of, loader, force=True)
    assert forced[0]["skipped"] is False
    assert store.get_card(card_id)["status"] == "passed"
    assert store.get_card(card_id)["pass_reason"] == "structural"
    assert len(store.list_cards()) == first[0]["cards"]
    assert store.get_settings()["weights"]["sector"]["drawdown"] != DEFAULT_WEIGHTS["sector"]["drawdown"]


def test_three_failures_stop_the_stage():
    store = MemoryStore()

    def loader(*_args):
        raise RuntimeError("feed down")

    day = date(2026, 10, 30)
    for _ in range(3):
        run_stages(store, ["sector"], day, loader)
    assert store.runs_on(day)["sector"]["attempts"] == 3
    now = datetime(2026, 10, 30, 6, 5, tzinfo=LA)
    assert plan_tick(now, store.runs_on(day))["stage"] == "weekly"


def test_watch_alert_and_report():
    store = MemoryStore()
    as_of = date(2026, 10, 30)
    cards = cards_for_bundle("weekly", {"names": [{
        "ticker": "DROP",
        "bars": _bars([100, 100, 100, 100, 100, 80]),
        "market_cap": 2_000_000_000,
        "headlines": ["earnings miss"],
        "eps": 5,
    }]}, DEFAULT_SETTINGS, as_of)
    store.upsert_cards(cards)
    card_id = cards[0]["id"]
    watch_card(store, card_id, price=80)
    hot = list_view(store, quotes={"DROP": {"price": 70}})
    assert hot[0]["alerts"] and hot[0]["alerts"][0]["kind"] == "price"
    quiet = list_view(store, quotes={"DROP": {"price": 78}})
    assert quiet[0]["alerts"] == []
    fresh = dict(cards[0])
    fresh["headlines"] = ["earnings miss", "follow-up suit"]
    fresh["status"] = "new"
    store.upsert_cards([fresh])
    news = list_view(store, quotes={"DROP": {"price": 80}})
    assert any(row["kind"] == "news" for row in news[0]["alerts"])
    report = write_report(cards[0], {"period_end": "2025-12-31", "revenue": 10}, "A model line.")
    assert "Bull case" in report and "Latest annual" in report and "A model line." in report
    bare = attach_watch_alerts({"status": "new", "watch": {"price": 1}}, 2, 0.08)
    assert bare["alerts"] == []


def test_edgar_parsers_and_grok_cost():
    assert hit_count({"hits": {"total": {"value": 12}}}) == 12
    assert hit_count({"hits": {"total": 3}}) == 3
    assert "efts.sec.gov" in edgar_search_link("nuclear", date(2026, 10, 30))
    form4 = """
    <ownershipDocument>
      <issuer><issuerTradingSymbol>ACME</issuerTradingSymbol></issuer>
      <reportingOwner><reportingOwnerId><rptOwnerName>Ada</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><officerTitle>Chief Financial Officer</officerTitle></reportingOwnerRelationship>
      </reportingOwner>
      <periodOfReport>2026-10-01</periodOfReport>
      <nonDerivativeTable><nonDerivativeTransaction>
        <transactionDate><value>2026-10-01</value></transactionDate>
        <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>1000</value></transactionShares>
          <transactionPricePerShare><value>20</value></transactionPricePerShare>
          <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
        </transactionAmounts>
      </nonDerivativeTransaction></nonDerivativeTable>
    </ownershipDocument>
    """
    trades = parse_form4_xml(form4)
    assert trades[0]["ticker"] == "ACME"
    assert trades[0]["value"] == 20000
    info = """
    <informationTable><infoTable>
      <nameOfIssuer>Acme</nameOfIssuer><cusip>123456789</cusip>
      <value>1500</value><shrsOrPrnAmt><sshPrnamt>10</sshPrnamt></shrsOrPrnAmt>
    </infoTable></informationTable>
    """
    rows = parse_13f_infotable(info)
    assert rows[0]["value"] == 1_500_000
    assert grok_call_cost(1_000_000, 1_000_000, (2.0, 6.0), search=True) == 8.025


def test_polish_stops_at_the_cap():
    cards = [
        {"id": "a", "title": "A", "score": 90, "thesis": "old"},
        {"id": "b", "title": "B", "score": 10, "thesis": "old"},
    ]

    def complete(card, remaining):
        if remaining < 6:
            return None
        return ("Polished " + card["title"], 6)

    out, spent = polish_cards(cards, remaining_usd=10, complete_fn=complete, limit=3)
    assert spent == 6
    assert out[0]["thesis"] == "Polished A"
    assert out[1]["thesis"] == "old"


def test_helpers_and_merge():
    assert "XLK" in matching_etfs("Technology", "Semiconductors")
    assert "SMH" in matching_etfs("Technology", "Semiconductors")
    metrics = constituent_metrics("AAA", "Acme", 20, 2, 50, 100)
    assert metrics["pe"] == 10
    assert metrics["debt_to_equity"] == 0.5
    assert metrics["pe_5y"] is None
    assert weekly_universe(["aapl", "AAPL"], ["msft"], cap=2) == ["AAPL", "MSFT"]
    assert parse_stooq_csv("Date,Open,High,Low,Close,Volume\n2026-01-02,1,1,1,12.5,9")[0]["close"] == 12.5
    holdings = tickers_from_holdings({"securities": [{"ticker_symbol": "IBM"}], "holdings": [{"symbol": "T"}]})
    assert holdings == ["T", "IBM"]
    fresh = {"id": "sector:XLK:2026-10-30", "status": "new", "title": "new"}
    kept = merge_card({"id": fresh["id"], "status": "passed", "pass_reason": "structural", "title": "old"}, fresh)
    assert kept["status"] == "passed" and kept["title"] == "new" and kept["pass_reason"] == "structural"
    cleaned = clean_settings({"weights": {"sector": {"drawdown": 99, "relative": 1, "valuation": 1, "balance_sheet": 1}}})
    assert all(5 <= value <= 60 for value in cleaned["weights"]["sector"].values())
    assert 99 <= sum(cleaned["weights"]["sector"].values()) <= 101


def test_value_list_is_a_drop_below_fair_value():
    from pathlib import Path

    from ideas_cards.value_list import build_value_rows, quote_day_return

    down = _bars([100] * 250 + [80], start=date(2025, 1, 2))
    flat = _bars([100] * 30, start=date(2025, 1, 2))
    rows = build_value_rows([
        {
            "ticker": "intc",
            "name": "Intel",
            "fair_value": 100,
            "price": 80,
            "bars": down,
            "rating": "Buy",
            "fair_as_of": "2026-10-01",
        },
        {"ticker": "RICH", "fair_value": 70, "price": 80, "bars": down},
        {"ticker": "FLAT", "fair_value": 120, "price": 100, "bars": flat, "day_return": -0.001},
    ])
    assert [row["ticker"] for row in rows] == ["INTC"]
    assert "week" in rows[0]["windows"]
    assert "today" in rows[0]["reason"] or "this week" in rows[0]["reason"]
    assert "Fair value $100.00" in rows[0]["reason"]
    assert rows[0]["upside"] > 0.2
    assert rows[0]["name"] == "Intel"
    assert quote_day_return(-3.2) == -0.032
    assert quote_day_return(None) is None
    page = Path(__file__).resolve().parents[1].joinpath("web/gp-app/src/pages/IdeasPage.tsx").read_text()
    assert "/api/ideas/equities" in page
    assert "headlines" in page
