#!/usr/bin/env python3
"""Start or restart Ollama on this Mac. Listens on 127.0.0.1 only.

The live site cannot launch a Mac app. The Local page calls this helper when
the Ollama pill is red. A healthy daemon is left alone. A process that is up
but not answering is quit and opened again.
"""

from __future__ import annotations

import json
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.request import urlopen

HOST = "127.0.0.1"
PORT = 8766
OLLAMA = "http://127.0.0.1:11434/api/tags"
ORIGINS = "https://portfolio.dgacapital.com,http://localhost:5173,http://127.0.0.1:5173"
ALLOWED = {
    "https://portfolio.dgacapital.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


def serve_ok() -> bool:
    try:
        with urlopen(OLLAMA, timeout=2) as res:
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

    def do_GET(self):  # noqa: N802
        if self.path.split("?", 1)[0] != "/health":
            self._send(404, {"ok": False, "message": "Not found"})
            return
        self._send(200, {"ok": True, "ollama": serve_ok()})

    def do_POST(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(min(length, 4096))
        if path != "/ensure":
            self._send(404, {"ok": False, "message": "Not found"})
            return
        self._send(200, ensure())

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
