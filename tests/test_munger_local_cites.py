"""Munger lists companies from local notes, not a missing Grok line."""
from pathlib import Path

from api.domains.munger_cites import rule_citations

ROOT = Path(__file__).resolve().parents[1]


def test_rule_numbers_keep_both_digits():
    text = """
    Rule 4 — Circle of competence
    Microsoft is inside the circle.
    Rule 10 — The Lollapalooza effect
    Margins stack.
    Rule 44 — Defer gratification
    Waiting is the point.
    """
    found = rule_citations(text)
    assert set(found) == {4, 10, 44}
    assert found[44].startswith("Rule 44")
    assert found[4].startswith("Rule 4")


def test_desk_reads_local_reports():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    fn = src.split("def munger_desk")[1].split("\n@app.")[0]
    assert "source = 'local'" in fn
    assert "report_md_local" in src.split("def _munger_index_book")[1].split("\ndef ")[0]
    page = (ROOT / "web/gp-app/src/pages/MungerPage.tsx").read_text(encoding="utf-8")
    assert "/local-report?ticker=" in page
    assert "None of the local reports cite this rule yet." in page
    assert "No saved report has cited this rule" not in page
    assert "saved Grok reports" not in page
