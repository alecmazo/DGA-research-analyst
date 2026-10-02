"""Scanner tests. Fixtures only. No live network."""

from __future__ import annotations

import json
import socket
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from merger_arb.fixture import build_fixture, fixture_deal
from merger_arb.scanner.actions import add_to_desk, apply_alert
from merger_arb.scanner.classify import classify_filing, classify_headline
from merger_arb.scanner.config import ScannerConfig, _rps
from merger_arb.scanner.extract import extract_terms
from merger_arb.scanner.http import PoliteClient, ResponseCache
from merger_arb.scanner.llm_extract import LlmUrlError, extract_llm_fields, resolve_llm_url
from merger_arb.scanner.merge import merge_records
from merger_arb.scanner.models import FetchResult, SourceRecord
from merger_arb.scanner.pricing import compute_spread
from merger_arb.scanner.resolve import (
    TickerMap,
    document_url,
    normalize_acquirer,
    parse_display_name,
    tickers_in_text,
)
from merger_arb.scanner.runner import ScanRunner, _price_candidate, daily_due
from merger_arb.scanner.sources.fmp import FmpSource
from merger_arb.scanner.sources.ftc_et import parse_ftc
from merger_arb.scanner.sources.rss_parse import parse_rss
from merger_arb.scanner.sources.sec_common import parse_efts
from merger_arb.scanner.sources.sec_efts import SecEftsSource
from merger_arb.scanner.sources.sec_index import parse_form_index
from merger_arb.scanner.sources.sec_submissions import parse_submissions
from merger_arb.scanner.sources.sec_tickers import parse_company_tickers
from merger_arb.scanner.sources.trackers import enabled_adapters
from merger_arb.scanner.status_watch import detect_alerts
from merger_arb.scanner.store import ScannerStore
from merger_arb.store import MemoryStore

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "scanner"
PULLED = "2026-10-01T15:00:00+00:00"


def _read(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def _json(name: str):
    return json.loads(_read(name))


class _Clock:
    def __init__(self):
        self.t = 0.0
        self.slept = []

    def __call__(self):
        return self.t

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += float(seconds)


def test_document_url_and_no_atom_feed():
    url = document_url("0000798359", "0001140361-26-037453", "ef20082596_8k.htm")
    assert url == "https://www.sec.gov/Archives/edgar/data/798359/000114036126037453/ef20082596_8k.htm"
    blob = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "merger_arb" / "scanner").rglob("*.py"))
    assert "cgi-bin/browse-edgar" not in blob
    assert "/api/merger-arb" not in (ROOT / "api" / "server.py").read_text(encoding="utf-8").split("_DEMO_WRITE_ALLOW_PREFIXES = (")[1].split(")")[0]


@pytest.mark.parametrize(
    "form,items,text,expected",
    [
        ("8-K", ["1.01"], "Agreement and Plan of Merger", "NEW_DEAL"),
        ("8-K", ["1.01"], "results of operations", None),
        ("8-K", ["1.01"], "Amendment No. 1 to the Agreement and Plan of Merger", "AMENDED"),
        ("8-K", ["1.02"], "terminated the merger agreement", "TERMINATED"),
        ("8-K", ["2.01"], "", "COMPLETED"),
        ("8-K", ["5.07"], "", "VOTE_RESULT"),
        ("425", [], "merger agreement", "NEW_DEAL"),
        ("425", [], "earnings release", "PENDING_UPDATE"),
        ("PREM14A", [], "", "PENDING_UPDATE"),
        ("PREM14C", [], "", "PENDING_UPDATE"),
        ("DEFM14A", [], "the special meeting will be held on January 20, 2027", "VOTE_SCHEDULED"),
        ("DEFM14A", [], "proxy statement", "PENDING_UPDATE"),
        ("S-4", [], "", "PENDING_UPDATE"),
        ("F-4", [], "", "PENDING_UPDATE"),
        ("S-4/A", [], "", "AMENDED"),
        ("SC TO-T", [], "", "NEW_DEAL"),
        ("SC 14D9", [], "", "NEW_DEAL"),
        ("SC 13E3", [], "", "NEW_DEAL"),
        ("SC TO-I", [], "issuer tender offer", None),
        ("SC TO-I", [], "Agreement and Plan of Merger", "NEW_DEAL"),
        ("25-NSE", [], "", "COMPLETED"),
        ("15", [], "", None),
    ],
)
def test_classify_filing(form, items, text, expected):
    assert classify_filing(form, items, text) == expected


def test_form_15_flag_and_headlines():
    assert classify_filing("15", [], "", allow_form_15=True) == "COMPLETED"
    assert classify_headline("Company enters a definitive agreement to acquire Target") == "NEW_DEAL"
    assert classify_headline("Company completes previously announced merger") == "COMPLETED"
    assert classify_headline("Company terminates the merger agreement") == "TERMINATED"
    assert classify_headline("Company sweetens its bid") == "AMENDED"
    assert classify_headline("quarterly dividend declared") is None


def test_extract_cash_ratio_cvr_dates_and_conflict():
    fields = extract_terms(_read("filing_8k_item101.htm"), source_name="SEC 8-K", source_url="https://example.invalid/8k", pulled_at=PULLED)
    by = {}
    for row in fields:
        by.setdefault(row.field_name, row)
    assert by["cash_per_share"].value == Decimal("50.00")
    assert by["expected_close"].value == "2027-03-31"
    assert "2027-03-31" in (by["expected_close"].evidence or "")
    assert by["outside_date"].value == "2027-06-15"
    assert by["announce_date"].value == "2026-09-20"
    assert by["termination_fee"].value == Decimal("150000000")
    mixed = extract_terms(_read("defm14a_excerpt.htm"), source_name="SEC DEFM14A", source_url="u", pulled_at=PULLED)
    names = {row.field_name for row in mixed}
    assert {"cash_per_share", "exchange_ratio", "cvr", "vote_date"} <= names
    clash = extract_terms(
        "Holders get $50.00 per share in cash. Holders also get $55.00 per share in cash.",
        source_name="SEC 8-K", source_url="u", pulled_at=PULLED,
    )
    cash = [row for row in clash if row.field_name == "cash_per_share"]
    assert len(cash) == 2 and all(row.conflict for row in cash)
    collar = extract_terms("The exchange ratio is subject to a collar.", source_name="SEC 8-K", source_url="u", pulled_at=PULLED)
    assert any(row.field_name == "collar" for row in collar)
    vwap = extract_terms(
        "The price is the volume-weighted average price, or VWAP.",
        source_name="SEC 8-K", source_url="u", pulled_at=PULLED,
    )
    assert not any(row.field_name == "collar" for row in vwap)
    directors = extract_terms(
        "The election of directors is next week. The company may pay cash or stock.",
        source_name="SEC 8-K", source_url="u", pulled_at=PULLED,
    )
    assert not any(row.field_name == "election" for row in directors)
    chosen = extract_terms(
        "Holders may elect to receive cash or stock.",
        source_name="SEC 8-K", source_url="u", pulled_at=PULLED,
    )
    assert any(row.field_name == "election" for row in chosen)


def test_display_name_and_clause_markers():
    parsed = parse_display_name(
        "Bleichroeder Acquisition Corp. II (BBCQ, BBCQU, BBCQW) (CIK 0001819928)"
    )
    assert parsed["ticker"] == "BBCQ"
    assert parsed["cik"] == "0001819928"
    assert parsed["title"] == "Bleichroeder Acquisition Corp. II"
    single = parse_display_name("Acme Corp (ACME) (CIK 123)")
    assert single["ticker"] == "ACME"
    assert single["cik"] == "0000000123"
    assert tickers_in_text("See clause (A) and Nasdaq:ACME") == ["ACME"]


def test_parsers_from_fixtures():
    rows, err = parse_efts(_json("efts_8k_plan_of_merger.json"), pulled_at=PULLED, query_has_merger=True)
    assert err == "" and rows[0].event_type == "NEW_DEAL" and rows[0].items == ["1.01", "9.01"]
    assert rows[0].url.endswith("/1819928/000114036126037453/ef20082596_8k.htm")
    bad, err = parse_efts(_json("efts_bad.json"), pulled_at=PULLED)
    assert bad == [] and "shape" in err
    index = parse_form_index(_read("form_20260930.idx"), pulled_at=PULLED)
    forms = {row.form: row for row in index}
    assert forms["DEFM14A"].event_type == "PENDING_UPDATE"
    assert forms["25-NSE"].needs_corroboration is True
    assert forms["SC TO-I"].event_type == ""
    subs = parse_submissions(_json("submissions_CIK0001819928.json"), pulled_at=PULLED)
    assert subs[0].event_type == "COMPLETED" and "2.01" in subs[0].items
    tickers = parse_company_tickers(_json("company_tickers_small.json"))
    assert tickers["0"]["ticker"] == "ACME"
    notices = parse_ftc(_json("ftc_et_api.json"), pulled_at=PULLED)
    assert notices[0].event_type == "HSR_ET"
    assert notices[0].extra["acquired_party"] == "Acme Target, Inc."
    nasdaq = parse_rss(_read("nasdaq_eca.xml"), source="nasdaq_eca", pulled_at=PULLED)
    assert "ACME" in nasdaq[0].tickers and "Merger closed" in nasdaq[0].title
    prn = parse_rss(_read("prn_ma.xml"), source="prn", pulled_at=PULLED)
    assert prn[0].event_type == "NEW_DEAL"
    gnw = parse_rss(_read("gnw_ma.xml"), source="gnw", pulled_at=PULLED)
    assert "ACME" in gnw[0].tickers and gnw[0].event_type == "AMENDED"
    assert parse_rss("<not xml", source="prn", pulled_at=PULLED) == []


def test_merge_sources_and_competing_bids():
    pulled = PULLED
    eight, _ = parse_efts(_json("efts_8k_plan_of_merger.json"), pulled_at=pulled, query_has_merger=True)
    eight[0].text = _read("filing_8k_item101.htm")
    prn = parse_rss(_read("prn_ma.xml"), source="prn", pulled_at=pulled)
    gnw = parse_rss(_read("gnw_ma.xml"), source="gnw", pulled_at=pulled)
    ftc = parse_ftc(_json("ftc_et_api.json"), pulled_at=pulled)
    ticker_map = TickerMap(parse_company_tickers(_json("company_tickers_small.json")))
    rows = [row for row in merge_records(eight + prn + gnw + ftc, ticker_map, pulled_at=pulled) if not row.get("hidden")]
    assert len(rows) == 1
    assert rows[0]["target_ticker"] == "ACME"
    assert rows[0]["hsr"] == "early_termination_granted"
    assert rows[0]["news_only"] is False
    other = SourceRecord(
        source="prn", external_id="other", title="Other Capital to acquire Acme Target, Inc. (ACME)",
        text="Other Capital to acquire Acme Target, Inc. (ACME) for $60.00 per share in cash.",
        event_type="NEW_DEAL", tickers=["ACME"], pulled_at=pulled,
    )
    both = [row for row in merge_records(eight + [other], ticker_map, pulled_at=pulled) if not row.get("hidden")]
    assert len(both) == 2
    assert normalize_acquirer("Buyer Holdings, L.P.") == "buyer"


def test_pricing_decimal_cases():
    as_of = date(2026, 10, 1)
    cash = compute_spread(cash="50", target_price="40", close_date="2027-10-01", as_of=as_of)
    assert cash.offer_value == Decimal("50")
    assert cash.gross_spread == Decimal("10")
    assert cash.gross_spread_pct == Decimal("0.25")
    assert cash.annualized_pct == Decimal("0.25")
    stock = compute_spread(ratio="0.5", acquirer_price="20", target_price="8", as_of=as_of)
    assert stock.offer_value == Decimal("10")
    mixed = compute_spread(cash="10", ratio="0.5", acquirer_price="20", target_price="16", as_of=as_of)
    assert mixed.offer_value == Decimal("20") and mixed.consideration == "mixed"
    cvr = compute_spread(cash="50", target_price="40", cvr_max="5", as_of=as_of)
    assert cvr.gross_spread == Decimal("10") and cvr.spread_with_cvr_max == Decimal("15")
    missing = compute_spread(ratio="0.5", target_price="8", as_of=as_of)
    assert missing.offer_value is None
    negative = compute_spread(cash="30", target_price="40", as_of=as_of)
    assert negative.gross_spread == Decimal("-10")
    past = compute_spread(cash="50", target_price="40", close_date="2020-01-01", as_of=as_of)
    assert past.annualized_pct is None and "past due" in past.annualized_assumption
    manual = compute_spread(cash="50", target_price="40", collar=True, as_of=as_of)
    assert manual.needs_manual_terms and manual.offer_value is None
    quarter = compute_spread(cash="50", target_price="40", close_text="expected to close in the first quarter of 2027", as_of=as_of)
    assert quarter.annualized_assumption.startswith("Q1 2027 mapped to 2027-03-31")


def test_polite_client_limit_cache_and_block():
    clock = _Clock()
    calls = {"n": 0}

    def transport(url, headers):
        calls["n"] += 1
        assert headers["User-Agent"] == "Alec Research <a@example.com>"
        assert headers["Accept-Encoding"] == "gzip, deflate"
        return 200, {}, b"ok"

    client = PoliteClient(
        user_agent="Alec Research <a@example.com>",
        sec_rps=5,
        transport=transport,
        cache=ResponseCache(""),
        clock=clock,
        sleep=clock.sleep,
        now=lambda: 0,
    )
    for _ in range(6):
        assert client.get("https://www.sec.gov/files/x") == b"ok"
    assert calls["n"] == 1  # cache hit after the first
    assert client.sec_blocked is False
    client.cache = ResponseCache("")
    clock2 = _Clock()
    client.clock = clock2
    client.sleep = clock2.sleep
    client._next.clear()
    for _ in range(6):
        client.cache = ResponseCache("")
        client.get("https://data.sec.gov/submissions/CIK0000000001.json")
    assert clock2.t == pytest.approx(1.0)
    assert _rps("100") == 10

    slept = []

    def limited(url, headers):
        if not slept:
            slept.append("429")
            return 429, {"Retry-After": "2"}, b""
        return 200, {"ETag": "abc"}, b"body"

    retry = PoliteClient(
        user_agent="Alec Research <a@example.com>",
        sec_rps=100,
        transport=limited,
        cache=ResponseCache(""),
        clock=lambda: 0,
        sleep=lambda seconds: slept.append(seconds),
        now=lambda: 0,
    )
    assert retry.sec_rps == 10
    assert retry.get("https://efts.sec.gov/LATEST/search-index?forms=8-K") == b"body"
    assert 2 in slept or 2.0 in slept


def test_llm_substring_and_remote_rejected():
    source = "Buyers receive $50.00 per share in cash from Buyer Holdings Corp."
    ok = extract_llm_fields(
        source,
        lambda _prompt: _read("ollama_extract_ok.json"),
        source_name="SEC 8-K",
        source_url="u",
        pulled_at=PULLED,
    )
    cash = next(row for row in ok if row.field_name == "cash_per_share")
    assert cash.method == "llm_verified"
    bad = extract_llm_fields(
        source,
        lambda _prompt: _read("ollama_extract_hallucinated.json"),
        source_name="SEC 8-K",
        source_url="u",
        pulled_at=PULLED,
    )
    assert bad[0].method == "llm_unverified"
    cfg = ScannerConfig(llm_enabled=True, ollama_base_url="https://api.openai.com/v1")
    with pytest.raises(LlmUrlError):
        resolve_llm_url(cfg)
    remote = ScannerConfig(llm_enabled=True, ollama_base_url="http://10.0.0.8:11434/v1")
    with pytest.raises(LlmUrlError):
        resolve_llm_url(remote)
    allowed = ScannerConfig(llm_enabled=True, ollama_base_url="http://10.0.0.8:11434/v1", allow_remote_llm=True)
    assert resolve_llm_url(allowed).startswith("http://10.0.0.8")
    paid = ScannerConfig(llm_enabled=True, ollama_base_url="https://api.x.ai/v1", allow_remote_llm=True)
    with pytest.raises(LlmUrlError):
        resolve_llm_url(paid)
    assert resolve_llm_url(ScannerConfig(llm_enabled=False, ollama_base_url="https://api.anthropic.com")) is None
    local = ScannerConfig(llm_enabled=True, local_llm_base_url="http://127.0.0.1:11434/v1")
    assert resolve_llm_url(local).startswith("http://127.0.0.1")


def test_status_watch_and_daily_due():
    deal = {"id": "acme-buyr", "target_cik": "0001819928", "target_ticker": "ACME", "target_name": "Acme Target, Inc.", "acquirer_name": "Buyer"}
    close = SourceRecord(source="sec_submissions", external_id="a", form="8-K", cik="0001819928", items=["2.01"], event_type="COMPLETED", url="https://example.invalid/close", pulled_at=PULLED)
    bare = SourceRecord(source="sec_index", external_id="b", form="25-NSE", cik="0001819928", event_type="COMPLETED", needs_corroboration=True, url="u", pulled_at=PULLED)
    assert detect_alerts(deal, [bare]) == []
    found = detect_alerts(deal, [close, bare])
    assert found[0]["alert_type"] == "COMPLETED" and found[0]["certainty"] == "confirmed"
    news = SourceRecord(source="yahoo_rss", external_id="c", event_type="COMPLETED", title="merger closed", tickers=["ACME"], url="u", pulled_at=PULLED)
    reported = detect_alerts(deal, [news])
    assert reported[0]["certainty"] == "reported"
    dead = SourceRecord(source="sec_efts", external_id="d", form="8-K", cik="0001819928", items=["1.02"], event_type="TERMINATED", text="terminated the merger agreement", url="u", pulled_at=PULLED)
    assert detect_alerts(deal, [dead])[0]["alert_type"] == "TERMINATED"
    amended = SourceRecord(
        source="sec_efts", external_id="e", form="8-K", cik="0001819928", items=["1.01"], event_type="AMENDED",
        text="Amendment No. 1. Holders receive $60.00 per share in cash.", url="u", pulled_at=PULLED,
    )
    diff = detect_alerts(deal, [amended], stored_cash="50.00")
    assert diff[0]["details"]["diff"]["cash_per_share"]["after"].startswith("60")
    vote = SourceRecord(
        source="sec_efts", external_id="f", form="DEFM14A", cik="0001819928", event_type="VOTE_SCHEDULED",
        text="The special meeting of stockholders will be held on January 20, 2027.", url="u", pulled_at=PULLED,
    )
    changed = detect_alerts(deal, [vote], stored_vote="2026-12-01")
    assert changed[0]["alert_type"] == "VOTE_DATE"
    result = SourceRecord(source="sec_submissions", external_id="g", form="8-K", cik="0001819928", items=["5.07"], event_type="VOTE_RESULT", url="u", pulled_at=PULLED)
    assert detect_alerts(deal, [result])[0]["alert_type"] == "VOTE_RESULT"
    hsr = parse_ftc(_json("ftc_et_api.json"), pulled_at=PULLED)[0]
    assert detect_alerts(deal, [hsr])[0]["alert_type"] == "HSR_ET"
    moment = datetime(2026, 10, 2, 6, 30, tzinfo=timezone.utc)
    assert daily_due(moment, "06:30", None) is True
    assert daily_due(moment, "06:30", moment.date()) is False
    assert daily_due(moment, "", None) is False


class _Fake:
    name = "sec_efts"
    label = "SEC efts"

    def __init__(self, records, fail=False):
        self.records = records
        self.fail = fail
        self.calls = 0

    def enabled(self):
        return True

    def fetch(self, cursor, ctx):
        self.calls += 1
        if self.fail:
            raise RuntimeError("feed down")
        seen = set((cursor or {}).get("seen_ids") or [])
        fresh = [row for row in self.records if row.external_id not in seen]
        ids = list(seen) + [row.external_id for row in fresh]
        return FetchResult(records=fresh, cursor={"seen_ids": ids, "last_file_date": "2026-09-20"})


class _Off:
    name = "fmp"
    label = "FMP"

    def __init__(self):
        self.calls = 0

    def enabled(self):
        return False

    def fetch(self, cursor, ctx):
        self.calls += 1
        raise AssertionError("disabled source was called")


def _eight_k():
    rows, _ = parse_efts(_json("efts_8k_plan_of_merger.json"), pulled_at=PULLED, query_has_merger=True)
    rows[0].text = _read("filing_8k_item101.htm")
    return rows[0]


def test_runner_cache_incremental_and_no_network(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("network")

    monkeypatch.setattr(socket, "socket", boom)
    monkeypatch.setattr(socket, "create_connection", boom)
    store = ScannerStore()
    record = _eight_k()
    source = _Fake([record])
    off = _Off()
    dead = _Fake([], fail=True)
    dead.name = "gnw"
    dead.label = "GlobeNewswire"
    config = ScannerConfig(sec_user_agent="Alec Research <a@example.com>", llm_enabled=False)
    ticker_source = type("Tickers", (), {
        "name": "sec_tickers",
        "label": "SEC tickers",
        "enabled": lambda self: True,
        "fetch": lambda self, cursor, ctx: FetchResult(ticker_map=parse_company_tickers(_json("company_tickers_small.json"))),
    })()
    runner = ScanRunner(
        store,
        [source, ticker_source, dead, off],
        config=config,
        quotes_fn=lambda tickers: {"ACME": {"price": "40"}, "BUYR": {"price": "20"}},
        desk_deals_fn=lambda: [],
    )
    first = runner.scan_sync(mode="full", since="2026-06-01")
    assert first["status"] == "done"
    assert first["counts"]["new_records"] == 1
    assert dead.calls == 1 and off.calls == 0
    visible = store.list_candidates()
    assert len(visible) == 1
    assert visible[0]["target_ticker"] == "ACME"
    assert visible[0]["offer_value"] == "50.00"
    assert visible[0]["current_price"] == "40.00"
    assert visible[0]["gross_spread"] == "10.00"
    assert visible[0]["confidence"] >= 40
    second = runner.scan_sync(mode="incremental")
    assert second["counts"]["new_records"] == 0
    desk = MemoryStore()
    desk.upsert_deal(fixture_deal())
    before = build_fixture()
    desk.save_version(before)
    assert desk.latest("fixture-acme")["packet_meta"]["deal_id"] == "fixture-acme"
    runner.desk_deals_fn = lambda: [fixture_deal(), {
        "id": "acme-buyer",
        "target_ticker": "ACME",
        "acquirer_name": "Buyer Holdings Corp.",
        "sample": False,
    }]
    store2 = ScannerStore()
    runner.store = store2
    source.calls = 0
    runner.scan_sync(mode="full", since="2026-06-01")
    assert store2.list_candidates() == []
    on_desk = store2.list_candidates(include_on_desk=True)
    assert on_desk and on_desk[0]["desk_deal_id"] == "acme-buyer"
    assert desk.get_deal("fixture-acme")["sample"] is True
    assert len(desk.history("fixture-acme")) == 1


def test_unverified_cash_is_left_out_of_the_spread():
    candidate = {
        "fields": [{
            "field_name": "cash_per_share",
            "value": "99",
            "is_current": True,
            "method": "llm_unverified",
            "source_name": "SEC 8-K",
        }],
        "sources": [],
        "target_ticker": "ACME",
        "news_only": False,
    }
    _price_candidate(candidate, {"ACME": Decimal("40")}, date(2026, 10, 1))
    assert candidate["offer_value"] == ""


def test_actions_require_a_click_and_apply_is_a_new_version():
    scanner = ScannerStore()
    desk = MemoryStore()
    desk.upsert_deal(fixture_deal())
    desk.save_version(build_fixture())
    saved = scanner.upsert_candidate({
        "deal_key": "0001819928|buyer",
        "target_ticker": "ACME",
        "target_name": "Acme Target",
        "acquirer_ticker": "BUYR",
        "acquirer_name": "Buyer Holdings",
        "status": "PENDING",
        "fields": [{
            "field_name": "cash_per_share",
            "value": "50",
            "raw": "$50.00 per share in cash",
            "source_name": "SEC 8-K",
            "source_url": "https://www.sec.gov/example",
            "pulled_at": PULLED,
            "method": "regex",
            "evidence": "per share in cash",
            "is_current": True,
        }],
        "sources": [{"name": "SEC 8-K", "form": "8-K", "items": ["1.01"], "event_type": "NEW_DEAL"}],
    })
    from merger_arb.scanner.actions import ActionError
    with pytest.raises(ActionError):
        add_to_desk(scanner, desk, saved["id"], {})
    assert [row["id"] for row in desk.list_deals()] == ["fixture-acme"]
    wrote = add_to_desk(scanner, desk, saved["id"], {"confirm": True})
    assert wrote["deal_id"] != "fixture-acme"
    packet = desk.latest(wrote["deal_id"])
    assert packet["sections"]["structure"]["cash_per_share"]["value"] == 50.0
    assert packet["sections"]["structure"]["cash_per_share"]["source"]["name"] == "SEC 8-K"
    assert packet["packet_meta"]["version"] == 1
    scanner.ignore_key(saved["deal_key"], "not this one")
    assert scanner.list_candidates() == []
    assert scanner.list_candidates(include_ignored=True)
    alerts = scanner.add_alerts([{
        "desk_deal_id": wrote["deal_id"],
        "alert_type": "AMENDED",
        "certainty": "confirmed",
        "source_url": "https://www.sec.gov/example-amend",
        "source_name": "sec_efts",
        "pulled_at": PULLED,
        "evidence": "amended",
        "details": {"diff": {"cash_per_share": {"before": "50", "after": "60"}}},
    }])
    applied = apply_alert(scanner, desk, alerts[0]["id"], {"confirm": True})
    assert applied["version"] == 2
    first = desk.history(wrote["deal_id"])[0]
    assert first["sections"]["structure"]["cash_per_share"]["value"] == 50.0
    assert desk.latest(wrote["deal_id"])["sections"]["structure"]["cash_per_share"]["value"] == 60.0


def test_api_scan_and_placeholder_skips_sec():
    from api.domains.merger_arb_scanner import create_router

    store = ScannerStore()
    desk = MemoryStore()
    record = _eight_k()
    source = _Fake([record])

    def factory(_store, _desk):
        return ScanRunner(
            store,
            [source],
            config=ScannerConfig(sec_user_agent="Alec Research <a@example.com>"),
            quotes_fn=lambda tickers: {"ACME": {"price": "36"}},
            desk_deals_fn=lambda: [],
        )

    app = FastAPI()
    app.include_router(create_router(lambda _request: {"role": "gp"}, store=store, desk_store=desk, runner_factory=factory))
    client = TestClient(app)
    denied = client.post("/api/merger-arb/scan", json={"mode": "incremental"})
    assert denied.status_code == 200
    run_id = denied.json()["run_id"]
    for _ in range(50):
        body = client.get(f"/api/merger-arb/scan/{run_id}").json()["run"]
        if body["status"] != "running":
            break
    else:
        raise AssertionError("scan did not finish")
    latest = client.get("/api/merger-arb/scan/latest").json()
    assert latest["candidates"]
    assert "PT" in latest["last_scan_pt"] or latest["last_scan_pt"] == ""
    candidate_id = latest["candidates"][0]["id"]
    blocked = client.post(f"/api/merger-arb/candidates/{candidate_id}/add", json={})
    assert blocked.status_code == 400
    assert desk.list_deals() == []
    opened = client.post(f"/api/merger-arb/candidates/{candidate_id}/open-analysis", json={"confirm": True})
    assert opened.status_code == 200
    assert opened.json()["path"].startswith("/merger-arb/analysis/")
    assert desk.get_deal("fixture-acme") is None

    skipped = ScannerStore()
    called = {"n": 0}

    class Sec:
        name = "sec_efts"
        label = "SEC efts"

        def enabled(self):
            return False

        def fetch(self, cursor, ctx):
            called["n"] += 1
            return FetchResult()

    placeholder = ScannerConfig(sec_user_agent="Alec <CONTACT_EMAIL_PLACEHOLDER>")
    assert SecEftsSource(placeholder).enabled() is False
    runner = ScanRunner(skipped, [Sec()], config=placeholder)
    runner.scan_sync(mode="incremental")
    assert called["n"] == 0
    assert enabled_adapters(ScannerConfig()) == []
    assert FmpSource(ScannerConfig()).enabled() is False
    assert FmpSource(ScannerConfig(fmp_api_key="free")).enabled() is True
