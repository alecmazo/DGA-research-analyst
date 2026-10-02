"""Daily Treasury par curve and ICE BofA OAS. A failed fetch stays missing.

The October 1 figures on the Paramount fixture are a historical pull. Pricing
does not fall back to them.
"""

from __future__ import annotations

import csv
import io
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from decimal import Decimal
from urllib.request import Request, urlopen

from credit.calc import D

TENOR_HEADERS = {
    "1 mo": "1M",
    "3 mo": "3M",
    "6 mo": "6M",
    "1 yr": "1Y",
    "2 yr": "2Y",
    "3 yr": "3Y",
    "5 yr": "5Y",
    "7 yr": "7Y",
    "10 yr": "10Y",
    "20 yr": "20Y",
    "30 yr": "30Y",
}

OAS_SERIES = {
    "hy": "BAMLH0A0HYM2",
    "ig": "BAMLC0A0CM",
    "bbb": "BAMLC0A4CBBB",
    "bb": "BAMLH0A1HYBB",
    "b": "BAMLH0A2HYB",
    "ccc": "BAMLH0A3HYC",
}

UA = "DGA-Capital-Research/credit (portfolio.dgacapital.com)"
MISSING = (
    "Treasury curve and spread benchmarks are not loaded. "
    "A saved close on the fixture is not used as today's curve."
)

_lock = threading.Lock()
_cache_day: str | None = None
_cache: dict | None = None
_pinned: dict | None = None


def next_business_settlement(today: date | None = None) -> date:
    """T+1 for a US corporate clean price. Saturday and Sunday roll forward.

    Exchange holidays are not applied. This is not the Paramount new-issue close.
    """
    day = (today or date.today()) + timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def missing_benchmarks(reason: str = MISSING) -> dict:
    return {
        "ok": False,
        "curve": {},
        "oas": {},
        "treasury_as_of": "",
        "oas_as_of": "",
        "note": reason,
    }


def install_benchmarks(result: dict | None) -> None:
    """Pin a result for tests. None clears the pin and the day cache."""
    global _pinned, _cache, _cache_day
    _pinned = result
    _cache = None
    _cache_day = None


def _iso_date(raw: str) -> str:
    text = (raw or "").strip()
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    parts = text.replace("-", "/").split("/")
    if len(parts) == 3 and len(parts[2]) == 4:
        month, day, year = parts
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
    return text


def parse_treasury_csv(text: str) -> tuple[str, dict[str, Decimal]] | None:
    """Last complete par curve in a Treasury daily CSV. Dates become YYYY-MM-DD."""
    reader = csv.DictReader(io.StringIO((text or "").lstrip("\ufeff")))
    if not reader.fieldnames:
        return None
    fields = {name.strip().lower(): name for name in reader.fieldnames if name}
    date_key = fields.get("date")
    if not date_key:
        return None
    latest: tuple[str, dict[str, Decimal]] | None = None
    for row in reader:
        raw_date = (row.get(date_key) or "").strip()
        if not raw_date:
            continue
        curve: dict[str, Decimal] = {}
        for header, tenor in TENOR_HEADERS.items():
            source = fields.get(header)
            if not source:
                continue
            cell = (row.get(source) or "").strip()
            if not cell or cell.upper() == "N/A":
                continue
            try:
                curve[tenor] = D(cell)
            except Exception:
                continue
        if "10Y" not in curve or "2Y" not in curve:
            continue
        latest = (_iso_date(raw_date), curve)
    return latest


def parse_fred_csv(text: str) -> tuple[str, str] | None:
    """Last numeric observation. A '.' cell is a missing day, not a zero."""
    reader = csv.reader(io.StringIO((text or "").lstrip("\ufeff")))
    latest: tuple[str, str] | None = None
    for index, row in enumerate(reader):
        if index == 0 or len(row) < 2:
            continue
        raw_date, raw_value = row[0].strip(), row[1].strip()
        if not raw_date or raw_value in {"", ".", "N/A"}:
            continue
        try:
            D(raw_value)
        except Exception:
            continue
        latest = (_iso_date(raw_date), raw_value)
    return latest


def treasury_url(year: int) -> str:
    return (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
        f"&field_tdr_date_value={year}&page&_format=csv"
    )


def fred_url(series: str) -> str:
    return f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"


def _fetch(url: str, timeout: float = 8.0) -> str:
    request = Request(url, headers={"User-Agent": UA, "Accept": "text/csv,*/*"})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def _fetch_all(urls: dict[str, str], fetch) -> dict[str, str]:
    texts = {key: "" for key in urls}

    def one(url: str) -> str:
        try:
            return fetch(url) or ""
        except Exception:
            return ""

    with ThreadPoolExecutor(max_workers=max(1, len(urls))) as pool:
        futures = {pool.submit(one, url): key for key, url in urls.items()}
        try:
            for future in as_completed(futures, timeout=12):
                texts[futures[future]] = future.result()
        except TimeoutError:
            pass
    return texts


def load_benchmarks(today: date | None = None, *, fetch=None) -> dict:
    """Pull today's Treasury par curve and ICE BofA OAS. Never invents a close."""
    fetch = fetch or _fetch
    day = today or date.today()
    urls = {"treasury": treasury_url(day.year)}
    urls.update({key: fred_url(series) for key, series in OAS_SERIES.items()})
    texts = _fetch_all(urls, fetch)
    parsed = parse_treasury_csv(texts.get("treasury") or "")
    if parsed is None and day.month == 1:
        try:
            prior = fetch(treasury_url(day.year - 1)) or ""
        except Exception:
            prior = ""
        parsed = parse_treasury_csv(prior)
    oas: dict[str, str] = {}
    oas_dates: list[str] = []
    for key in OAS_SERIES:
        found = parse_fred_csv(texts.get(key) or "")
        if not found:
            continue
        oas_dates.append(found[0])
        oas[key] = found[1]
    if parsed is None and not oas:
        return missing_benchmarks()
    treasury_as_of = parsed[0] if parsed else ""
    curve = parsed[1] if parsed else {}
    oas_as_of = max(oas_dates) if oas_dates else ""
    if parsed is None:
        note = (
            "Treasury curve is not loaded, so G-spread is not computed. "
            f"Spread benchmarks are the FRED ICE BofA series as of {oas_as_of}. Not a TRACE print."
        )
    elif len(oas) < len(OAS_SERIES):
        note = (
            f"G-spread uses the Treasury par curve as of {treasury_as_of}. "
            "Some ICE BofA spread benchmarks are not loaded. Not a TRACE print."
        )
    else:
        note = (
            f"G-spread uses the Treasury par curve as of {treasury_as_of}. "
            f"Spread benchmarks are the FRED ICE BofA series as of {oas_as_of}. Not a TRACE print."
        )
    return {
        "ok": bool(curve),
        "curve": curve,
        "oas": oas,
        "treasury_as_of": treasury_as_of,
        "oas_as_of": oas_as_of,
        "note": note,
    }


def current_benchmarks(today: date | None = None) -> dict:
    """Process cache for the calendar day. Tests can pin a result."""
    global _cache_day, _cache
    if _pinned is not None:
        return _pinned
    day = (today or date.today()).isoformat()
    with _lock:
        if today is None and _cache_day == day and _cache is not None:
            return _cache
        loaded = load_benchmarks(today or date.today())
        if today is None:
            _cache_day = day
            _cache = loaded
        return loaded
