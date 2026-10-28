"""One thesis-timeline snapshot can be deleted without taking the others."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_artifact_names_stay_on_one_engine():
    src = (ROOT / "DGA_analyst.py").read_text(encoding="utf-8")
    mod = ast.parse(src)
    ns = {}
    for node in mod.body:
        if isinstance(node, ast.FunctionDef) and node.name == "report_artifact_names":
            exec(compile(ast.Module([node], type_ignores=[]), "names", "exec"), ns)
    grok = ns["report_artifact_names"]("mgm", "grok")
    claude = ns["report_artifact_names"]("mgm", "claude")
    assert grok == [
        "MGM_DGA_Report.md",
        "MGM_DGA_Report.docx",
        "MGM_DGA_Presentation.pptx",
    ]
    assert "MGM_DGA_Report_claude.md" not in grok
    assert claude[0] == "MGM_DGA_Report_claude.md"
    assert "MGM_DGA_Presentation.pptx" not in claude


def test_delete_route_removes_only_that_version():
    server = (ROOT / "api/server.py").read_text(encoding="utf-8")
    fn = server.split("def delete_report_version")[1].split("\nclass SavedReportEmailRequest")[0]
    assert "DELETE FROM analyst_report_versions" in fn
    assert "WHERE id=%s AND ticker=%s AND provider=%s" in fn
    version_branch = fn.split('str(version_id) != "current"')[1].split("cols = _VERSION_CLEAR_COLUMNS")[0]
    assert "remove_from_dropbox" not in version_branch
    assert "remove_from_dropbox" in fn
    page = (ROOT / "web/gp-app/src/pages/ReportPage.tsx").read_text(encoding="utf-8")
    assert "Delete report" in page
    assert "onContextMenu" in page
    assert 'method: \'DELETE\'' in page
