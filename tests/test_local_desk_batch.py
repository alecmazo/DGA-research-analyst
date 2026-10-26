"""Desk saved reports run on this Mac one company at a time."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_desk_batch_is_one_company_then_the_next():
    page = (ROOT / "web/gp-app/src/pages/LocalPage.tsx").read_text(encoding="utf-8")
    assert "Run desk reports" in page
    assert "Stop after this company" in page
    batch = page.split("const runDeskReports", 1)[1].split("const askQuestion", 1)[0]
    assert "/api/reports" in batch
    assert "await writeLocalNote" in batch
    assert "stopDesk.current" in batch
    assert "Promise.all" not in batch
    assert "openReportWindow" not in batch
    assert "for (let i = 0; i < tickers.length; i++)" in batch
    assert "for (const model of models)" in batch
