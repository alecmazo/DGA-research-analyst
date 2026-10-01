"""Polite HTTP. SEC hosts share one token bucket. A 403 or 429 stops only this scan's SEC tier."""

from __future__ import annotations

import os
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import date
from urllib.parse import urlparse

SEC_HOSTS = {"www.sec.gov", "efts.sec.gov", "data.sec.gov"}


class HttpError(Exception):
    def __init__(self, status: int, url: str = ""):
        super().__init__(f"HTTP {status} for {url}")
        self.status = status
        self.url = url


class SecBlocked(HttpError):
    def __init__(self, url: str = ""):
        super().__init__(429, url)


@dataclass
class Cached:
    body: bytes
    etag: str
    last_modified: str
    expires_at: float | None

    @property
    def fresh(self) -> bool:
        return True


class ResponseCache:
    """SQLite response cache. expires_at None means keep the body."""

    def __init__(self, path: str | None):
        self.path = path or ""
        self._mem: dict[str, tuple[bytes, str, str, float | None]] = {}
        self._conn = None
        if self.path and self.path != ":memory:":
            folder = os.path.dirname(self.path)
            if folder:
                os.makedirs(folder, exist_ok=True)
        if self.path:
            self._conn = sqlite3.connect(self.path, check_same_thread=False)
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS http_cache (
                    url TEXT PRIMARY KEY,
                    body BLOB,
                    etag TEXT,
                    last_modified TEXT,
                    expires_at REAL
                )
                """
            )
            self._conn.commit()

    def get(self, url: str, now: float) -> Cached | None:
        row = self._read(url)
        if row is None:
            return None
        body, etag, modified, expires = row
        if expires is not None and now >= expires:
            return Cached(body, etag, modified, expires)
        return Cached(body, etag, modified, expires)

    def expired(self, url: str, now: float) -> Cached | None:
        row = self._read(url)
        if row is None:
            return None
        body, etag, modified, expires = row
        if expires is not None and now >= expires:
            return Cached(body, etag, modified, expires)
        return None

    def fresh(self, url: str, now: float) -> Cached | None:
        row = self._read(url)
        if row is None:
            return None
        body, etag, modified, expires = row
        if expires is not None and now >= expires:
            return None
        return Cached(body, etag, modified, expires)

    def put(self, url: str, body: bytes, etag: str, modified: str, expires_at: float | None) -> None:
        if self._conn is not None:
            self._conn.execute(
                """
                INSERT INTO http_cache (url, body, etag, last_modified, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    body=excluded.body,
                    etag=excluded.etag,
                    last_modified=excluded.last_modified,
                    expires_at=excluded.expires_at
                """,
                (url, body, etag or "", modified or "", expires_at),
            )
            self._conn.commit()
            return
        self._mem[url] = (body, etag or "", modified or "", expires_at)

    def _read(self, url: str):
        if self._conn is not None:
            cur = self._conn.execute(
                "SELECT body, etag, last_modified, expires_at FROM http_cache WHERE url=?",
                (url,),
            )
            return cur.fetchone()
        return self._mem.get(url)


def ttl_for(url: str, today: date | None = None) -> float | None:
    """Seconds, or None to keep the body. Search and RSS are 15 minutes."""
    host = urlparse(url).hostname or ""
    today = today or date.today()
    if host == "efts.sec.gov" or "rss" in url.lower() or "rssfeed" in url.lower():
        return 900
    if url.endswith("company_tickers.json") or "company_tickers.json" in url:
        return 86400
    if "/submissions/CIK" in url:
        return 3600
    if "/Archives/edgar/data/" in url:
        return None
    index = re.search(r"form\.(\d{8})\.idx", url)
    if index:
        stamp = index.group(1)
        filed = date(int(stamp[0:4]), int(stamp[4:6]), int(stamp[6:8]))
        if filed < today:
            return None
        return 900
    return 900


def _retry_after(headers: dict) -> float | None:
    raw = ""
    for key, value in (headers or {}).items():
        if key.lower() == "retry-after":
            raw = str(value).strip()
            break
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


class PoliteClient:
    def __init__(
        self,
        *,
        user_agent: str,
        sec_rps: float = 5,
        transport=None,
        cache: ResponseCache | None = None,
        clock=None,
        sleep=None,
        now=None,
        today=None,
    ):
        self.user_agent = user_agent or ""
        self.sec_rps = min(float(sec_rps or 5), 10.0)
        self.transport = transport or _requests_transport
        self.cache = cache or ResponseCache("")
        self.clock = clock or time.monotonic
        self.sleep = sleep or time.sleep
        self.now = now or time.time
        self.today = today or date.today
        self.sec_blocked = False
        self._next: dict[str, float] = {}
        self.calls: list[dict] = []

    def _limit(self, url: str) -> None:
        host = urlparse(url).hostname or ""
        if host in SEC_HOSTS:
            key, rps = "sec", self.sec_rps
        elif host == "www.ftc.gov":
            key, rps = host, 0.2
        else:
            key, rps = host or url, 1.0
        interval = 1.0 / rps if rps else 1.0
        now = float(self.clock())
        nxt = self._next.get(key)
        if nxt is not None and now < nxt:
            self.sleep(nxt - now)
            now = float(self.clock())
        self._next[key] = now + interval

    def _headers(self, url: str) -> dict:
        host = urlparse(url).hostname or ""
        if host in SEC_HOSTS:
            return {
                "User-Agent": self.user_agent,
                "Accept-Encoding": "gzip, deflate",
            }
        return {"User-Agent": "Mozilla/5.0"}

    def get(self, url: str, *, ttl: float | None = None) -> bytes:
        host = urlparse(url).hostname or ""
        if host in SEC_HOSTS and self.sec_blocked:
            raise SecBlocked(url)
        now = float(self.now())
        fresh = self.cache.fresh(url, now)
        if fresh is not None:
            return fresh.body
        stale = self.cache.expired(url, now)
        if ttl is None:
            today = self.today() if callable(self.today) else self.today
            ttl = ttl_for(url, today if isinstance(today, date) else date.today())
        last_status = 0
        for attempt in range(3):
            self._limit(url)
            headers = self._headers(url)
            if stale is not None and stale.etag:
                headers["If-None-Match"] = stale.etag
            if stale is not None and stale.last_modified:
                headers["If-Modified-Since"] = stale.last_modified
            self.calls.append({"url": url, "headers": dict(headers)})
            status, resp_headers, body = self.transport(url, headers)
            last_status = status
            resp_headers = resp_headers or {}
            if status == 304 and stale is not None:
                expires = None if ttl is None else float(self.now()) + float(ttl)
                self.cache.put(url, stale.body, stale.etag, stale.last_modified, expires)
                return stale.body
            if status == 200:
                etag = resp_headers.get("ETag") or resp_headers.get("etag") or ""
                modified = resp_headers.get("Last-Modified") or resp_headers.get("last-modified") or ""
                expires = None if ttl is None else float(self.now()) + float(ttl)
                self.cache.put(url, body or b"", etag, modified, expires)
                return body or b""
            if status == 403 and host in SEC_HOSTS:
                self.sec_blocked = True
                raise HttpError(status, url)
            if status == 429 or status >= 500:
                if attempt == 2:
                    if status == 429 and host in SEC_HOSTS:
                        self.sec_blocked = True
                    raise HttpError(status, url)
                wait = _retry_after(resp_headers)
                self.sleep(1.0 if wait is None else wait)
                continue
            raise HttpError(status, url)
        raise HttpError(last_status or 599, url)


def _requests_transport(url: str, headers: dict):
    import requests
    response = requests.get(url, headers=headers, timeout=30)
    return response.status_code, dict(response.headers), response.content
