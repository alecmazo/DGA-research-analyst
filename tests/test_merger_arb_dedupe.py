"""One deal record and dedupe rules 1-7. Fixtures only. No live database."""

from __future__ import annotations

from merger_arb.scanner.dedupe import collapse, find_match, fixture_rows, plan_collapse
from merger_arb.scanner.merge import merge_candidate, merge_records, precedence
from merger_arb.scanner.models import FetchResult, SourceRecord
from merger_arb.scanner.resolve import TickerMap, deal_key, is_generic_acquirer
from merger_arb.scanner.runner import ScanRunner
from merger_arb.scanner.config import ScannerConfig
from merger_arb.scanner.store import ScannerStore
from merger_arb.store import SCHEMA_SQL, MemoryStore, ensure_tables, reset_ensure_tables

PULLED = "2026-10-01T15:00:00+00:00"


def _map():
    return TickerMap({
        "0": {"ticker": "ACME", "cik_str": "123456", "title": "Acme Target, Inc."},
        "1": {"ticker": "ZZZZ", "cik_str": "999999", "title": "Zed Target"},
        "2": {"ticker": "TGT", "cik_str": "555555", "title": "Tgt Corp"},
        "3": {"ticker": "ALPH", "cik_str": "777777", "title": "Alpha Inc"},
        "4": {"ticker": "DUAL", "cik_str": "666666", "title": "Dual Corp"},
    })


def _sec(**kwargs) -> SourceRecord:
    row = dict(
        source="sec_efts",
        external_id="sec-1",
        form="8-K",
        cik="0000123456",
        title="Acme Target, Inc. (ACME) (CIK 0000123456)",
        display_names=["Acme Target, Inc. (ACME) (CIK 0000123456)"],
        text="Acme Target will be acquired by Buyer Holdings for $50.00 per share in cash.",
        event_type="NEW_DEAL",
        tickers=["ACME"],
        pulled_at=PULLED,
        url="https://www.sec.gov/example-8k",
    )
    row.update(kwargs)
    return SourceRecord(**row)


def test_schema_adds_deal_tables_and_ensure_tables_runs_once():
    text = "\n".join(SCHEMA_SQL)
    for name in (
        "merger_arb_deal_aliases",
        "merger_arb_deal_fields",
        "merger_arb_regulatory",
        "merger_arb_events",
        "merger_arb_spread_history",
        "merger_arb_score_config",
        "deal_key",
        "target_cik",
        "stage",
    ):
        assert name in text

    class Fake:
        def __init__(self):
            self.n = 0

        def cursor(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, _sql):
            self.n += 1

        def commit(self):
            return None

    reset_ensure_tables()
    conn = Fake()
    ensure_tables(conn)
    first = conn.n
    assert first > 0
    ensure_tables(conn)
    assert conn.n == first
    reset_ensure_tables()


def test_generic_acquirer_is_unknown_in_the_deal_key():
    assert is_generic_acquirer("buyer")
    assert is_generic_acquirer("Merger Sub")
    assert deal_key("0000123456", "ACME", "buyer") == "0000123456|unknown"
    assert deal_key("0000123456", "ACME", "Buyer Holdings, L.P.") == "0000123456|buyer"
    assert precedence("desk", "manual") == 100
    assert precedence("SEC 8-K", "regex") < 100


def test_unknown_acquirer_attaches_when_the_name_resolves():
    ticker_map = _map()
    unknown = _sec(
        external_id="unk",
        text="Agreement and Plan of Merger dated as of June 1, 2026.",
    )
    known = _sec(
        source="prn",
        form="",
        external_id="known",
        title="Buyer Holdings to acquire Acme Target, Inc. (ACME)",
        text="Buyer Holdings to acquire Acme Target, Inc. (ACME) for $50.00 per share in cash.",
        display_names=[],
        cik="",
    )
    rows = [row for row in merge_records([unknown, known], ticker_map, pulled_at=PULLED) if not row.get("hidden")]
    assert len(rows) == 1
    assert rows[0]["target_ticker"] == "ACME"
    assert "buyer" in (rows[0].get("acquirer_name") or "").lower() or rows[0]["deal_key"].endswith("|buyer")

    store = ScannerStore()
    first = store.upsert_candidate({
        "deal_key": "0000123456|unknown",
        "target_cik": "0000123456",
        "target_ticker": "ACME",
        "acquirer_name": "",
        "sec_evidence": True,
        "fields": [],
        "sources": [{"name": "SEC 8-K", "source": "sec_efts", "url": "https://sec.example/8k"}],
    })
    second = store.upsert_candidate({
        "deal_key": "0000123456|buyer",
        "target_cik": "0000123456",
        "target_ticker": "ACME",
        "acquirer_name": "Buyer Holdings Corp.",
        "acquirer_cik": "0000888888",
        "sec_evidence": True,
        "fields": [],
        "sources": [{"name": "SEC 8-K", "source": "sec_efts", "url": "https://sec.example/8k-2"}],
    })
    assert first["id"] == second["id"]
    assert len(store.list_candidates(include_hidden=True)) == 1
    assert store.aliases["0000123456|unknown"] == second["id"]
    assert second["deal_key"] == "0000123456|buyer"
    assert second["acquirer_cik"] == "0000888888"


def test_ticker_only_row_rekeys_to_cik():
    ticker_map = _map()
    by_ticker = _sec(
        external_id="tick",
        cik="",
        form="8-K",
        title="Zed Target (ZZZZ)",
        display_names=["Zed Target (ZZZZ)"],
        text="Zed Target will be acquired by Other Capital for $12.00 per share in cash.",
        tickers=["ZZZZ"],
    )
    by_cik = _sec(
        external_id="cik",
        cik="0000999999",
        form="8-K",
        title="Zed Target (ZZZZ) (CIK 0000999999)",
        display_names=["Zed Target (ZZZZ) (CIK 0000999999)"],
        text="Zed Target will be acquired by Other Capital Inc. for $12.00 per share in cash.",
        tickers=["ZZZZ"],
    )
    rows = [row for row in merge_records([by_ticker, by_cik], ticker_map, pulled_at=PULLED) if not row.get("hidden")]
    assert len(rows) == 1
    assert rows[0]["target_cik"] == "0000999999"
    assert rows[0]["deal_key"].startswith("0000999999|")

    store = ScannerStore()
    first = store.upsert_candidate({
        "deal_key": "ZZZZ|other capital",
        "target_ticker": "ZZZZ",
        "acquirer_name": "Other Capital",
        "sec_evidence": True,
        "fields": [],
        "sources": [],
    })
    second = store.upsert_candidate({
        "deal_key": "0000999999|other capital",
        "target_cik": "0000999999",
        "target_ticker": "ZZZZ",
        "acquirer_name": "Other Capital Inc.",
        "sec_evidence": True,
        "fields": [],
        "sources": [],
    })
    assert first["id"] == second["id"]
    assert second["target_cik"] == "0000999999"
    assert store.aliases["ZZZZ|other capital"] == second["id"]


def test_acquirer_filed_425_attaches_as_a_mirror():
    ticker_map = _map()
    deal = _sec(
        external_id="real",
        cik="0000555555",
        form="8-K",
        title="Tgt Corp (TGT) (CIK 0000555555)",
        display_names=["Tgt Corp (TGT) (CIK 0000555555)"],
        text="Tgt Corp will be acquired by Alpha Inc for $50.00 per share in cash.",
        tickers=["TGT"],
    )
    mirror = _sec(
        external_id="425",
        cik="0000777777",
        form="425",
        title="Alpha Inc (ALPH) (CIK 0000777777)",
        display_names=["Alpha Inc (ALPH) (CIK 0000777777)"],
        text="Additional communications regarding the proposed merger.",
        tickers=["ALPH"],
        event_type="NEW_DEAL",
    )
    rows = [row for row in merge_records([deal, mirror], ticker_map, pulled_at=PULLED) if not row.get("hidden")]
    assert len(rows) == 1
    assert rows[0]["target_ticker"] == "TGT"
    assert rows[0]["acquirer_ticker"] == "ALPH" or (rows[0].get("acquirer_cik") == "0000777777")

    store = ScannerStore()
    first = store.upsert_candidate({
        "deal_key": "0000555555|alpha",
        "target_cik": "0000555555",
        "target_ticker": "TGT",
        "acquirer_name": "Alpha Inc",
        "acquirer_cik": "0000777777",
        "acquirer_ticker": "ALPH",
        "sec_evidence": True,
        "form": "8-K",
        "fields": [],
        "sources": [{"name": "SEC 8-K", "source": "sec_efts", "form": "8-K"}],
    })
    second = store.upsert_candidate({
        "deal_key": "0000777777|unknown",
        "target_cik": "0000777777",
        "target_ticker": "ALPH",
        "acquirer_name": "",
        "form": "425",
        "filer_role": "acquirer",
        "mirror": True,
        "sec_evidence": True,
        "fields": [],
        "sources": [{"name": "SEC 425", "source": "sec_efts", "form": "425"}],
    })
    assert first["id"] == second["id"]
    assert len(store.candidates) == 1


def test_two_real_bidders_stay_two_deals():
    rows, report = collapse(fixture_rows())
    dual = [row for row in rows if (row.get("target_ticker") or "").upper() == "DUAL"]
    assert len(dual) == 2
    names = {row.get("acquirer_name") for row in dual}
    assert "Alpha Inc" in names and "Beta Inc" in names
    assert find_match(dual[0], [dual[1]]) is None

    store = ScannerStore()
    a = store.upsert_candidate({
        "deal_key": "0000666666|alpha",
        "target_cik": "0000666666",
        "target_ticker": "DUAL",
        "acquirer_name": "Alpha Inc",
        "acquirer_cik": "0000111111",
        "sec_evidence": True,
        "fields": [],
        "sources": [{"name": "SEC 8-K", "source": "sec_efts"}],
    })
    b = store.upsert_candidate({
        "deal_key": "0000666666|beta",
        "target_cik": "0000666666",
        "target_ticker": "DUAL",
        "acquirer_name": "Beta Inc",
        "acquirer_cik": "0000222222",
        "sec_evidence": True,
        "fields": [],
        "sources": [{"name": "SEC 8-K", "source": "sec_efts"}],
    })
    assert a["id"] != b["id"]
    assert len(store.list_candidates()) == 2


def test_news_only_rescan_keeps_sec_terms_and_manual_overrides():
    store = ScannerStore()
    first = store.upsert_candidate({
        "deal_key": "0000123456|buyer",
        "target_cik": "0000123456",
        "target_ticker": "ACME",
        "acquirer_name": "Buyer Holdings",
        "sec_evidence": True,
        "status": "PENDING",
        "fields": [{
            "field_name": "cash_per_share",
            "value": "50",
            "raw": "$50.00 per share in cash",
            "source_name": "SEC 8-K",
            "source_url": "https://www.sec.gov/8k",
            "pulled_at": PULLED,
            "method": "regex",
            "evidence": "per share in cash",
            "is_current": True,
        }],
        "sources": [{"name": "SEC 8-K", "source": "sec_efts", "url": "https://www.sec.gov/8k"}],
    })
    store.upsert_candidate({
        "id": first["id"],
        "deal_key": "0000123456|buyer",
        "target_cik": "0000123456",
        "target_ticker": "ACME",
        "acquirer_name": "Buyer Holdings",
        "news_only": True,
        "status": "ANNOUNCED (news only)",
        "fields": [{
            "field_name": "announce_date",
            "value": "2026-06-01",
            "raw": "June 1, 2026",
            "source_name": "PR Newswire RSS",
            "source_url": "https://prn.example/acme",
            "pulled_at": PULLED,
            "method": "regex",
            "evidence": "announce",
            "is_current": True,
        }],
        "sources": [{"name": "PR Newswire RSS", "source": "prn", "url": "https://prn.example/acme"}],
    })
    stored = store.get_candidate(first["id"])
    names = {row["field_name"]: row for row in stored["fields"] if row.get("is_current")}
    assert names["cash_per_share"]["value"] == "50"
    assert names["announce_date"]["value"] == "2026-06-01"
    assert stored["news_only"] is False
    assert stored["sec_evidence"] is True

    store.upsert_candidate({
        "deal_key": "0000123456|buyer",
        "target_cik": "0000123456",
        "target_ticker": "ACME",
        "acquirer_name": "Buyer Holdings",
        "fields": [{
            "field_name": "cash_per_share",
            "value": "55",
            "raw": "manual",
            "source_name": "desk",
            "source_url": "",
            "pulled_at": PULLED,
            "method": "manual",
            "evidence": "Alec override",
            "is_current": True,
            "override_note": "confirmed cash",
            "user_name": "alec",
        }],
        "sources": [],
    })
    stored = store.get_candidate(first["id"])
    current_cash = [row for row in stored["fields"] if row["field_name"] == "cash_per_share" and row.get("is_current")]
    assert current_cash[0]["value"] == "55"
    assert current_cash[0]["method"] == "manual"

    merged = merge_candidate(
        {"fields": current_cash, "sources": stored["sources"], "sec_evidence": True, "deal_key": stored["deal_key"]},
        {
            "fields": [{
                "field_name": "cash_per_share",
                "value": "50",
                "source_name": "SEC 8-K",
                "method": "regex",
                "raw": "$50",
                "source_url": "",
                "pulled_at": PULLED,
                "is_current": True,
            }],
            "sources": [],
        },
    )
    current = [row for row in merged["fields"] if row["field_name"] == "cash_per_share" and row.get("is_current")]
    assert current[0]["method"] == "manual"
    assert current[0]["value"] == "55"


def test_migration_twice_is_a_noop_and_writes_screen_deals():
    rows, report = collapse(fixture_rows())
    assert report["after"] < report["before"]
    again, second = collapse(rows)
    assert second["unchanged"] is True
    assert second["after"] == report["after"]
    assert again == rows or [row.get("deal_key") for row in again] == [row.get("deal_key") for row in rows]

    desk = MemoryStore()
    for row in rows:
        desk.upsert_screen_deal(row)
    for alias in report["aliases"]:
        deal_id = desk.resolve_alias(alias["deal_key"])
        if deal_id:
            desk.put_alias(alias["alias_key"], deal_id)
    first_ids = sorted(deal["id"] for deal in desk.list_deals())
    assert all((deal.get("stage") or "screen") == "screen" for deal in desk.list_deals())
    for row in rows:
        desk.upsert_screen_deal(row)
    assert sorted(deal["id"] for deal in desk.list_deals()) == first_ids
    assert any("unknown" in key for key in desk.aliases)


def test_scanner_writes_deals_at_stage_screen():
    class Src:
        name = "sec_efts"
        label = "SEC efts"

        def enabled(self):
            return True

        def fetch(self, cursor, ctx):
            return FetchResult(records=[_sec()], ticker_map={
                "0": {"ticker": "ACME", "cik_str": "123456", "title": "Acme Target, Inc."},
                "1": {"ticker": "BUYR", "cik_str": "888888", "title": "Buyer Holdings"},
            })

    scanner = ScannerStore()
    desk = MemoryStore()
    runner = ScanRunner(
        scanner,
        [Src()],
        config=ScannerConfig(sec_user_agent="Alec Research <a@example.com>", llm_enabled=False),
        quotes_fn=lambda tickers: {"ACME": {"price": "40"}},
        desk_deals_fn=lambda: desk.list_deals(),
        desk_store=desk,
    )
    run = runner.scan_sync(mode="full", since="2026-06-01")
    assert run["status"] == "done"
    deals = [row for row in desk.list_deals() if row.get("id") != "fixture-acme"]
    assert len(deals) == 1
    assert deals[0]["stage"] == "screen"
    assert deals[0]["target_ticker"] == "ACME"
    cash = [row for row in desk.list_deal_fields(deals[0]["id"]) if row.get("field_name") == "cash_per_share"]
    assert cash
    visible = scanner.list_candidates()
    assert len(visible) == 1


def test_scanner_plan_drops_duplicates_and_leaves_the_survivor():
    rows = fixture_rows()
    plan = plan_collapse(rows)
    report = plan["report"]
    assert report["before"] == len(rows)
    assert report["after"] < report["before"]
    assert report["unchanged"] is False
    drop_ids = set(plan["drop_ids"])
    update_ids = {row["id"] for row in plan["updates"]}
    assert drop_ids.isdisjoint(update_ids)
    assert len(rows) - len(drop_ids) == report["after"]
    kept = [row for row in rows if row["id"] not in drop_ids]
    for update in plan["updates"]:
        for row in kept:
            if row["id"] == update["id"]:
                row.update(update)
    _collapsed, second = collapse(kept)
    assert second["unchanged"] is True
