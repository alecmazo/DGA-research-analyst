"""Plan Motley Fool earnings-call URLs. No network.

Fool's publish date is often a week or two after the middle of the usual
print month, and the slug is not always ``earnings-call-transcript``.
Some pages drop the word "call". Some year-end pages drop the quarter.
The same rules apply to every ticker.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

# One user refresh of one company. Two slug shapes across the print window
# fits under this cap, including a late August (or May / November / February)
# publish date. Known earnings dates are tried first, with a few extra slugs.
MAX_PROBES = 140
_WINDOW_BEFORE = 8
_WINDOW_AFTER = 45

_SUFFIX = re.compile(
    r"-(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|the)$"
)


def slugify_company(name: str) -> str:
    s = (name or "").lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = _SUFFIX.sub("", s)
    s = re.sub(r"-and$", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def center_date(year: int, quarter: int) -> date:
    """Middle of the usual print month for a calendar quarter."""
    y, q = int(year), int(quarter)
    if q == 1:
        return date(y, 4, 15)
    if q == 2:
        return date(y, 7, 15)
    if q == 3:
        return date(y, 10, 15)
    return date(y + 1, 1, 25)


def _months_ok(quarter: int) -> set[int]:
    return {1: {4, 5}, 2: {7, 8}, 3: {10, 11}}.get(int(quarter), {1, 2})


def print_window(year: int, quarter: int) -> tuple[date, date]:
    """Inclusive dates Fool might have used in the URL path."""
    center = center_date(year, quarter)
    return (
        center - timedelta(days=_WINDOW_BEFORE),
        center + timedelta(days=_WINDOW_AFTER),
    )


def window_is_future(year: int, quarter: int, today: date | None = None) -> bool:
    """True when the print window has not started, so no page exists yet."""
    today = today or date.today()
    start, _end = print_window(year, quarter)
    return start > today


def date_fits_quarter(day: date, year: int, quarter: int) -> bool:
    center = center_date(year, quarter)
    if day.month not in _months_ok(quarter):
        return False
    return abs((day - center).days) <= _WINDOW_AFTER


def parse_day(value) -> date | None:
    """ISO ``2026-07-29`` or Nasdaq ``7/29/2026``. None when it is not a date."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value or "").strip()
    if not raw:
        return None
    head = raw[:10]
    try:
        return date.fromisoformat(head)
    except ValueError:
        pass
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(head, fmt).date()
        except ValueError:
            continue
    return None


def slug_candidates(ticker: str, year: int, quarter: int,
                    company_name: str | None = None) -> list[str]:
    """Slug shapes Fool has used, most common first. Not ticker-specific."""
    tk = (ticker or "").lower().strip()
    if not tk:
        return []
    q, y = int(quarter), int(year)
    call = f"{tk}-q{q}-{y}-earnings-call-transcript"
    bare = f"{tk}-q{q}-{y}-earnings-transcript"
    out: list[str] = []
    seen: set[str] = set()

    def add(slug: str) -> None:
        slug = (slug or "").strip("-")
        if slug and slug not in seen:
            seen.add(slug)
            out.append(slug)

    base = slugify_company(company_name or "")
    if base:
        add(f"{base}-{call}")
        add(f"{base}-{bare}")
        add(f"{base}-{tk}-earnings-transcript")
    add(bare)
    add(call)
    if base:
        parts = [p for p in base.split("-") if p]
        if len(parts) >= 2:
            add(f"{'-'.join(parts[:2])}-{call}")
        if parts:
            add(f"{parts[0]}-{call}")
    return out


def hot_slugs(ticker: str, year: int, quarter: int,
              company_name: str | None = None) -> list[str]:
    """The two shapes tried on every day in the window.

    The first is the company-plus-ticker call page. The second is the
    ticker-only page that omits the word "call". Year-end calls that also
    omit the quarter use that shape as the second probe in Q4.
    """
    tk = (ticker or "").lower().strip()
    if not tk:
        return []
    q, y = int(quarter), int(year)
    call = f"{tk}-q{q}-{y}-earnings-call-transcript"
    bare = f"{tk}-q{q}-{y}-earnings-transcript"
    base = slugify_company(company_name or "")
    out: list[str] = []
    if base:
        out.append(f"{base}-{call}")
    else:
        out.append(call)
    if int(quarter) == 4 and base:
        out.append(f"{base}-{tk}-earnings-transcript")
    else:
        out.append(bare)
    seen: set[str] = set()
    hot: list[str] = []
    for slug in out:
        if slug not in seen:
            seen.add(slug)
            hot.append(slug)
    return hot[:2]


def candidate_dates(year: int, quarter: int, known_dates=None,
                    today: date | None = None) -> list[date]:
    """Known print dates first, then the rest of the window, newest first.

    Newest first so a publish date in the following month is not stuck
    behind three weeks of earlier 404s. Days after ``today`` are omitted.
    """
    today = today or date.today()
    anchors, lag = _anchor_and_lag(year, quarter, known_dates, today)
    seen = set(anchors) | set(lag)
    start, end = print_window(year, quarter)
    months = _months_ok(quarter)
    span: list[date] = []
    day = end
    while day >= start:
        if day <= today and day not in seen and day.month in months:
            span.append(day)
        day -= timedelta(days=1)
    return anchors + lag + span


def _anchor_and_lag(year: int, quarter: int, known_dates, today: date):
    """Earnings dates, then the next two weeks.

    Fool's URL date is the day it published the transcript, which can be
    more than a week after the company reported.
    """
    anchors: list[date] = []
    seen: set[date] = set()
    for raw in known_dates or []:
        day = parse_day(raw)
        if day is None or day > today or day in seen:
            continue
        if not date_fits_quarter(day, year, quarter):
            continue
        seen.add(day)
        anchors.append(day)
    anchors.sort()
    lag: list[date] = []
    for day in anchors:
        for step in range(1, 15):
            nxt = day + timedelta(days=step)
            if nxt > today or nxt in seen:
                continue
            if not date_fits_quarter(nxt, year, quarter):
                continue
            seen.add(nxt)
            lag.append(nxt)
    return anchors, lag


def plan_fool_urls(ticker: str, year: int, quarter: int,
                   company_name: str | None = None,
                   known_dates=None,
                   today: date | None = None) -> list[str]:
    """Ordered Fool URLs to probe. Empty when the print window is still ahead."""
    today = today or date.today()
    if window_is_future(year, quarter, today):
        return []
    tk = (ticker or "").strip()
    if not tk:
        return []
    hot = hot_slugs(tk, year, quarter, company_name)
    if not hot:
        return []
    extra = [s for s in slug_candidates(tk, year, quarter, company_name)
             if s not in hot][:4]
    anchors, lag = _anchor_and_lag(year, quarter, known_dates, today)
    urls: list[str] = []
    seen: set[str] = set()

    def add(day: date, slug: str) -> None:
        if len(urls) >= MAX_PROBES:
            return
        url = (
            "https://www.fool.com/earnings/call-transcripts/"
            f"{day.year}/{day.month:02d}/{day.day:02d}/{slug}/"
        )
        if url not in seen:
            seen.add(url)
            urls.append(url)

    # The report date itself, every likely slug. Then the publish-lag days
    # with the two common slugs. Then the rest of the window, newest first,
    # so a late page is still reached when the history feed has no date.
    for day in anchors:
        for slug in hot + extra:
            add(day, slug)
    for day in lag:
        for slug in hot:
            add(day, slug)
    skip = set(anchors) | set(lag)
    for day in candidate_dates(year, quarter, None, today=today):
        if day in skip:
            continue
        for slug in hot:
            add(day, slug)
        if len(urls) >= MAX_PROBES:
            break
    return urls


def page_matches(html: str, ticker: str, year: int, quarter: int) -> bool:
    """True when this HTML is the requested company's quarter.

    The title is the check. A real transcript title carries the ticker and,
    except on some year-end pages, the quarter. Body text mentions other
    quarters, so a quarter token later in the page is not enough when the
    title already names a different one.
    """
    if not html or len(html) < 1500:
        return False
    found = re.search(r"<title>(.*?)</title>", html[:40000], flags=re.I | re.S)
    if not found:
        return False
    title = re.sub(r"\s+", " ", found.group(1)).strip().lower()
    if not title or "not found" in title or title.startswith("404"):
        return False
    tk = (ticker or "").lower().strip()
    if not tk or not re.search(rf"(^|[^a-z0-9]){re.escape(tk)}([^a-z0-9]|$)", title):
        return False
    if "transcript" not in title:
        return False
    y = str(int(year))
    q = int(quarter)
    titled = re.search(r"\bq\s*([1-4])\b", title)
    titled_year = re.search(r"\b(20[0-9]{2})\b", title)
    if titled:
        if int(titled.group(1)) != q:
            return False
        if titled_year and titled_year.group(1) != y:
            return False
        return True
    low = html.lower()
    if re.search(rf"\bq\s*{q}\s*{re.escape(y)}\b", low):
        return True
    if re.search(rf"\b{re.escape(y)}\s*q\s*{q}\b", low):
        return True
    words = {1: "first", 2: "second", 3: "third", 4: "fourth"}
    return (words[q] + " quarter") in low and y in low
