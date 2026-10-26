"""Desk saved reports run on this Mac one company at a time."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_desk_batch_is_one_company_then_the_next():
    page = (ROOT / "web/gp-app/src/pages/LocalPage.tsx").read_text(encoding="utf-8")
    assert "Run desk reports" in page
    assert "Resume desk reports" in page
    assert "Stop after this company" in page
    assert "last 6 hours" in page
    batch = page.split("const runTickerQueue", 1)[1].split("const runDeskReports", 1)[0]
    assert "await writeLocalNote" in batch
    assert "stopDesk.current" in batch
    assert "rememberDeskSave" in batch
    assert "Promise.all" not in batch
    assert "openReportWindow" not in batch
    assert "for (let i = 0; i < queue.length; i++)" in batch
    assert "for (const model of step.models)" in batch
    full = page.split("const runDeskReports", 1)[1].split("const resumeDeskReports", 1)[0]
    assert "/api/reports" in full
    assert "clearDeskMemory" in full
    assert "/api/local/reports" not in full
    resume = page.split("const resumeDeskReports", 1)[1].split("const askQuestion", 1)[0]
    assert "/api/reports" in resume
    assert "/api/local/reports" in resume
    assert "pendingQueue" in resume
    assert "readDeskMemory" in resume
    assert "clearDeskMemory" not in resume
    assert "await runTickerQueue" in resume
    assert "openReportWindow" not in resume


def test_resume_skips_notes_from_the_last_six_hours():
    src = (ROOT / "web/gp-app/src/lib/deskResume.ts").read_text(encoding="utf-8")
    assert "6 * 60 * 60 * 1000" in src
    assert "8 * 60 * 60 * 1000" in src
    assert "dga.local.deskRun" in src
    script = ROOT / "web/gp-app/src/lib/deskResume.check.mjs"
    subprocess.run(["node", str(script)], check=True, cwd=script.parent)
