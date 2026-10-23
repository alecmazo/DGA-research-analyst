"""Preview, the portal, and the email share one letter, and it starts with the date."""
from pathlib import Path

from api.domains.letter_paper import (
    format_letter_date,
    one_account_sections,
    paper_html,
    published_accounts,
)

ROOT = Path(__file__).resolve().parents[1]


def test_date_is_the_first_line_of_one_account():
    html = paper_html(
        date_label="October 23, 2026",
        period="YTD 2026",
        title="Quarterly Letter",
        note="A note for partners.",
        intro="The firm **held** steady.",
        sections=[{"name": "ANAT-DEF", "md": "This account held cash."}],
    )
    assert html.index("October 23, 2026") < html.index("Quarterly Letter")
    assert html.index("October 23, 2026") < html.index("ANAT-DEF")
    assert "This account held cash." in html
    assert "<strong>held</strong>" in html
    assert "AL-DEF" not in html
    assert "EM-DEF" not in html


def test_one_account_preview_drops_every_other_section():
    sections = {
        "anat": {"name": "ANAT-DEF", "md": "only this one"},
        "al": {"name": "AL-DEF", "md": "copied from an older letter"},
    }
    assert one_account_sections(sections, "anat") == [
        {"name": "ANAT-DEF", "md": "only this one"}
    ]
    assert one_account_sections(sections, "") == []
    assert "AL-DEF" not in paper_html(
        date_label="October 23, 2026",
        period="YTD 2026",
        title="Quarterly Letter",
        note="",
        intro="",
        sections=one_account_sections(sections, "anat"),
    )


def test_names_and_dates_are_escaped_and_blank_dates_stay_blank():
    html = paper_html(
        date_label="<script>",
        period="YTD",
        title="Letter",
        note="",
        intro="",
        sections=[{"name": "<b>ANAT</b>", "md": "ok"}],
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;b&gt;ANAT&lt;/b&gt;" in html
    assert format_letter_date("2026-10-23") == "October 23, 2026"
    assert format_letter_date("") == ""
    assert format_letter_date("yesterday") == ""
    assert published_accounts(
        ["anat"],
        {"anat": {"name": "ANAT-DEF", "md": "x"}},
    ) == [{"fund_id": "anat", "name": "ANAT-DEF"}]


def test_open_replaces_sections_and_preview_is_the_shared_paper():
    page = (ROOT / "web" / "gp-app" / "src" / "pages" / "MemosPage.tsx").read_text(
        encoding="utf-8"
    )
    open_fn = page.split("async function qlOpen", 1)[1].split("const publishedSet", 1)[0]
    assert "setQlSections(next)" in open_fn
    assert "setQlSections((prev)" not in open_fn
    assert "qlGenFund(qlSelected.fund_id" in page
    assert "/api/quarterly-letter/preview" in page

    server = (ROOT / "api" / "server.py").read_text(encoding="utf-8")
    preview = server.split('def quarterly_letter_preview', 1)[1].split(
        '@app.get("/api/quarterly-letter/list")', 1
    )[0]
    assert "one_account_sections" in preview
    assert "paper_html" in preview
    save = server.split("def quarterly_letter_save", 1)[1].split(
        "def quarterly_letter_preview", 1
    )[0]
    assert "letter_date" in save
    assert "THEN 'published'" in save
    email = server.split("def _qletter_email_lps", 1)[1].split(
        "def _qletter_publish", 1
    )[0]
    assert "html_body" in email
    publish = server.split("def _qletter_publish", 1)[1].split(
        '@app.post("/api/quarterly-letter/{letter_id}/publish-fund")', 1
    )[0]
    assert "paper_html" in publish
    assert "one_account_sections" in publish
