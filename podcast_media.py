"""Where episode MP3s live.

`put` / `url` / `size` are the whole interface. `PODCAST_MEDIA_STORE`
selects `local` (disk + Dropbox, today's behavior), `r2`, or `s3`.
Enclosure URLs use `PODCAST_MEDIA_BASE_URL` when that env var is set.
"""
from __future__ import annotations

import os
from pathlib import Path


class MediaStore:
    def put(self, key: str, data: bytes) -> None:
        raise NotImplementedError

    def url(self, key: str) -> str:
        raise NotImplementedError

    def size(self, key: str) -> int:
        raise NotImplementedError

    def get(self, key: str) -> bytes | None:
        path = self.local_path(key)
        if path is not None and path.is_file():
            return path.read_bytes()
        return None

    def local_path(self, key: str) -> Path | None:
        return None

    def dropbox_path(self, key: str) -> str | None:
        return None


def _safe_key(key: str) -> str:
    key = (key or "").replace("\\", "/").lstrip("/")
    parts = [p for p in key.split("/") if p not in ("", ".", "..")]
    if not parts or any(p in (".", "..") for p in key.split("/")):
        raise ValueError(f"invalid media key {key!r}")
    return "/".join(parts)


def media_base_url() -> str:
    return (os.environ.get("PODCAST_MEDIA_BASE_URL") or "").strip().rstrip("/")


class LocalDropboxStore(MediaStore):
    """Write the MP3 on disk and upload the same bytes to Dropbox."""

    def __init__(self, root: Path | None = None):
        if root is not None:
            self.root = Path(root)
        else:
            override = (os.environ.get("PODCAST_MEDIA_DIR") or "").strip()
            if override:
                self.root = Path(override)
            else:
                self.root = _default_media_root()
        self._dropbox: dict[str, str] = {}

    def put(self, key: str, data: bytes) -> None:
        key = _safe_key(key)
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        uploaded = _upload_dropbox(key, data)
        if uploaded:
            self._dropbox[key] = uploaded

    def url(self, key: str) -> str:
        key = _safe_key(key)
        base = media_base_url()
        if not base:
            return ""
        return f"{base}/{key}"

    def size(self, key: str) -> int:
        path = self.local_path(key)
        if path is not None and path.is_file():
            return path.stat().st_size
        return 0

    def local_path(self, key: str) -> Path | None:
        return self.root / _safe_key(key)

    def dropbox_path(self, key: str) -> str | None:
        return self._dropbox.get(_safe_key(key))


class S3CompatibleStore(MediaStore):
    """boto3 store for R2 or S3. The public URL is still PODCAST_MEDIA_BASE_URL."""

    def __init__(self, kind: str):
        self.kind = kind
        self.bucket = (
            os.environ.get("PODCAST_S3_BUCKET")
            or os.environ.get("PODCAST_R2_BUCKET")
            or ""
        ).strip()
        self.endpoint = (
            os.environ.get("PODCAST_S3_ENDPOINT")
            or os.environ.get("PODCAST_R2_ENDPOINT")
            or ""
        ).strip()
        self.region = (
            os.environ.get("PODCAST_S3_REGION")
            or ("auto" if kind == "r2" else "us-east-1")
        ).strip()
        self.access = (
            os.environ.get("PODCAST_S3_ACCESS_KEY_ID")
            or os.environ.get("AWS_ACCESS_KEY_ID")
            or ""
        ).strip()
        self.secret = (
            os.environ.get("PODCAST_S3_SECRET_ACCESS_KEY")
            or os.environ.get("AWS_SECRET_ACCESS_KEY")
            or ""
        ).strip()

    def _client(self):
        try:
            import boto3
        except ImportError as e:
            raise RuntimeError(
                "boto3 is not installed. Install it before "
                "PODCAST_MEDIA_STORE=r2 or s3."
            ) from e
        kwargs = {
            "region_name": self.region or None,
            "aws_access_key_id": self.access or None,
            "aws_secret_access_key": self.secret or None,
        }
        if self.endpoint:
            kwargs["endpoint_url"] = self.endpoint
        return boto3.client("s3", **kwargs)

    def put(self, key: str, data: bytes) -> None:
        if not self.bucket:
            raise RuntimeError("PODCAST_S3_BUCKET is not set")
        key = _safe_key(key)
        self._client().put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType="audio/mpeg",
        )

    def url(self, key: str) -> str:
        key = _safe_key(key)
        base = media_base_url()
        if not base:
            return ""
        return f"{base}/{key}"

    def size(self, key: str) -> int:
        if not self.bucket:
            return 0
        key = _safe_key(key)
        head = self._client().head_object(Bucket=self.bucket, Key=key)
        return int(head.get("ContentLength") or 0)

    def get(self, key: str) -> bytes | None:
        if not self.bucket:
            return None
        key = _safe_key(key)
        obj = self._client().get_object(Bucket=self.bucket, Key=key)
        body = obj.get("Body")
        return body.read() if body is not None else None

    def local_path(self, key: str) -> Path | None:
        return None


def _default_media_root() -> Path:
    try:
        import DGA_analyst as analyst
        return Path(analyst.STOCKS_FOLDER) / "podcasts" / "media"
    except Exception:
        return Path(__file__).resolve().parent / "stocks" / "podcasts" / "media"


def _upload_dropbox(key: str, data: bytes) -> str | None:
    try:
        import DGA_analyst as analyst
        import dropbox as dbx_mod
    except Exception as e:
        print(f"⚠️ [podcast-media] dropbox skipped: {e!s:.160}", flush=True)
        return None
    try:
        client = analyst._dropbox_client()
        if client is None:
            return None
        base = analyst._dropbox_folder()
        sub = f"{base}/podcast/episodes" if base else "/podcast/episodes"
        dest = f"{sub}/{key}"
        client.files_upload(
            data,
            dest,
            mode=dbx_mod.files.WriteMode.overwrite,
            mute=True,
        )
        print(f"✅ [podcast-media] uploaded {dest}", flush=True)
        return dest
    except Exception as e:
        print(f"⚠️ [podcast-media] dropbox upload failed: {e!s:.200}", flush=True)
        return None


def get_media_store() -> MediaStore:
    kind = (os.environ.get("PODCAST_MEDIA_STORE") or "local").strip().lower()
    if kind in ("", "local", "dropbox"):
        return LocalDropboxStore()
    if kind in ("r2", "s3"):
        return S3CompatibleStore(kind)
    raise ValueError(
        f"Unknown PODCAST_MEDIA_STORE {kind!r}. Use local, r2, or s3."
    )
