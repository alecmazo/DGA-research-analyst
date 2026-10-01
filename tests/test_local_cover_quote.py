"""Local notes print the target in the cover row. The list has to read it."""

HYPHEN = "\u2011"  # non-breaking hyphen, as in the local model's "12‑month"


def test_cover_row_without_a_dollar_sign():
    from DGA_analyst import extract_summary_from_report
    md = (
        "# Cover\n"
        f"| Company | Ticker | Date | Price | Prev Close | Market Cap | Rating | 12{HYPHEN}M Target | Upside vs. Current | Thesis |\n"
        "|---------|--------|------|-------|------------|------------|--------|-------------|--------------------|--------|\n"
        "| Brookfield Corp | BN | 2026-09-30 | 36.42 | 36.77 | $81.3 Bn | Buy | 54.40 | 49.6 % | Cash flow. |\n"
        "\n"
        f"We recommend a **Buy** with a 12{HYPHEN}month target of **$54.40**.\n"
        "DCF per-share value is 34.24, indicating a potential upside of ~59 % from the DCF valuation.\n"
    )
    summary = extract_summary_from_report(md)
    assert summary["price_target"] == 54.40
    assert summary["current_price"] == 36.42
    assert summary["prev_close"] == 36.77
    # 59% is the DCF sentence, not target vs the cover price.
    assert summary["upside_pct"] == round((54.40 - 36.42) / 36.42 * 100, 2)
    assert summary["rating"] == "Buy"


def test_thousands_separator_in_the_target():
    from DGA_analyst import extract_summary_from_report
    md = (
        "# Cover\n"
        f"| Company | Ticker | Price | 12{HYPHEN}Month Price Target | Upside vs. Current |\n"
        "|---------|--------|-------|-----------------------|--------------------|\n"
        "| Fair Isaac | FICO | 616.85 | $1,341.16 | 217.5% |\n"
        "\n"
        f"We recommend a **Strong Buy** with a 12{HYPHEN}month target of **$1,341.16**.\n"
    )
    summary = extract_summary_from_report(md)
    assert summary["price_target"] == 1341.16
    assert summary["current_price"] == 616.85
    assert summary["upside_pct"] == round((1341.16 - 616.85) / 616.85 * 100, 2)


def test_desk_cover_anchors_still_win():
    from DGA_analyst import extract_summary_from_report
    md = (
        "| **12-Month Price Target:** $260.00 | Implied Return: -23.1% |\n"
        "| **Current Price:** $338.27 (as of 2026-09-28) | 52-Week Range: $243.42–$345.34 |\n"
        "| **Rating:** SELL |\n"
    )
    summary = extract_summary_from_report(md)
    assert summary["price_target"] == 260.0
    assert summary["current_price"] == 338.27
    assert summary["upside_pct"] == -23.1


def test_saved_row_uses_the_note_when_the_column_is_null():
    from DGA_analyst import local_note_prices
    md = (
        "# Cover\n"
        f"| Company | Ticker | Price | Prev Close | 12{HYPHEN}M Target |\n"
        "|---------|--------|-------|------------|-------------|\n"
        "| Example | BN | 36.42 | 36.77 | 54.40 |\n"
        f"A 12{HYPHEN}month target of **$54.40**.\n"
    )
    row = local_note_prices(md, None, 59.0)
    assert row["price_target"] == 54.40
    assert row["current_price"] == 36.42
    assert row["upside_pct"] == round((54.40 - 36.42) / 36.42 * 100, 2)
    assert row["pct_change"] == round((36.42 - 36.77) / 36.77 * 100, 2)


def test_a_stored_target_is_not_replaced():
    from DGA_analyst import local_note_prices
    md = "12-month target of **$10.00**. Current Price: $8.00\n"
    row = local_note_prices(md, 49.0, 53.8)
    assert row["price_target"] == 49.0
    assert row["upside_pct"] == 53.8


def test_prose_upside_does_not_beat_the_cover_price():
    from DGA_analyst import local_note_prices
    md = (
        "# Cover\n"
        f"| Company | Ticker | Price | Prev Close | 12{HYPHEN}Month Price Target | Upside vs. Current |\n"
        "|---------|--------|-------|------------|-----------------------|--------------------|\n"
        "| Fair Isaac | FICO | 616.85 | 758.30 | $1,341.16 | 217.5% |\n"
        "\n"
        f"We recommend a **Strong Buy** with a 12{HYPHEN}month target of **$1,341.16**.\n"
        "Current price 616.85.\n"
        "offering a compelling upside of over 200% to our target.\n"
    )
    row = local_note_prices(md, None, 200.0)
    assert row["price_target"] == 1341.16
    assert row["current_price"] == 616.85
    assert row["upside_pct"] == round((1341.16 - 616.85) / 616.85 * 100, 2)
