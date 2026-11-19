#!/usr/bin/env python3
"""Start or restart Ollama on this Mac. Listens on 127.0.0.1 only.

The live site cannot launch a Mac app. The Local page calls this helper when
the Ollama pill is red. A healthy daemon is left alone. A process that is up
but not answering is quit and opened again.
"""

from __future__ import annotations

import errno
import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if not (ROOT / "podcast_intel").is_dir():
    extra = os.environ.get("DGA_REPO", "")
    if extra:
        ROOT = Path(extra)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

HOST = "127.0.0.1"
PORT = 8766
# The portal is a public https page. Chrome will not let it read Ollama's own
# port. These two routes are forwarded, with the private-network header Chrome
# requires. Nothing else on Ollama is exposed.
OLLAMA_ROOT = "http://127.0.0.1:11434"
PROXY_PATHS = frozenset({"/api/tags", "/api/chat"})
ORIGINS = "https://portfolio.dgacapital.com,http://localhost:5173,http://127.0.0.1:5173"
ALLOWED = {
    "https://portfolio.dgacapital.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


def upstream(path: str) -> str:
    return OLLAMA_ROOT.rstrip("/") + path


def serve_ok() -> bool:
    try:
        with urlopen(upstream("/api/tags"), timeout=2) as res:
            return getattr(res, "status", 200) == 200
    except (URLError, TimeoutError, OSError):
        return False


def process_running() -> bool:
    try:
        out = subprocess.run(
            ["pgrep", "-fl", "ollama"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    for line in (out.stdout or "").splitlines():
        low = line.lower()
        if "ollama_desk" in low or "pgrep" in low:
            continue
        if "ollama" in low:
            return True
    return False


def decide(answering: bool, running: bool) -> str:
    if answering:
        return "up"
    if running:
        return "restart"
    return "start"


def _set_origins() -> None:
    subprocess.run(
        ["launchctl", "setenv", "OLLAMA_ORIGINS", ORIGINS],
        check=False,
        timeout=5,
    )


def _quit() -> None:
    subprocess.run(["killall", "Ollama"], check=False, timeout=5)
    subprocess.run(["pkill", "-f", "ollama serve"], check=False, timeout=5)
    time.sleep(0.6)


def _open() -> None:
    _set_origins()
    subprocess.run(["open", "-a", "Ollama"], check=False, timeout=10)


def _wait_ready(seconds: float = 25) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if serve_ok():
            return True
        time.sleep(0.5)
    return False


def captions_for(path: str) -> dict:
    """Public YouTube captions from this Mac. The server's IP is blocked."""
    query = parse_qs(urlparse(path).query)
    video_id = (query.get("v") or [""])[0].strip()
    if len(video_id) != 11:
        return {"ok": False, "message": "Missing video."}
    try:
        from podcast_intel.youtube_caps import caption_text
        text = caption_text(video_id)
    except Exception:
        return {"ok": False, "message": "Captions could not be read on this Mac."}
    if len(text) < 800:
        return {"ok": False, "message": "No English captions on this video."}
    return {"ok": True, "text": text, "chars": len(text)}


def ensure() -> dict:
    action = decide(serve_ok(), process_running())
    if action == "up":
        return {"ok": True, "action": "up", "message": "Ollama is already running"}
    if action == "restart":
        _quit()
    _open()
    ok = _wait_ready()
    if ok:
        verb = "Restarted" if action == "restart" else "Started"
        return {"ok": True, "action": action, "message": f"{verb} Ollama"}
    return {
        "ok": False,
        "action": action,
        "message": "Ollama did not answer on this Mac. Open the Ollama app once by hand.",
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        origin = self.headers.get("Origin") or ""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if origin in ALLOWED:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def _preflight(self) -> None:
        origin = self.headers.get("Origin") or ""
        self.send_response(204)
        if origin in ALLOWED:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_OPTIONS(self):  # noqa: N802
        self._preflight()

    def _cors(self) -> None:
        origin = self.headers.get("Origin") or ""
        if origin in ALLOWED:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _proxy(self, method: str, body: bytes) -> None:
        path = self.path.split("?", 1)[0]
        origin = self.headers.get("Origin") or ""
        if origin and origin not in ALLOWED:
            self._send(403, {"ok": False, "message": "Origin not allowed"})
            return
        if path not in PROXY_PATHS:
            self._send(404, {"ok": False, "message": "Not found"})
            return
        req = Request(upstream(self.path), data=body or None, method=method)
        ctype = self.headers.get("Content-Type")
        if ctype:
            req.add_header("Content-Type", ctype)
        timeout = 20 if path == "/api/tags" else 600
        try:
            resp = urlopen(req, timeout=timeout)
        except HTTPError as exc:
            payload = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", exc.headers.get("Content-Type") or "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self._cors()
            self.end_headers()
            self.wfile.write(payload)
            return
        except (URLError, TimeoutError, OSError):
            self._send(502, {"ok": False, "message": "Ollama did not answer on this Mac."})
            return
        self.send_response(getattr(resp, "status", 200))
        self.send_header(
            "Content-Type",
            resp.headers.get("Content-Type") or "application/json",
        )
        self.send_header("Transfer-Encoding", "chunked")
        self._cors()
        self.end_headers()
        try:
            while True:
                chunk = resp.read(16384)
                if not chunk:
                    break
                self.wfile.write(f"{len(chunk):X}\r\n".encode("ascii"))
                self.wfile.write(chunk)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_GET(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in PROXY_PATHS:
            self._proxy("GET", b"")
            return
        if path == "/health":
            self._send(200, {"ok": True, "ollama": serve_ok()})
            return
        if path == "/captions":
            self._send(200, captions_for(self.path))
            return
        self._send(404, {"ok": False, "message": "Not found"})

    def do_POST(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length") or 0)
        cap = 20_000_000 if path in PROXY_PATHS else 4096
        body = self.rfile.read(min(length, cap)) if length else b""
        if path in PROXY_PATHS:
            self._proxy("POST", body)
            return
        if path != "/ensure":
            self._send(404, {"ok": False, "message": "Not found"})
            return
        self._send(200, ensure())

    def log_message(self, fmt: str, *args) -> None:
        return


def already_serving() -> bool:
    try:
        with urlopen(f"http://{HOST}:{PORT}/health", timeout=2) as res:
            return getattr(res, "status", 200) == 200
    except (URLError, TimeoutError, OSError):
        return False


def helper_proxies() -> bool:
    try:
        with urlopen(f"http://{HOST}:{PORT}/api/tags", timeout=3) as res:
            return getattr(res, "status", 200) == 200
    except (URLError, TimeoutError, OSError):
        return False


def should_replace(ollama_up: bool, proxies: bool) -> bool:
    """A stuck or old helper holds the port while the pill stays red."""
    return not (ollama_up and proxies)


def bind_message(exc: BaseException, serving: bool) -> str | None:
    if not isinstance(exc, OSError) or exc.errno != errno.EADDRINUSE:
        return None
    if serving:
        return f"Helper already running on {HOST}:{PORT}. Leave that window open."
    return f"Port {PORT} is already in use."


def ask_existing() -> dict | None:
    try:
        req = Request(
            f"http://{HOST}:{PORT}/ensure",
            data=b"{}",
            method="POST",
        )
        req.add_header("Content-Type", "application/json")
        with urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode() or "{}")
    except (URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None


def lsof_commands() -> list[list[str]]:
    flags = [
        ["-nP", "-t", f"-iTCP:{PORT}", "-sTCP:LISTEN"],
        ["-nP", "-t", f"-i:{PORT}"],
    ]
    return [[program, *flag] for program in ("/usr/sbin/lsof", "lsof") for flag in flags]


def pids_from_lsof(text: str) -> list[int]:
    pids: list[int] = []
    for part in text.replace(",", " ").split():
        if not part.isdigit():
            continue
        pid = int(part)
        if pid == os.getpid() or pid in pids:
            continue
        pids.append(pid)
    return pids


def listener_pids() -> list[int]:
    found: list[int] = []
    for cmd in lsof_commands():
        try:
            out = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        for pid in pids_from_lsof(out.stdout or ""):
            if pid not in found:
                found.append(pid)
        if found:
            return found
    return found


def free_port() -> list[int]:
    stopped: list[int] = []
    for sig in (signal.SIGTERM, signal.SIGKILL):
        pids = listener_pids()
        if not pids:
            return stopped
        for pid in pids:
            try:
                os.kill(pid, sig)
            except OSError:
                continue
            if pid not in stopped:
                stopped.append(pid)
        time.sleep(0.5)
    return stopped


def occupy() -> ThreadingHTTPServer | None:
    ThreadingHTTPServer.allow_reuse_address = True
    try:
        return ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            raise
        if not should_replace(serve_ok(), helper_proxies()):
            return None
        asked = ask_existing()
        if asked and asked.get("ok") and serve_ok() and helper_proxies():
            return None
        print(f"Replacing the stuck helper on port {PORT}.", flush=True)
        stopped = free_port()
        if stopped:
            print("Stopped process " + " ".join(str(pid) for pid in stopped) + ".", flush=True)
        deadline = time.time() + 3
        while True:
            try:
                return ThreadingHTTPServer((HOST, PORT), Handler)
            except OSError as again:
                if again.errno != errno.EADDRINUSE or time.time() >= deadline:
                    print(f"Port {PORT} is still in use.", flush=True)
                    raise SystemExit(1)
                free_port()
                time.sleep(0.3)


def main() -> None:
    server = occupy()
    if server is None:
        print("Ollama is running. Click the red pill.", flush=True)
        return
    print(f"Helper listening on {HOST}:{PORT}.", flush=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    result = ensure()
    print(result.get("message") or "Ollama did not start.", flush=True)
    threading.Event().wait()


if __name__ == "__main__":
    main()
