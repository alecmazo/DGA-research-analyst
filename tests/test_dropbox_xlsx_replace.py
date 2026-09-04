"""Dropbox Excel export should replace one file, not accumulate copies."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from DGA_analyst import is_dropbox_duplicate_name, should_purge_dropbox_xlsx


def test_duplicate_patterns():
    c = "AAPL_DGA_Model.xlsx"
    assert is_dropbox_duplicate_name("AAPL_DGA_Model (1).xlsx", c)
    assert is_dropbox_duplicate_name("AAPL_DGA_Model (12).xlsx", c)
    assert is_dropbox_duplicate_name("AAPL_DGA_Model 2.xlsx", c)
    assert is_dropbox_duplicate_name("AAPL_DGA_Model copy.xlsx", c)
    assert is_dropbox_duplicate_name(
        "AAPL_DGA_Model (conflicted copy 2026-09-03).xlsx", c
    )
    assert is_dropbox_duplicate_name(
        "AAPL_DGA_Model (Alec's conflicted copy 2026-09-03).xlsx", c
    )
    assert is_dropbox_duplicate_name("AAPL_DGA_Model (1) (1).xlsx", c)
    assert not is_dropbox_duplicate_name("AAPL_DGA_Model.xlsx", c)
    assert not is_dropbox_duplicate_name("MSFT_DGA_Model.xlsx", c)
    assert not is_dropbox_duplicate_name("AAPL_DGA_Model_v2.xlsx", c)
    assert not is_dropbox_duplicate_name("AAPL_DGA_Report.docx", c)
    assert not is_dropbox_duplicate_name("Rebalance20260903.xlsx", c)


def test_purge_same_name_elsewhere_keeps_canonical():
    dest = "/Reports/AAPL_DGA_Model.xlsx"
    c = "AAPL_DGA_Model.xlsx"
    assert not should_purge_dropbox_xlsx(c, dest, c, dest)
    assert should_purge_dropbox_xlsx(
        c, "/Rebalanced/AAPL_DGA_Model.xlsx", c, dest
    )
    assert should_purge_dropbox_xlsx(c, "/AAPL_DGA_Model.xlsx", c, dest)
    assert should_purge_dropbox_xlsx(
        "AAPL_DGA_Model (1).xlsx", "/Reports/AAPL_DGA_Model (1).xlsx", c, dest
    )
    assert not should_purge_dropbox_xlsx(
        "MSFT_DGA_Model.xlsx", "/Reports/MSFT_DGA_Model.xlsx", c, dest
    )
