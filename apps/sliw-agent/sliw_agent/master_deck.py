"""
Materials PDF assets + corporate packages site links for outreach.

- Packages site: https://corporate.edytasliwinska.com/
- Corporate page: https://edytasliwinska.com/corporate
- Wedding/master PDF: Materials → /sliw/media/master-packages.pdf
  (file master_packages.pdf, Dropbox /Apps/Sliw/master_packages.pdf)
- Corporate PDF: Materials → /sliw/media/corporate-packages.pdf
  (file corporate_packages.pdf, Dropbox /Apps/Sliw/corporate_packages.pdf)

Each PDF is dual-written to:
  1. Persistent data dir (STOCKS_FOLDER/sliw-agent when set) — Railway volume
  2. Dropbox /Apps/Sliw/<filename> — survives redeploys even without volume

On miss, local path is re-hydrated from Dropbox before serving.
Corporate outreach must only link the corporate PDF (never master/wedding).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from .talent_bible import TALENT

log = logging.getLogger("sliw.master_deck")

MASTER_PDF_PUBLIC_PATH = "/sliw/media/master-packages.pdf"
MASTER_PDF_FILENAME = "master_packages.pdf"
CORPORATE_PDF_PUBLIC_PATH = "/sliw/media/corporate-packages.pdf"
CORPORATE_PDF_FILENAME = "corporate_packages.pdf"
# Dropbox UI path: Dropbox → Apps → Sliw (override with SLIW_DROPBOX_FOLDER)
DEFAULT_DROPBOX_FOLDER = "/Apps/Sliw"
CORPORATE_PAGE = TALENT.get("corporate_page") or "https://edytasliwinska.com/corporate"
GAMMA_PACKAGES_SITE = (
    (os.environ.get("SLIW_MASTER_DECK_URL") or "").strip()
    or TALENT.get("package_site")
    or "https://corporate.edytasliwinska.com/"
)

_DROPBOX_CLIENT_CACHE: dict[str, Any] = {"client": None, "failed": False}


def data_dir() -> Path:
    """Resolve at call time so env vars from Railway are always honored."""
    from .crm import ensure_dirs
    dedicated = (os.environ.get("SLIW_DATA_DIR") or "").strip()
    if dedicated:
        p = Path(dedicated)
    else:
        stocks = (os.environ.get("STOCKS_FOLDER") or "").strip()
        if stocks:
            p = Path(stocks) / "sliw-agent"
        else:
            p = Path(__file__).resolve().parent.parent / "data"
    p.mkdir(parents=True, exist_ok=True)
    ensure_dirs()
    return p


def master_pdf_path() -> Path:
    return data_dir() / MASTER_PDF_FILENAME


def master_meta_path() -> Path:
    return data_dir() / "master_deck.json"


def dropbox_folder() -> str:
    raw = (os.environ.get("SLIW_DROPBOX_FOLDER") or DEFAULT_DROPBOX_FOLDER).strip()
    raw = raw.strip("/")
    return f"/{raw}" if raw else ""


def dropbox_pdf_dest() -> str:
    folder = dropbox_folder()
    return f"{folder}/{MASTER_PDF_FILENAME}" if folder else f"/{MASTER_PDF_FILENAME}"


def dropbox_corporate_pdf_dest() -> str:
    folder = dropbox_folder()
    return f"{folder}/{CORPORATE_PDF_FILENAME}" if folder else f"/{CORPORATE_PDF_FILENAME}"


def _optional_env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def _dropbox_client():
    """Return a cached Dropbox client, or None if not configured."""
    if _DROPBOX_CLIENT_CACHE["client"] is not None:
        return _DROPBOX_CLIENT_CACHE["client"]
    if _DROPBOX_CLIENT_CACHE["failed"]:
        return None
    try:
        import dropbox  # type: ignore
    except ImportError:
        log.warning("dropbox package not installed")
        _DROPBOX_CLIENT_CACHE["failed"] = True
        return None
    refresh_token = _optional_env("DROPBOX_REFRESH_TOKEN")
    app_key = _optional_env("DROPBOX_APP_KEY")
    app_secret = _optional_env("DROPBOX_APP_SECRET")
    if not (refresh_token and app_key and app_secret):
        return None
    try:
        dbx = dropbox.Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=app_key,
            app_secret=app_secret,
        )
        dbx.users_get_current_account()
        _DROPBOX_CLIENT_CACHE["client"] = dbx
        return dbx
    except Exception as exc:  # noqa: BLE001
        log.warning("Dropbox client init failed: %s", exc)
        _DROPBOX_CLIENT_CACHE["failed"] = True
        return None


def _ensure_dropbox_folder(dbx: Any, folder: str) -> None:
    """Create /Apps/Sliw (or override) if missing. Ignore already-exists."""
    if not folder or folder == "/":
        return
    try:
        import dropbox  # type: ignore
        dbx.files_create_folder_v2(folder)
    except Exception as exc:  # noqa: BLE001
        # already exists or path conflict is fine
        name = type(exc).__name__
        if "Conflict" not in name and "already" not in str(exc).lower():
            log.debug("create_folder %s: %s", folder, exc)


def push_master_pdf_to_dropbox(content: bytes | None = None) -> dict[str, Any]:
    """Upload master PDF to Dropbox /Apps/Sliw (or SLIW_DROPBOX_FOLDER)."""
    dbx = _dropbox_client()
    if dbx is None:
        return {
            "ok": False,
            "skipped": True,
            "error": "Dropbox not configured (DROPBOX_APP_KEY / SECRET / REFRESH_TOKEN)",
        }
    try:
        import dropbox  # type: ignore
    except ImportError:
        return {"ok": False, "error": "dropbox package not installed"}

    data = content
    if data is None:
        path = master_pdf_path()
        if not path.is_file():
            return {"ok": False, "error": "No local PDF to upload"}
        data = path.read_bytes()
    if not data or len(data) < 100:
        return {"ok": False, "error": "PDF content too small"}

    folder = dropbox_folder()
    dest = dropbox_pdf_dest()
    try:
        _ensure_dropbox_folder(dbx, folder)
        meta = dbx.files_upload(
            data,
            dest,
            mode=dropbox.files.WriteMode.overwrite,
            mute=True,
        )
        shared = _get_or_create_shared_link(dbx, dest)
        return {
            "ok": True,
            "path": dest,
            "folder": folder,
            "size": getattr(meta, "size", len(data)),
            "shared_url": shared,
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("Dropbox upload failed (%s): %s", dest, exc)
        return {"ok": False, "error": str(exc), "path": dest}


def _get_or_create_shared_link(dbx: Any, dest: str) -> str | None:
    """Return a direct-ish shared URL for the PDF, or None."""
    try:
        import dropbox  # type: ignore
        # Prefer existing link
        try:
            existing = dbx.sharing_list_shared_links(path=dest, direct_only=True)
            links = getattr(existing, "links", None) or []
            if links:
                url = links[0].url
                return _to_direct_dropbox_url(url)
        except Exception:
            pass
        settings = dropbox.sharing.SharedLinkSettings(
            requested_visibility=dropbox.sharing.RequestedVisibility.public,
        )
        link = dbx.sharing_create_shared_link_with_settings(dest, settings=settings)
        return _to_direct_dropbox_url(link.url)
    except Exception as exc:  # noqa: BLE001
        # link may already exist with different settings
        try:
            link = dbx.sharing_create_shared_link(dest)
            return _to_direct_dropbox_url(link.url)
        except Exception:
            log.debug("shared link for %s: %s", dest, exc)
            return None


def _to_direct_dropbox_url(url: str) -> str:
    """Turn www.dropbox.com/...dl=0 into a browser-friendly link."""
    if not url:
        return url
    if "dl=0" in url:
        return url.replace("dl=0", "dl=1")
    if "dl=1" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}dl=1"


def fetch_master_pdf_from_dropbox() -> dict[str, Any]:
    """Download PDF from Dropbox into local data dir if present."""
    dbx = _dropbox_client()
    if dbx is None:
        return {"ok": False, "skipped": True, "error": "Dropbox not configured"}
    dest = dropbox_pdf_dest()
    try:
        import dropbox  # type: ignore
        _meta, res = dbx.files_download(dest)
        content = res.content
        if not content or len(content) < 100:
            return {"ok": False, "error": "Dropbox file empty"}
        path = master_pdf_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return {
            "ok": True,
            "path": dest,
            "bytes": len(content),
            "local": str(path),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "path": dest}


def delete_master_pdf_from_dropbox() -> dict[str, Any]:
    dbx = _dropbox_client()
    if dbx is None:
        return {"ok": False, "skipped": True}
    dest = dropbox_pdf_dest()
    try:
        dbx.files_delete_v2(dest)
        return {"ok": True, "path": dest}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "path": dest}


def hydrate_master_pdf_if_needed() -> bool:
    """If local PDF missing, try Dropbox. Returns True if local file exists after."""
    if master_pdf_exists(hydrate=False):
        return True
    result = fetch_master_pdf_from_dropbox()
    if result.get("ok"):
        log.info("Hydrated master PDF from Dropbox %s", result.get("path"))
        return master_pdf_exists(hydrate=False)
    return False


def get_master_deck_url() -> str:
    return GAMMA_PACKAGES_SITE.rstrip("/") + "/"


def get_corporate_page_url() -> str:
    return CORPORATE_PAGE


def master_pdf_exists(*, hydrate: bool = True) -> bool:
    p = master_pdf_path()
    try:
        if p.is_file() and p.stat().st_size > 100:
            return True
    except OSError:
        pass
    if hydrate:
        return hydrate_master_pdf_if_needed()
    return False


def public_base_url(request_base: str | None = None) -> str:
    for key in ("PUBLIC_BASE_URL", "SLIW_PUBLIC_BASE_URL", "RAILWAY_STATIC_URL"):
        raw = (os.environ.get(key) or "").strip().rstrip("/")
        if raw:
            if not raw.startswith("http"):
                raw = "https://" + raw
            return raw
    domain = (os.environ.get("RAILWAY_PUBLIC_DOMAIN") or "").strip()
    if domain:
        return "https://" + domain.rstrip("/")
    if request_base:
        base = str(request_base).rstrip("/")
        try:
            from urllib.parse import urlparse
            u = urlparse(base if "://" in base else "https://" + base)
            if u.scheme and u.netloc:
                return f"{u.scheme}://{u.netloc}"
        except Exception:
            pass
        return base
    return ""


def get_pdf_url(request_base: str | None = None) -> str:
    env = (os.environ.get("SLIW_MASTER_DECK_PDF_URL") or "").strip()
    if env:
        return env
    if not master_pdf_exists():
        # external URL only (e.g. Dropbox shared link preserved in meta)
        try:
            data = json.loads(master_meta_path().read_text(encoding="utf-8"))
            url = (data.get("pdf_url") or data.get("dropbox_shared_url") or "").strip()
            if url and MASTER_PDF_PUBLIC_PATH not in url and url.startswith("http"):
                return url
        except Exception:
            pass
        return ""
    base = public_base_url(request_base)
    if base:
        return base + MASTER_PDF_PUBLIC_PATH
    return MASTER_PDF_PUBLIC_PATH


def get_master_deck_meta(request_base: str | None = None) -> dict[str, Any]:
    # Attempt hydrate so Materials shows PDF after redeploy
    exists = master_pdf_exists(hydrate=True)
    pdf_path = master_pdf_path()
    pdf_url = get_pdf_url(request_base) if exists else (get_pdf_url(request_base) or None)

    old: dict[str, Any] = {}
    try:
        if master_meta_path().exists():
            old = json.loads(master_meta_path().read_text(encoding="utf-8"))
    except Exception:
        old = {}

    dropbox_status = {
        "folder": dropbox_folder(),
        "path": dropbox_pdf_dest(),
        "configured": _dropbox_client() is not None,
        "shared_url": old.get("dropbox_shared_url"),
        "last_upload_ok": old.get("dropbox_ok"),
        "last_error": old.get("dropbox_error"),
    }

    meta: dict[str, Any] = {
        "status": "published_site_with_pdf" if exists else "published_site",
        "gamma_url": get_master_deck_url(),
        "gamma_site": get_master_deck_url(),
        "corporate_page": get_corporate_page_url(),
        "pdf_url": pdf_url if exists or (pdf_url and str(pdf_url).startswith("http")) else (pdf_url if exists else None),
        "pdf_uploaded": exists,
        "pdf_bytes": pdf_path.stat().st_size if exists else 0,
        "pdf_public_path": MASTER_PDF_PUBLIC_PATH,
        "pdf_filename": old.get("pdf_original_name") or (MASTER_PDF_FILENAME if exists else None),
        "pdf_original_name": old.get("pdf_original_name") if exists else None,
        "pdf_uploaded_at": old.get("pdf_uploaded_at") if exists else None,
        "pdf_preview_url": (pdf_url or MASTER_PDF_PUBLIC_PATH) if exists else None,
        "data_dir": str(data_dir()),
        "pdf_storage_path": str(pdf_path),
        "dropbox": dropbox_status,
        "dropbox_path": dropbox_pdf_dest(),
        "dropbox_shared_url": old.get("dropbox_shared_url"),
        "note": (
            "Two Materials PDF slots: wedding/master (partner kit) and corporate packages. "
            "Corporate outreach links corporate.edytasliwinska.com and corporate-packages.pdf only "
            "(never master-packages.pdf). Both mirrored to Dropbox Apps/Sliw."
        ),
        "updated_at": datetime.utcnow().isoformat(),
    }
    if exists and not meta.get("pdf_url"):
        meta["pdf_url"] = MASTER_PDF_PUBLIC_PATH
        meta["pdf_preview_url"] = MASTER_PDF_PUBLIC_PATH

    # Corporate packages PDF (separate slot; dual-write + hydrate via Dropbox)
    corp_exists = corporate_pdf_exists(hydrate=True)
    corp_path = corporate_pdf_path()
    corp_url = get_corporate_pdf_url(request_base) if corp_exists else (get_corporate_pdf_url(request_base) or None)
    meta["pdf_slot"] = "wedding_master"
    meta["pdf_label"] = "Master packages PDF (wedding)"
    meta["corporate_pdf_url"] = corp_url if corp_exists else None
    meta["corporate_pdf_uploaded"] = corp_exists
    meta["corporate_pdf_bytes"] = corp_path.stat().st_size if corp_exists else 0
    meta["corporate_pdf_public_path"] = CORPORATE_PDF_PUBLIC_PATH
    meta["corporate_pdf_filename"] = old.get("corporate_pdf_original_name") or (
        CORPORATE_PDF_FILENAME if corp_exists else None
    )
    meta["corporate_pdf_original_name"] = old.get("corporate_pdf_original_name") if corp_exists else None
    meta["corporate_pdf_uploaded_at"] = old.get("corporate_pdf_uploaded_at") if corp_exists else None
    meta["corporate_pdf_preview_url"] = (
        (corp_url or CORPORATE_PDF_PUBLIC_PATH) if corp_exists else None
    )
    meta["corporate_pdf_storage_path"] = str(corp_path)
    meta["corporate_dropbox"] = {
        "folder": dropbox_folder(),
        "path": dropbox_corporate_pdf_dest(),
        "configured": _dropbox_client() is not None,
        "shared_url": old.get("corporate_dropbox_shared_url"),
        "last_upload_ok": old.get("corporate_dropbox_ok"),
        "last_error": old.get("corporate_dropbox_error"),
        "ok": old.get("corporate_dropbox_ok"),
        "error": old.get("corporate_dropbox_error"),
    }
    meta["corporate_dropbox_path"] = dropbox_corporate_pdf_dest()
    meta["corporate_dropbox_shared_url"] = old.get("corporate_dropbox_shared_url")
    meta["corporate_dropbox_ok"] = old.get("corporate_dropbox_ok")
    meta["corporate_dropbox_error"] = old.get("corporate_dropbox_error")
    if corp_exists and not meta.get("corporate_pdf_url"):
        meta["corporate_pdf_url"] = CORPORATE_PDF_PUBLIC_PATH
        meta["corporate_pdf_preview_url"] = CORPORATE_PDF_PUBLIC_PATH

    try:
        master_meta_path().write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass
    return meta


def ensure_master_deck(*, live: bool = False) -> dict[str, Any]:
    return get_master_deck_meta()


def save_master_pdf(
    content: bytes,
    *,
    original_name: str = MASTER_PDF_FILENAME,
    request_base: str | None = None,
) -> dict[str, Any]:
    if not content or len(content) < 100:
        raise ValueError("Empty or tiny file — expected a real PDF")
    if not content[:8].startswith(b"%PDF") and not original_name.lower().endswith(".pdf"):
        raise ValueError("File does not look like a PDF")

    path = master_pdf_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)

    if not path.is_file() or path.stat().st_size < 100:
        raise ValueError(f"Failed to write PDF to {path}")

    # Dual-write to Dropbox /Apps/Sliw (best-effort; local save already succeeded)
    dbx_result = push_master_pdf_to_dropbox(content)

    uploaded_at = datetime.utcnow().isoformat()
    pdf_url = get_pdf_url(request_base) or MASTER_PDF_PUBLIC_PATH
    meta = {
        "status": "published_site_with_pdf",
        "gamma_url": get_master_deck_url(),
        "gamma_site": get_master_deck_url(),
        "corporate_page": get_corporate_page_url(),
        "pdf_url": pdf_url,
        "pdf_preview_url": pdf_url,
        "pdf_uploaded": True,
        "pdf_bytes": path.stat().st_size,
        "pdf_public_path": MASTER_PDF_PUBLIC_PATH,
        "pdf_filename": original_name,
        "pdf_original_name": original_name,
        "pdf_uploaded_at": uploaded_at,
        "data_dir": str(data_dir()),
        "pdf_storage_path": str(path),
        "dropbox": {
            "folder": dropbox_folder(),
            "path": dropbox_pdf_dest(),
            "configured": _dropbox_client() is not None,
            "ok": bool(dbx_result.get("ok")),
            "skipped": bool(dbx_result.get("skipped")),
            "error": dbx_result.get("error"),
            "shared_url": dbx_result.get("shared_url"),
        },
        "dropbox_path": dropbox_pdf_dest(),
        "dropbox_ok": bool(dbx_result.get("ok")),
        "dropbox_error": dbx_result.get("error"),
        "dropbox_shared_url": dbx_result.get("shared_url"),
        "note": (
            "Wedding master PDF on disk + Dropbox /Apps/Sliw/master_packages.pdf."
            if dbx_result.get("ok")
            else "Wedding master PDF on disk. Dropbox mirror skipped or failed — see dropbox_error."
        ),
        "updated_at": uploaded_at,
    }
    # Persist slot-local fields; return full Materials meta (both PDF slots)
    master_meta_path().write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return get_master_deck_meta(request_base=request_base)


def delete_master_pdf() -> dict[str, Any]:
    p = master_pdf_path()
    if p.exists():
        p.unlink()
    delete_master_pdf_from_dropbox()
    # Clear dropbox fields in persisted master meta, then return dual-slot meta
    try:
        old: dict = {}
        if master_meta_path().exists():
            old = json.loads(master_meta_path().read_text(encoding="utf-8"))
        old["dropbox_shared_url"] = None
        old["dropbox_ok"] = None
        old["pdf_uploaded"] = False
        master_meta_path().write_text(json.dumps(old, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass
    return get_master_deck_meta()



def corporate_pdf_path() -> Path:
    return data_dir() / CORPORATE_PDF_FILENAME


def push_corporate_pdf_to_dropbox(content: bytes | None = None) -> dict[str, Any]:
    """Upload corporate PDF to Dropbox /Apps/Sliw/corporate_packages.pdf."""
    dbx = _dropbox_client()
    if dbx is None:
        return {
            "ok": False,
            "skipped": True,
            "error": "Dropbox not configured (DROPBOX_APP_KEY / SECRET / REFRESH_TOKEN)",
        }
    try:
        import dropbox  # type: ignore
    except ImportError:
        return {"ok": False, "error": "dropbox package not installed"}

    data = content
    if data is None:
        path = corporate_pdf_path()
        if not path.is_file():
            return {"ok": False, "error": "No local corporate PDF to upload"}
        data = path.read_bytes()
    if not data or len(data) < 100:
        return {"ok": False, "error": "PDF content too small"}

    folder = dropbox_folder()
    dest = dropbox_corporate_pdf_dest()
    if dest.rstrip("/").endswith("/" + MASTER_PDF_FILENAME) or dest.endswith(MASTER_PDF_FILENAME):
        return {"ok": False, "error": "Refusing Dropbox path that would overwrite wedding master PDF"}
    try:
        _ensure_dropbox_folder(dbx, folder)
        meta = dbx.files_upload(
            data,
            dest,
            mode=dropbox.files.WriteMode.overwrite,
            mute=True,
        )
        shared = _get_or_create_shared_link(dbx, dest)
        return {
            "ok": True,
            "path": dest,
            "folder": folder,
            "size": getattr(meta, "size", len(data)),
            "shared_url": shared,
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("Dropbox corporate upload failed (%s): %s", dest, exc)
        return {"ok": False, "error": str(exc), "path": dest}


def fetch_corporate_pdf_from_dropbox() -> dict[str, Any]:
    """Download corporate PDF from Dropbox into local data dir if present."""
    dbx = _dropbox_client()
    if dbx is None:
        return {"ok": False, "skipped": True, "error": "Dropbox not configured"}
    dest = dropbox_corporate_pdf_dest()
    try:
        _meta, res = dbx.files_download(dest)
        content = res.content
        if not content or len(content) < 100:
            return {"ok": False, "error": "Dropbox file empty"}
        path = corporate_pdf_path()
        if path.name == MASTER_PDF_FILENAME:
            return {"ok": False, "error": "Refusing to hydrate into wedding master path"}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return {
            "ok": True,
            "path": dest,
            "bytes": len(content),
            "local": str(path),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "path": dest}


def delete_corporate_pdf_from_dropbox() -> dict[str, Any]:
    dbx = _dropbox_client()
    if dbx is None:
        return {"ok": False, "skipped": True}
    dest = dropbox_corporate_pdf_dest()
    if dest.endswith(MASTER_PDF_FILENAME):
        return {"ok": False, "error": "Refusing to delete wedding master Dropbox path"}
    try:
        dbx.files_delete_v2(dest)
        return {"ok": True, "path": dest}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "path": dest}


def hydrate_corporate_pdf_if_needed() -> bool:
    """If local corporate PDF missing, try Dropbox. Returns True if local file exists after."""
    if corporate_pdf_exists(hydrate=False):
        return True
    result = fetch_corporate_pdf_from_dropbox()
    if result.get("ok"):
        log.info("Hydrated corporate PDF from Dropbox %s", result.get("path"))
        return corporate_pdf_exists(hydrate=False)
    return False


def corporate_pdf_exists(*, hydrate: bool = True) -> bool:
    p = corporate_pdf_path()
    try:
        if p.is_file() and p.stat().st_size > 100:
            return True
    except OSError:
        pass
    if hydrate:
        return hydrate_corporate_pdf_if_needed()
    return False


def get_corporate_pdf_url(request_base: str | None = None) -> str:
    """Public URL for corporate packages PDF only (never wedding master)."""
    env = (os.environ.get("SLIW_CORPORATE_PDF_URL") or "").strip()
    if env:
        if MASTER_PDF_PUBLIC_PATH in env or "master-packages.pdf" in env or "master_packages" in env:
            log.warning("SLIW_CORPORATE_PDF_URL points at wedding master PDF — ignoring")
        else:
            return env
    if not corporate_pdf_exists():
        try:
            data = json.loads(master_meta_path().read_text(encoding="utf-8"))
            url = (
                data.get("corporate_pdf_url")
                or data.get("corporate_dropbox_shared_url")
                or ""
            ).strip()
            if (
                url
                and url.startswith("http")
                and MASTER_PDF_PUBLIC_PATH not in url
                and "master-packages" not in url
                and "master_packages" not in url
            ):
                return url
        except Exception:
            pass
        return ""
    base = public_base_url(request_base)
    if base:
        return base + CORPORATE_PDF_PUBLIC_PATH
    return CORPORATE_PDF_PUBLIC_PATH


def save_corporate_pdf(
    content: bytes,
    *,
    original_name: str = CORPORATE_PDF_FILENAME,
    request_base: str | None = None,
) -> dict[str, Any]:
    """Save corporate packages PDF. Does not touch wedding master_packages.pdf."""
    if not content or len(content) < 100:
        raise ValueError("Empty or tiny file — expected a real PDF")
    if not content[:8].startswith(b"%PDF") and not original_name.lower().endswith(".pdf"):
        raise ValueError("File does not look like a PDF")

    path = corporate_pdf_path()
    if path.name == MASTER_PDF_FILENAME or path.resolve() == master_pdf_path().resolve():
        raise ValueError("Refusing to overwrite wedding master packages PDF")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if not path.is_file() or path.stat().st_size < 100:
        raise ValueError(f"Failed to write corporate PDF to {path}")

    dbx_result = push_corporate_pdf_to_dropbox(content)

    uploaded_at = datetime.utcnow().isoformat()
    old: dict[str, Any] = {}
    try:
        if master_meta_path().exists():
            old = json.loads(master_meta_path().read_text(encoding="utf-8"))
    except Exception:
        old = {}

    pdf_url = get_corporate_pdf_url(request_base) or CORPORATE_PDF_PUBLIC_PATH
    old.update(
        {
            "corporate_pdf_url": pdf_url,
            "corporate_pdf_preview_url": pdf_url,
            "corporate_pdf_uploaded": True,
            "corporate_pdf_bytes": path.stat().st_size,
            "corporate_pdf_public_path": CORPORATE_PDF_PUBLIC_PATH,
            "corporate_pdf_filename": original_name,
            "corporate_pdf_original_name": original_name,
            "corporate_pdf_uploaded_at": uploaded_at,
            "corporate_pdf_storage_path": str(path),
            "corporate_dropbox_path": dropbox_corporate_pdf_dest(),
            "corporate_dropbox_ok": bool(dbx_result.get("ok")),
            "corporate_dropbox_error": dbx_result.get("error"),
            "corporate_dropbox_shared_url": dbx_result.get("shared_url"),
            "updated_at": uploaded_at,
        }
    )
    master_meta_path().write_text(json.dumps(old, indent=2) + "\n", encoding="utf-8")
    return get_master_deck_meta(request_base=request_base)


def delete_corporate_pdf() -> dict[str, Any]:
    """Remove corporate PDF only. Wedding master PDF is untouched."""
    p = corporate_pdf_path()
    if p.exists() and p.name != MASTER_PDF_FILENAME:
        p.unlink()
    delete_corporate_pdf_from_dropbox()
    old: dict[str, Any] = {}
    try:
        if master_meta_path().exists():
            old = json.loads(master_meta_path().read_text(encoding="utf-8"))
    except Exception:
        old = {}
    for key in (
        "corporate_pdf_url",
        "corporate_pdf_preview_url",
        "corporate_pdf_uploaded",
        "corporate_pdf_bytes",
        "corporate_pdf_filename",
        "corporate_pdf_original_name",
        "corporate_pdf_uploaded_at",
        "corporate_pdf_storage_path",
        "corporate_dropbox_shared_url",
        "corporate_dropbox_ok",
        "corporate_dropbox_error",
    ):
        old.pop(key, None)
    old["corporate_pdf_uploaded"] = False
    old["corporate_pdf_bytes"] = 0
    old["updated_at"] = datetime.utcnow().isoformat()
    try:
        master_meta_path().write_text(json.dumps(old, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass
    return get_master_deck_meta()


def email_asset_links(
    request_base: str | None = None,
    *,
    book: str = "corporate",
) -> dict[str, str]:
    """Links for email bodies.

    Corporate outreach never receives the wedding master-packages.pdf.
    Wedding book may still use the master PDF.
    """
    out = {
        "corporate_page": get_corporate_page_url(),
        "packages_deck": get_master_deck_url(),
    }
    book_l = (book or "corporate").strip().lower()
    if book_l == "wedding":
        pdf = get_pdf_url(request_base)
        if pdf and master_pdf_exists():
            out["pdf"] = pdf
    else:
        pdf = get_corporate_pdf_url(request_base)
        if pdf and corporate_pdf_exists():
            if MASTER_PDF_PUBLIC_PATH not in pdf and "master-packages.pdf" not in pdf:
                out["pdf"] = pdf
    return out



# Compatibility for `from master_deck import MASTER_PDF_PATH`
class _PdfPathProxy:
    def __fspath__(self) -> str:
        return str(master_pdf_path())

    def __str__(self) -> str:
        return str(master_pdf_path())

    def exists(self) -> bool:
        return master_pdf_exists()

    def is_file(self) -> bool:
        return master_pdf_exists()

    def resolve(self) -> Path:
        return master_pdf_path().resolve()


MASTER_PDF_PATH = _PdfPathProxy()  # type: ignore
