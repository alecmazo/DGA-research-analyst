"""Office registry checks. No database."""
from api.domains.family_offices import database_name, validate_office


def test_office_slug_becomes_its_own_database_name():
    name, email, slug, db_name = validate_office("  North  Shore  ", "GP@NorthShore.com", "")
    assert name == "North Shore"
    assert email == "gp@northshore.com"
    assert slug == "north_shore"
    assert db_name == "dga_north_shore"
    assert database_name(slug) == db_name


def test_office_rejects_the_shared_preview_login():
    try:
        validate_office("Preview", "demo@dgacapital.com", "preview")
    except ValueError as exc:
        assert "preview" in str(exc).lower()
    else:
        raise AssertionError("preview login should be rejected")


def test_office_rejects_the_dga_database_name():
    try:
        validate_office("Copy", "a@copy.com", "dga")
    except ValueError as exc:
        assert "database" in str(exc).lower()
    else:
        raise AssertionError("dga slug should be rejected")
