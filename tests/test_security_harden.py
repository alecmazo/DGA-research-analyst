"""Public surface hardening: no swagger map, no diagnostics leak, no CORS *."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRV = (ROOT / "api" / "server.py").read_text()


def test_openapi_docs_off_by_default():
    assert "docs_url=" in SRV and "_ENABLE_API_DOCS else None" in SRV
    assert "openapi_url=" in SRV
    assert "_ENABLE_API_DOCS" in SRV


def test_diagnostics_not_public():
    # Extract the public-path set literally.
    start = SRV.index("_PUBLIC_PATHS = {")
    end = SRV.index("}", start)
    block = SRV[start:end]
    assert "/api/diagnostics" not in block
    assert "/api/auth/v2/login" in block
    assert 'if claims.get("role") not in ("gp", "admin")' in SRV.split("def diagnostics")[1][:800]


def test_cors_is_allowlist_not_star():
    assert 'allow_origins=["*"]' not in SRV
    assert "allow_credentials=False" in SRV
    assert "https://portfolio.dgacapital.com" in SRV


def test_security_headers_middleware():
    assert "X-Content-Type-Options" in SRV
    assert "X-Frame-Options" in SRV
    assert "Strict-Transport-Security" in SRV
    assert "def _security_headers" in SRV
    assert "def _apply_sec_headers" in SRV


def test_login_rate_limit_covers_v1_and_ip():
    assert "v1|{ip}" in SRV or 'f"v1|{ip}"' in SRV
    assert "_LOGIN_IP_MAX" in SRV
    assert "def _client_ip" in SRV
