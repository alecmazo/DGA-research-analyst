"""High-yield book is a real issuer list. Low coupons leave the screen."""

from credit.screen import book_rows, screen_view
from credit.universe import UNIVERSE, by_cik


def test_book_is_high_yield_names_with_real_ciks():
    rows = book_rows()
    tickers = {row["ticker"] for row in rows}
    assert "PSKY" in tickers
    assert "CYH" in tickers
    assert "AAPL" not in tickers
    assert "MSFT" not in tickers
    assert len(UNIVERSE) >= 70
    cyh = by_cik("1108109")
    assert cyh is not None
    assert cyh["cik"] == "0001108109"
    assert cyh["ticker"] == "CYH"
    psky = next(row for row in rows if row["ticker"] == "PSKY")
    assert psky["status"] == "structure"
    assert float(psky["coupon_high"]) >= 6
    assert all(row["book"] == "high_yield" for row in rows)
    assert all(row["floor_pct"] == "6" for row in rows)


def test_screen_keeps_a_high_yield_and_drops_a_low_coupon():
    issuer = by_cik("0001108109")
    assert issuer is not None
    high = screen_view(issuer, {"bonds": [{
        "id": "cyh-1",
        "name": "Senior notes",
        "coupon": "8.00",
        "maturity": "2031-10-15",
        "clean_price": "100",
    }]})
    assert high["mode"] == "screen"
    assert high["badge"] == "High yield"
    quote = high["quotes"][0]
    assert quote["on_book"] is True
    assert float(quote["ytm"]) > 7
    assert quote["verdict"] in {"Buy", "Watch", "Avoid"}
    assert "not an agency rating" in high["recovery_note"]

    low = screen_view(issuer, {"bonds": [{
        "id": "ig-1",
        "name": "Low coupon",
        "coupon": "3.40",
        "maturity": "2031-10-15",
        "clean_price": "100",
    }]})
    assert low["badge"] == "Off the book"
    assert low["quotes"][0]["off_book"] is True
    assert float(low["quotes"][0]["ytm"]) < 6
