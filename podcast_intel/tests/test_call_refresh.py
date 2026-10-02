"""Fool URL planning. No network. Uses real publish dates as inputs, not as special cases."""

from datetime import date

from podcast_intel.call_refresh import (
    hot_slugs,
    page_matches,
    plan_fool_urls,
    slugify_company,
    window_is_future,
)

TODAY = date(2026, 9, 28)
BSX = "Boston Scientific Corporation"


def _url(day: str, slug: str) -> str:
    y, m, d = day.split("-")
    return (
        "https://www.fool.com/earnings/call-transcripts/"
        f"{y}/{m}/{d}/{slug}/"
    )


def test_company_slug_strips_legal_suffixes():
    assert slugify_company("Boston Scientific Corporation") == "boston-scientific"
    assert slugify_company("BOSTON SCIENTIFIC CORP") == "boston-scientific"
    assert slugify_company("Wells Fargo & Company") == "wells-fargo"
    assert slugify_company("Apple Inc.") == "apple"


def test_q2_plan_reaches_an_early_august_publish_date():
    urls = plan_fool_urls("BSX", 2026, 2, company_name=BSX, today=TODAY)
    want = _url(
        "2026-08-07",
        "boston-scientific-bsx-q2-2026-earnings-call-transcript",
    )
    assert want in urls
    # Later in the same month, still inside the cap, for any late reporter.
    later = _url(
        "2026-08-20",
        "boston-scientific-bsx-q2-2026-earnings-call-transcript",
    )
    assert later in urls


def test_known_print_date_is_probed_first():
    urls = plan_fool_urls(
        "BSX", 2026, 2, company_name=BSX,
        known_dates=[date(2026, 8, 7)], today=TODAY,
    )
    assert urls[0] == _url(
        "2026-08-07",
        "boston-scientific-bsx-q2-2026-earnings-call-transcript",
    )


def test_publish_date_can_lag_the_earnings_date():
    # Nasdaq sends 7/29/2026. Fool's Q2 page for this pattern is nine days later.
    urls = plan_fool_urls(
        "BSX", 2026, 2, company_name=BSX,
        known_dates=["7/29/2026"], today=TODAY,
    )
    assert urls[0] == _url(
        "2026-07-29",
        "boston-scientific-bsx-q2-2026-earnings-call-transcript",
    )
    want = _url(
        "2026-08-07",
        "boston-scientific-bsx-q2-2026-earnings-call-transcript",
    )
    assert want in urls
    assert urls.index(want) < 30


def test_q1_plan_includes_the_slug_that_omits_call():
    urls = plan_fool_urls("BSX", 2026, 1, company_name=BSX, today=TODAY)
    assert _url("2026-04-22", "bsx-q1-2026-earnings-transcript") in urls
    assert "bsx-q1-2026-earnings-transcript" in hot_slugs("BSX", 2026, 1, BSX)


def test_q4_plan_includes_a_slug_without_the_quarter():
    urls = plan_fool_urls("BSX", 2025, 4, company_name=BSX, today=TODAY)
    assert _url("2026-02-04", "boston-scientific-bsx-earnings-transcript") in urls


def test_same_shapes_for_another_company():
    urls = plan_fool_urls("AAPL", 2026, 2, company_name="Apple Inc.", today=TODAY)
    assert any(
        "apple-aapl-q2-2026-earnings-call-transcript" in url for url in urls
    )
    assert any("aapl-q2-2026-earnings-transcript" in url for url in urls)
    assert window_is_future(2026, 3, TODAY)
    assert plan_fool_urls("AAPL", 2026, 3, company_name="Apple Inc.", today=TODAY) == []


def test_page_match_uses_the_title_not_a_later_mention():
    pad = "<!--" + ("x" * 2000) + "-->"

    def page(title: str, body: str = "") -> str:
        return f"{pad}<title>{title}</title><p>Operator: hello world.</p>{body}"

    q2 = page("Boston Scientific (BSX) Q2 2026 Earnings Call Transcript")
    assert page_matches(q2, "BSX", 2026, 2)
    assert not page_matches(q2, "BSX", 2026, 1)
    assert not page_matches(q2, "AAPL", 2026, 2)

    q1 = page("BSX Q1 2026 Earnings Transcript")
    assert page_matches(q1, "BSX", 2026, 1)
    assert not page_matches(q1, "BSX", 2025, 1)

    year_end = page(
        "Boston Scientific (BSX) Earnings Transcript",
        "<p>Results for Q4 2025 and the fourth quarter.</p>",
    )
    assert page_matches(year_end, "BSX", 2025, 4)
    assert not page_matches(year_end, "BSX", 2026, 2)

    missing = page("404 - Page Not Found")
    assert not page_matches(missing, "BSX", 2026, 2)


def test_discover_uses_the_planner():
    from pathlib import Path
    src = Path(__file__).resolve().parents[2].joinpath("api", "server.py").read_text(
        encoding="utf-8"
    )
    start = src.index("def _discover_fool_transcript_urls")
    end = src.index("def _parse_fool_transcript_page", start)
    body = src[start:end]
    assert "plan_fool_urls" in body
    assert "page_matches" in body
    assert "slugs[:4]" not in body
    assert "range(-10, 14)" not in body
