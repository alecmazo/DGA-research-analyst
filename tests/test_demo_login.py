"""Demo prospect login is demo@dgacapital.com / demo123 and GP-visible."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_demo_password_is_demo123():
    text = (ROOT / "api" / "server.py").read_text()
    assert '_DEMO_GP_EMAIL, _DEMO_GP_PASSWORD = "demo@dgacapital.com", "demo123"' in text
    assert 'gp_set_password' in text
    src = (ROOT / "web/gp-app/src/pages/settings/UsersSection.tsx").read_text()
    assert "/api/v2/admin/demo/status" in src
    assert "Prospect demo login" in src
    assert "Admin User Management" in src
