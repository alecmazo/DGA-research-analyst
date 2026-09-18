"""Report window: export actions in a pulldown; PPT download; no in-page Close."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_report_export_is_a_pulldown():
    src = (ROOT / "web/gp-app/src/pages/ReportPage.tsx").read_text(encoding="utf-8")
    assert 'aria-label="Export and share"' in src
    assert 'value="gamma"' in src
    assert 'value="ppt"' in src
    assert 'value="word"' in src
    assert 'value="excel"' in src
    assert 'value="print"' in src
    assert 'value="share"' in src
    assert "/api/download/" in src and "/pptx" in src
    assert "downloadPptx" in src
    assert "Grok" in src and "Claude" in src
    assert "window.close()" not in src
    assert ">Close<" not in src
    assert 'className={styles.gamma}' not in src


def test_pptx_download_route_exists():
    src = (ROOT / "api/server.py").read_text(encoding="utf-8")
    assert '@app.get("/api/download/{ticker}/pptx")' in src
    assert "DGA_Presentation.pptx" in src
