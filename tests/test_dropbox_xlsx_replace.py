"""Dropbox Excel export should replace one file, not accumulate copies."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from DGA_analyst import (
    _dropbox_dest_for,
    dropbox_direct_download_url,
    dropbox_file_open_urls,
    dropbox_web_url_for,
    is_dropbox_duplicate_name,
    should_purge_dropbox_xlsx,
    url_has_xlsx_filename,
)


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


def test_models_land_in_excel_folder():
    assert _dropbox_dest_for("NFLX_DGA_Model.xlsx") == "/Excel/NFLX_DGA_Model.xlsx"
    assert _dropbox_dest_for("NFLX_DGA_Model.xlsx", "Excel") == "/Excel/NFLX_DGA_Model.xlsx"
    assert _dropbox_dest_for("NFLX_DGA_Report.docx") == "/Reports/NFLX_DGA_Report.docx"
    dest = "/Excel/NFLX_DGA_Model.xlsx"
    c = "NFLX_DGA_Model.xlsx"
    assert not should_purge_dropbox_xlsx(c, dest, c, dest)
    assert should_purge_dropbox_xlsx(c, "/Reports/NFLX_DGA_Model.xlsx", c, dest)
    assert should_purge_dropbox_xlsx(
        "NFLX_DGA_Model (1).xlsx", "/Excel/NFLX_DGA_Model (1).xlsx", c, dest
    )


def test_dropbox_web_url_for_excel_folder():
    url = dropbox_web_url_for("/Excel/NFLX_DGA_Model.xlsx")
    assert url.startswith("https://www.dropbox.com/home/")
    assert "Apps/DGA" in url.replace("%20", " ")
    assert url.endswith("Excel/NFLX_DGA_Model.xlsx")
    already = dropbox_web_url_for("/Apps/DGA Research/Excel/AAPL_DGA_Model.xlsx")
    assert already.count("/Apps/") == 1


def test_excel_open_url_requires_xlsx_filename():
    assert url_has_xlsx_filename(
        "https://portfolio.dgacapital.com/api/xlsx-open/tok/UBER_DGA_Model.xlsx"
    )
    assert url_has_xlsx_filename(
        "https://www.dropbox.com/s/xxxx/UBER_DGA_Model.xlsx?dl=1"
    )
    # Dropbox temp links have no filename → Excel names the download "file"
    assert not url_has_xlsx_filename(
        "https://dl.dropboxusercontent.com/apitl/1/AADTOKEN"
    )
    assert not url_has_xlsx_filename("")
    dl = dropbox_direct_download_url(
        "https://www.dropbox.com/scl/fi/abc/NFLX_DGA_Model.xlsx?rlkey=zz&dl=0"
    )
    assert "dl=1" in dl
    assert url_has_xlsx_filename(dl)


def test_dropbox_open_urls_never_use_temp_link():
    class _Fake:
        def sharing_list_shared_links(self, path, direct_only=True):
            class L:
                links = []
            return L()

        def sharing_create_shared_link_with_settings(self, path):
            class C:
                url = "https://www.dropbox.com/s/abc/AAPL_DGA_Model.xlsx?dl=0"
            return C()

        def files_get_temporary_link(self, dest):
            raise AssertionError("temp link must not be used for Excel open")

    out = dropbox_file_open_urls(_Fake(), "/Excel/AAPL_DGA_Model.xlsx")
    assert url_has_xlsx_filename(out["open_url"] or "")
    assert out["open_url"].endswith("AAPL_DGA_Model.xlsx?dl=1") or "AAPL_DGA_Model.xlsx" in (
        out["open_url"] or ""
    )


def test_dropbox_open_urls_skip_temp_link_without_filename():
    class _TempOnly:
        def sharing_list_shared_links(self, path, direct_only=True):
            raise RuntimeError("no sharing")

        def sharing_create_shared_link_with_settings(self, path):
            raise RuntimeError("no sharing")

        def files_get_temporary_link(self, dest):
            class T:
                link = "https://dl.dropboxusercontent.com/apitl/1/AADTOKEN"
            return T()

    out = dropbox_file_open_urls(_TempOnly(), "/Excel/AAPL_DGA_Model.xlsx")
    assert out["open_url"] is None
    assert "Excel/AAPL_DGA_Model.xlsx" in (out["web_url"] or "")
