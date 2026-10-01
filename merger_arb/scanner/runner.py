"""One scan. A dead source is an error row. The rest of the scan still finishes."""

from __future__ import annotations

import threading
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from merger_arb.scanner.http import PoliteClient, ResponseCache, SecBlocked
from merger_arb.scanner.llm_extract import LlmSkipped, LlmUrlError, extract_llm_fields, resolve_llm_url
from merger_arb.scanner.merge import _apply_fields, merge_records
from merger_arb.scanner.models import FieldValue, SourceRecord
from merger_arb.scanner.pricing import _dec, compute_spread, offer_terms
from merger_arb.scanner.resolve import TickerMap, names_match
from merger_arb.scanner.scoring import score_candidate
from merger_arb.scanner.sources.base import FetchContext
from merger_arb.scanner.status_watch import detect_alerts


def _money(value: Decimal | None) -> str:
    if value is None:
        return ""
    return format(value.quantize(Decimal("0.01")), "f")


def _pct(value: Decimal | None) -> str:
    if value is None:
        return ""
    shown = (value * Decimal(100)).quantize(Decimal("0.01"))
    return f"{shown}%"


def _current_rows(fields: list[dict], name: str) -> list[dict]:
    return [
        row for row in fields
        if row.get("field_name") == name and row.get("is_current", True) and row.get("method") != "llm_unverified"
    ]


def _one(fields: list[dict], name: str):
    rows = _current_rows(fields, name)
    return rows[-1] if rows else None


def _flag(fields: list[dict], name: str) -> bool:
    return any(row.get("field_name") == name and row.get("is_current", True) for row in fields)


def match_desk(candidate: dict, deals: list[dict]) -> dict | None:
    ticker = (candidate.get("target_ticker") or "").upper()
    if not ticker:
        return None
    for deal in deals:
        if deal.get("id") == "fixture-acme" or deal.get("sample"):
            continue
        if (deal.get("target_ticker") or "").upper() != ticker:
            continue
        desk_name = deal.get("acquirer_name") or ""
        cand_name = candidate.get("acquirer_name") or ""
        if desk_name and cand_name and not names_match(desk_name, cand_name):
            continue
        return deal
    return None


def _freeze(bucket: dict) -> dict:
    fields = []
    for row in bucket.get("fields") or []:
        fields.append(row.to_dict() if hasattr(row, "to_dict") else dict(row))
    sources = []
    for row in bucket.get("sources") or []:
        sources.append(dict(row))
    return {
        "deal_key": bucket.get("deal_key") or "",
        "target_cik": bucket.get("target_cik") or "",
        "target_ticker": bucket.get("target_ticker") or "",
        "target_name": bucket.get("target_name") or "",
        "acquirer_cik": bucket.get("acquirer_cik") or "",
        "acquirer_ticker": bucket.get("acquirer_ticker") or "",
        "acquirer_name": bucket.get("acquirer_name") or "",
        "status": bucket.get("status") or "PENDING",
        "hsr": bucket.get("hsr") or "",
        "hidden": bool(bucket.get("hidden")),
        "news_only": bool(bucket.get("news_only")),
        "ignored": bool(bucket.get("ignored")),
        "announce_date": bucket.get("announce_date") or "",
        "expected_close": bucket.get("expected_close") or "",
        "vote_date": bucket.get("vote_date") or "",
        "sources": sources,
        "fields": fields,
        "on_desk": False,
        "desk_deal_id": "",
        "needs_manual_terms": False,
        "current_price": "",
        "acquirer_price": "",
        "offer_value": "",
        "offer_terms": "",
        "gross_spread": "",
        "gross_spread_pct": "",
        "annualized_pct": "",
        "annualized_assumption": "",
        "spread_with_cvr_max": "",
        "consideration_type": "",
        "confidence": 0,
        "confidence_breakdown": [],
    }


def _price_candidate(candidate: dict, quotes: dict, as_of: date) -> None:
    fields = candidate.get("fields") or []
    cash = _one(fields, "cash_per_share")
    ratio = _one(fields, "exchange_ratio")
    close = _one(fields, "expected_close")
    cvr = _one(fields, "cvr")
    cvr_value = _dec(cvr.get("value")) if cvr else None
    manual = _flag(fields, "collar") or _flag(fields, "election") or _flag(fields, "proration")
    target_px = quotes.get((candidate.get("target_ticker") or "").upper())
    acquirer_px = quotes.get((candidate.get("acquirer_ticker") or "").upper())
    if target_px is not None:
        candidate["current_price"] = _money(target_px)
    if acquirer_px is not None:
        candidate["acquirer_price"] = _money(acquirer_px)
    spread = compute_spread(
        cash=None if cash is None else cash.get("value"),
        ratio=None if ratio is None else ratio.get("value"),
        target_price=target_px,
        acquirer_price=acquirer_px,
        close_date=(close or {}).get("value") or candidate.get("expected_close") or "",
        close_text=(close or {}).get("evidence") or "",
        as_of=as_of,
        cvr_max=cvr_value,
        collar=manual and _flag(fields, "collar"),
        election=_flag(fields, "election"),
        proration=_flag(fields, "proration"),
    )
    candidate["needs_manual_terms"] = bool(spread.needs_manual_terms or manual)
    candidate["consideration_type"] = spread.consideration or candidate.get("consideration_type") or ""
    candidate["offer_terms"] = offer_terms(
        cash=None if cash is None else Decimal(str(cash.get("value"))),
        ratio=None if ratio is None else Decimal(str(ratio.get("value"))),
    )
    if candidate["needs_manual_terms"]:
        candidate["offer_value"] = ""
        candidate["gross_spread"] = ""
        candidate["gross_spread_pct"] = ""
        candidate["annualized_pct"] = ""
    else:
        candidate["offer_value"] = _money(spread.offer_value)
        candidate["gross_spread"] = _money(spread.gross_spread)
        candidate["gross_spread_pct"] = _pct(spread.gross_spread_pct)
        candidate["annualized_pct"] = _pct(spread.annualized_pct)
    candidate["annualized_assumption"] = spread.annualized_assumption or ""
    candidate["spread_with_cvr_max"] = _money(spread.spread_with_cvr_max)
    if close and close.get("value"):
        candidate["expected_close"] = str(close.get("value"))[:10]
    vote = _one(fields, "vote_date")
    if vote and vote.get("value"):
        candidate["vote_date"] = str(vote.get("value"))[:10]
    announced = _one(fields, "announce_date")
    if announced and announced.get("value"):
        candidate["announce_date"] = str(announced.get("value"))[:10]


def _record_from_dict(row: dict) -> SourceRecord:
    if isinstance(row, SourceRecord):
        return row
    return SourceRecord(
        source=row.get("source") or "",
        external_id=row.get("external_id") or "",
        url=row.get("url") or "",
        form=row.get("form") or "",
        cik=row.get("cik") or "",
        title=row.get("title") or "",
        published_at=row.get("published_at") or "",
        pulled_at=row.get("pulled_at") or "",
        raw_excerpt=row.get("raw_excerpt") or "",
        event_type=row.get("event_type") or "",
        items=list(row.get("items") or []),
        tickers=list(row.get("tickers") or []),
        display_names=list(row.get("display_names") or []),
        text=row.get("text") or "",
        needs_corroboration=bool(row.get("needs_corroboration")),
        query_has_merger=bool(row.get("query_has_merger")),
        extra=dict(row.get("extra") or {}),
    )


class ScanRunner:
    def __init__(
        self,
        store,
        sources,
        *,
        config,
        client=None,
        clock=None,
        quotes_fn=None,
        desk_deals_fn=None,
        llm_complete=None,
    ):
        self.store = store
        self.sources = list(sources)
        self.config = config
        self.client = client
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.quotes_fn = quotes_fn
        self.desk_deals_fn = desk_deals_fn or (lambda: [])
        self.llm_complete = llm_complete
        self._thread = None

    def _now(self) -> datetime:
        value = self.clock()
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value
        return datetime.now(timezone.utc)

    def start_async(self, **kwargs) -> str:
        run = self.store.start_run(kwargs.get("mode") or "incremental")
        kwargs["run"] = run

        def _go():
            try:
                self.scan_sync(**kwargs)
            except Exception as exc:
                run["status"] = "error"
                run["error"] = str(exc)[:500]
                run["finished_at"] = datetime.now(timezone.utc).isoformat()
                self.store.save_run(run)

        self._thread = threading.Thread(target=_go, name=f"scanner-{run['id']}", daemon=True)
        self._thread.start()
        return run["id"]

    def scan_sync(self, *, mode: str = "incremental", since: str | None = None, since_days: int | None = None, run: dict | None = None) -> dict:
        now = self._now()
        today = now.date()
        if since:
            start = date.fromisoformat(since[:10])
        else:
            start = today - timedelta(days=int(since_days or self.config.lookback_days))
        if run is None:
            run = self.store.start_run("full" if mode == "full" else "incremental")
        run["mode"] = "full" if mode == "full" else "incremental"
        run["status"] = "running"
        progress = []
        for source in self.sources:
            progress.append({
                "name": source.name,
                "label": getattr(source, "label", source.name),
                "status": "queued",
                "count": 0,
                "elapsed_ms": 0,
                "error": "",
                "detail": "",
            })
        run["sources"] = progress
        self.store.save_run(run)

        ctx = FetchContext(
            get=self.client.get if self.client is not None else (lambda url: b""),
            now=now,
            since=start,
            today=today,
            full=mode == "full",
            desk_deals=list(self.desk_deals_fn() or []),
        )
        collected: list[SourceRecord] = []
        ticker_map = TickerMap()
        new_records = 0
        for index, source in enumerate(self.sources):
            row = progress[index]
            fresh = self.store.get_run(run["id"]) or run
            if fresh.get("cancel"):
                run["status"] = "cancelled"
                run["finished_at"] = datetime.now(timezone.utc).isoformat()
                self.store.save_run(run)
                return run
            if self.client is not None and getattr(self.client, "sec_blocked", False) and source.name.startswith("sec_"):
                row["status"] = "skipped"
                row["detail"] = "SEC tier stopped after a block or a rate limit"
                self.store.save_run(run)
                continue
            if not source.enabled():
                row["status"] = "skipped"
                row["detail"] = "Off"
                self.store.save_run(run)
                continue
            started = datetime.now(timezone.utc)
            row["status"] = "running"
            self.store.save_run(run)
            try:
                result = source.fetch(self.store.get_cursor(source.name), ctx)
            except SecBlocked as exc:
                row["status"] = "error"
                row["error"] = str(exc)[:300]
                if self.client is not None:
                    self.client.sec_blocked = True
                self.store.save_run(run)
                continue
            except Exception as exc:
                row["status"] = "error"
                row["error"] = str(exc)[:300]
                self.store.save_run(run)
                continue
            row["elapsed_ms"] = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
            if result.error:
                row["status"] = "error"
                row["error"] = result.error
                row["detail"] = result.detail or ""
            else:
                row["status"] = "done"
                row["detail"] = result.detail or ""
            row["count"] = len(result.records)
            if result.cursor:
                self.store.save_cursor(source.name, result.cursor)
            if result.ticker_map:
                ticker_map = TickerMap(result.ticker_map)
                ctx.ticker_map = result.ticker_map
            payloads = []
            for record in result.records:
                payloads.append(record.to_dict())
                collected.append(record)
            new_records += self.store.add_records(payloads, run["id"])
            self.store.save_run(run)

        self._maybe_llm(collected)
        buckets = merge_records(collected, ticker_map, pulled_at=now.isoformat())
        _attach_llm(buckets)
        ignored = set(getattr(self.store, "ignored", {}) or {})
        deals = list(self.desk_deals_fn() or [])
        quotes = self._quotes(buckets)
        saved = 0
        for bucket in buckets:
            if bucket.get("deal_key") in ignored:
                bucket["ignored"] = True
            candidate = _freeze(bucket)
            _price_candidate(candidate, quotes, today)
            score, breakdown = score_candidate(candidate)
            candidate["confidence"] = score
            candidate["confidence_breakdown"] = breakdown
            desk = match_desk(candidate, deals)
            if desk:
                candidate["desk_deal_id"] = desk.get("id") or ""
                candidate["on_desk"] = True
            self.store.upsert_candidate(candidate)
            saved += 1

        alert_rows = []
        for deal in deals:
            if deal.get("id") == "fixture-acme" or deal.get("sample"):
                continue
            alert_rows.extend(detect_alerts(
                deal,
                collected,
                stored_cash=str(deal.get("stored_cash") or ""),
                stored_vote=str(deal.get("stored_vote") or ""),
            ))
        self.store.add_alerts(alert_rows)
        if run.get("status") != "cancelled":
            run["status"] = "done"
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
        run["counts"] = {"new_records": new_records, "candidates": saved, "alerts": len(alert_rows)}
        self.store.save_run(run)
        return run

    def _quotes(self, buckets: list[dict]) -> dict:
        tickers = []
        for bucket in buckets:
            if bucket.get("hidden"):
                continue
            for key in ("target_ticker", "acquirer_ticker"):
                ticker = (bucket.get(key) or "").upper()
                if ticker and ticker not in tickers:
                    tickers.append(ticker)
        if not tickers or self.quotes_fn is None:
            return {}
        try:
            raw = self.quotes_fn(tickers) or {}
        except Exception:
            return {}
        out = {}
        for ticker, row in raw.items():
            price = row.get("price") if isinstance(row, dict) else row
            if price in (None, ""):
                continue
            try:
                out[str(ticker).upper()] = Decimal(str(price))
            except Exception:
                continue
        return out

    def _maybe_llm(self, records: list[SourceRecord]) -> None:
        if not self.config.llm_enabled:
            return
        try:
            resolve_llm_url(self.config)
        except LlmUrlError:
            return
        complete = self.llm_complete
        if complete is None:
            return
        for record in records:
            if not record.text:
                continue
            try:
                fields = extract_llm_fields(
                    record.text,
                    complete,
                    source_name=("SEC " + record.form) if record.source.startswith("sec") else record.source,
                    source_url=record.url,
                    pulled_at=record.pulled_at,
                )
            except (LlmSkipped, LlmUrlError, Exception):
                continue
            record.extra["llm_fields"] = [row.to_dict() for row in fields]


def default_client(config) -> PoliteClient:
    return PoliteClient(
        user_agent=config.sec_user_agent,
        sec_rps=config.sec_max_rps,
        cache=ResponseCache(config.cache_path),
    )


def _attach_llm(buckets: list[dict]) -> None:
    """Fill terms the regex left empty. Unverified model text stays out of the spread."""
    wanted = {"cash_per_share", "exchange_ratio", "expected_close", "announce_date", "outside_date", "vote_date"}
    for bucket in buckets:
        have = {row.field_name for row in bucket.get("fields") or [] if getattr(row, "is_current", True)}
        for record in bucket.get("records") or []:
            extra = getattr(record, "extra", None) or {}
            for raw in extra.get("llm_fields") or []:
                name = raw.get("field_name") or ""
                if name in wanted and name in have:
                    continue
                _apply_fields(bucket, [FieldValue(
                    field_name=name,
                    value=raw.get("value"),
                    raw=raw.get("raw") or "",
                    source_name=raw.get("source_name") or "",
                    source_url=raw.get("source_url") or "",
                    pulled_at=raw.get("pulled_at") or "",
                    method=raw.get("method") or "llm_unverified",
                    evidence=raw.get("evidence") or "",
                )])
                if raw.get("method") == "llm_verified":
                    have.add(name)


def load_quotes(tickers: list[str]) -> dict:
    """market_data first. Chart JSON, then yfinance, only when that returns nothing."""
    wanted = [ticker for ticker in tickers if ticker]
    if not wanted:
        return {}
    found = {}
    try:
        from market_data import get_quotes
        raw = get_quotes(wanted) or {}
    except Exception:
        raw = {}
    for ticker, row in raw.items():
        price = row.get("price") if isinstance(row, dict) else None
        if price not in (None, ""):
            found[ticker.upper()] = {"price": price, "as_of": (row or {}).get("as_of") or "", "source": "market_data"}
    missing = [ticker for ticker in wanted if ticker.upper() not in found]
    if missing:
        found.update(_chart_quotes(missing))
    still = [ticker for ticker in wanted if ticker.upper() not in found]
    if still:
        found.update(_yfinance_quotes(still))
    return found


def _chart_quotes(tickers: list[str]) -> dict:
    import json
    from urllib.request import Request, urlopen
    out = {}
    for ticker in tickers:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=5d&interval=1d"
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=8) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            continue
        result = (((payload.get("chart") or {}).get("result")) or [None])[0] or {}
        meta = result.get("meta") or {}
        price = meta.get("regularMarketPrice")
        if price is None:
            continue
        out[ticker.upper()] = {
            "price": price,
            "as_of": meta.get("regularMarketTime") or "",
            "source": "Yahoo chart",
        }
    return out


def _yfinance_quotes(tickers: list[str]) -> dict:
    out = {}
    try:
        import yfinance as yf
    except Exception:
        return out
    for ticker in tickers:
        try:
            instrument = yf.Ticker(ticker)
            price = None
            info = getattr(instrument, "fast_info", None)
            if info is not None:
                price = info.get("last_price") if hasattr(info, "get") else getattr(info, "last_price", None)
            if price is None:
                history = instrument.history(period="5d")
                if history is not None and len(history):
                    price = history["Close"].iloc[-1]
            if price is not None:
                out[ticker.upper()] = {"price": float(price), "as_of": "", "source": "yfinance"}
        except Exception:
            continue
    return out


def daily_due(now_local: datetime, hhmm: str, last_date) -> bool:
    text = (hhmm or "").strip()
    if len(text) < 4:
        return False
    return now_local.strftime("%H:%M") == text[:5] and last_date != now_local.date()
