"""Trial office input checks. No database."""
from api.domains.family_offices import validate_office


def test_trial_office_cleans_name_and_email():
    name, email, password = validate_office("  North  Shore  ", "GP@NorthShore.com", "correct-horse")
    assert name == "North Shore"
    assert email == "gp@northshore.com"
    assert password == "correct-horse"


def test_trial_rejects_the_shared_preview_login():
    try:
        validate_office("Preview", "demo@dgacapital.com", "correct-horse")
    except ValueError as exc:
        assert "preview" in str(exc).lower()
    else:
        raise AssertionError("preview login should be rejected")


def test_trial_password_is_at_least_eight():
    try:
        validate_office("Harbor", "a@harbor.com", "short")
    except ValueError as exc:
        assert "8" in str(exc)
    else:
        raise AssertionError("short password should be rejected")
