"""Office registry checks. No database."""
from api.domains.family_offices import database_name, office_setup, validate_office


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


def test_ready_database_says_where_to_log_in():
    setup = office_setup(
        "Genesis Capital",
        "dga_genesis_capital",
        "alecmazo1@gmail.com",
        "ready",
    )
    note = setup["note"]
    assert "dga_genesis_capital" in note
    assert "alecmazo1@gmail.com" in note
    assert "portfolio.dgacapital.com" in note
    assert "Nothing was created in Postgres yet" not in note
    assert setup["steps"][1]["done"] is True
    login = next(step for step in setup["steps"] if "sign in" in step["text"].lower())
    assert login["done"] is False
    assert login["current"] is False
    assert setup["steps"][2]["current"] is True


def test_planned_office_still_says_the_database_is_not_created():
    setup = office_setup("Genesis Capital", "dga_genesis_capital", "a@b.co", "planned")
    assert "Nothing was created in Postgres yet" in setup["note"]
    assert setup["steps"][1]["done"] is False
    assert setup["steps"][1]["current"] is True


def test_office_rejects_the_dga_database_name():
    try:
        validate_office("Copy", "a@copy.com", "dga")
    except ValueError as exc:
        assert "database" in str(exc).lower()
    else:
        raise AssertionError("dga slug should be rejected")
