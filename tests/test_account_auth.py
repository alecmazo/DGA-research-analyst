"""Account auth is v2 only. Shared desk and fund passwords are not read."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRV = (ROOT / "api" / "server.py").read_text()
AUTH = (ROOT / "auth_v2.py").read_text()

_SKIP_DIRS = {
    ".git", "node_modules", "dist", "__pycache__", ".venv", "venv",
}
_CODE_SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx", ".html"}


def _source_files():
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in _CODE_SUFFIXES:
            continue
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        yield path


def _fn_body(name: str) -> str:
    start = SRV.index(f"def {name}")
    nxt = SRV.find("\ndef ", start + 4)
    nxt_async = SRV.find("\nasync def ", start + 4)
    ends = [i for i in (nxt, nxt_async) if i != -1]
    end = min(ends) if ends else start + 4000
    return SRV[start:end]


def test_shared_passwords_are_not_read():
    needles = (
        'os.environ.get("PORTFOLIO_PASSWORD"',
        "os.environ.get('PORTFOLIO_PASSWORD'",
        'os.environ["PORTFOLIO_PASSWORD"]',
        "os.environ['PORTFOLIO_PASSWORD']",
        'os.getenv("PORTFOLIO_PASSWORD"',
        'os.environ.get("FUND_PASSWORD"',
        "os.environ.get('FUND_PASSWORD'",
        'os.environ["FUND_PASSWORD"]',
        "os.environ['FUND_PASSWORD']",
        'os.getenv("FUND_PASSWORD"',
        "x-fund-token",
        "x-auth-token",
        "_make_fund_token",
        "_valid_fund_token",
        "def _valid_token",
        "def _portfolio_password",
        "def _fund_password",
    )
    hits = []
    for path in _source_files():
        if path.name == "test_account_auth.py":
            continue
        text = path.read_text(errors="ignore")
        for needle in needles:
            if needle in text:
                hits.append(f"{path.relative_to(ROOT)}: {needle}")
    assert hits == []


def test_legacy_login_routes_are_gone():
    assert '@app.post("/api/auth")' not in SRV
    assert '@app.post("/api/fund/auth")' not in SRV
    public = SRV[SRV.index("_PUBLIC_PATHS = {"):SRV.index("}", SRV.index("_PUBLIC_PATHS = {"))]
    assert '"/api/auth"' not in public
    assert '"/api/auth/v2/login"' in public


def test_fund_gate_is_gp_session_only():
    body = _fn_body("_require_fund_token")
    assert 'claims.get("role") not in ("gp", "admin")' in body
    assert "Authentication required" in body
    assert "GP access required" in body
    assert "fund token" not in body.lower()
    assert "PORTFOLIO_PASSWORD" not in body
    assert "FUND_PASSWORD" not in body


def test_lp_reads_stay_open_to_any_signed_in_account():
    settings = _fn_body("fund_get_settings")
    history = _fn_body("fund_balance_history")
    for body in (settings, history):
        assert "if not claims:" in body
        assert "_require_fund_token(request)" in body
    overview = _fn_body("lp_me_overview")
    assert 'if role in ("gp", "admin"):' in overview
    assert "fund_memberships" in overview


def test_delete_still_requires_gp_and_delete_password():
    body = _fn_body("fund_admin_delete")
    assert "_require_fund_token(request)" in body
    assert 'os.environ.get("FUND_DELETE_PASSWORD"' in body
    assert 'request.headers.get("x-delete-password"' in body


def test_settings_manages_every_login():
    panel = (ROOT / "web/gp-app/src/pages/settings/AccountsPanel.tsx").read_text()
    page = (ROOT / "web/gp-app/src/pages/SettingsPage.tsx").read_text()
    app = (ROOT / "web/gp-app/src/App.tsx").read_text()
    assert "def gp_clear_password" in AUTH
    assert '@app.post("/api/v2/admin/lp/clear-password")' in SRV
    assert "Cannot remove your own password" in SRV
    assert "password_hash_hex" in AUTH.split("def login")[1].split("def ")[0]
    assert "Save email" in panel
    assert "Set password" in panel
    assert "Remove password" in panel
    assert "role: newRole" in panel
    assert page.index('id="set-users"') < page.index('id="set-security"')
    assert "must_change_password && !user.demo_mode" in app
    assert "Choose a new password" in app
    assert '_TOKEN_SECRET_ENV = "TOKEN_SECRET"' in AUTH
    assert "def _token_secret" in AUTH
    assert '"genesis"' in AUTH
    assert '"dgacapital"' in AUTH
    assert "DATA_ENCRYPTION_KEY" in SRV


def test_clients_do_not_prompt_for_shared_passwords():
    mobile = (ROOT / "mobile" / "src" / "api" / "client.js").read_text()
    desk = (ROOT / "web" / "app.js").read_text()
    html = (ROOT / "web" / "index.html").read_text()
    assert "DEFAULT_PASSWORD" not in mobile
    assert "FUND_TOKEN_KEY" not in mobile
    assert "x-auth-v2-token" in mobile
    assert "/api/auth/v2/login" in mobile
    assert "dga_v2_token" in desk
    assert "x-delete-password" in desk
    assert "fund-lock" not in html
    assert "UNLOCK" not in html
    sliw = ROOT / "apps" / "sliw-agent"
    blob = "\n".join(p.read_text(errors="ignore") for p in sliw.rglob("*") if p.is_file() and p.suffix in _CODE_SUFFIXES)
    assert "PORTFOLIO_PASSWORD" not in blob
    assert "FUND_PASSWORD" not in blob
