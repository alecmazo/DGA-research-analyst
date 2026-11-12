import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def _desk():
    spec = importlib.util.spec_from_file_location(
        "ollama_desk", ROOT / "scripts" / "ollama_desk.py",
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


def test_red_pill_starts_when_nothing_is_running_and_restarts_a_glitch():
    desk = _desk()
    assert desk.decide(True, True) == "up"
    assert desk.decide(False, False) == "start"
    assert desk.decide(False, True) == "restart"
    assert desk.PORT == 8766
    assert desk.HOST == "127.0.0.1"
    assert desk.captions_for("/captions?v=short")["ok"] is False
    assert desk.PROXY_PATHS == frozenset({"/api/tags", "/api/chat"})


class _Quiet(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return


def test_portal_can_read_ollama_through_the_helper():
    desk = _desk()

    class Fake(_Quiet):
        def do_GET(self):  # noqa: N802
            body = b'{"models":[{"name":"gpt-oss-20b-finance"}]}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):  # noqa: N802
            n = int(self.headers.get("Content-Length") or 0)
            self.rfile.read(n)
            body = b'{"message":{"content":"Hi"}}\n{"done":true}\n'
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    helper = ThreadingHTTPServer(("127.0.0.1", 0), desk.Handler)
    threads = [
        threading.Thread(target=upstream.serve_forever, daemon=True),
        threading.Thread(target=helper.serve_forever, daemon=True),
    ]
    desk.OLLAMA_ROOT = f"http://127.0.0.1:{upstream.server_address[1]}"
    for t in threads:
        t.start()
    try:
        origin = {"Origin": "https://portfolio.dgacapital.com"}
        req = Request(
            f"http://127.0.0.1:{helper.server_address[1]}/api/tags",
            headers=origin,
        )
        with urlopen(req, timeout=3) as res:
            assert b"gpt-oss-20b-finance" in res.read()
            assert res.headers["Access-Control-Allow-Private-Network"] == "true"
            assert res.headers["Access-Control-Allow-Origin"] == origin["Origin"]
        chat = Request(
            f"http://127.0.0.1:{helper.server_address[1]}/api/chat",
            data=b'{"model":"gpt-oss-20b-finance"}',
            headers={**origin, "Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(chat, timeout=3) as res:
            assert b'"content":"Hi"' in res.read()
        blocked = Request(
            f"http://127.0.0.1:{helper.server_address[1]}/api/tags",
            headers={"Origin": "https://evil.example"},
        )
        try:
            urlopen(blocked, timeout=3)
            raise AssertionError("foreign origin was proxied")
        except Exception as exc:
            assert getattr(exc, "code", None) == 403
        other = Request(f"http://127.0.0.1:{helper.server_address[1]}/api/delete", method="POST")
        try:
            urlopen(other, timeout=3)
            raise AssertionError("delete was proxied")
        except Exception as exc:
            body = exc.read()
            assert getattr(exc, "code", None) == 404
            assert json.loads(body)["message"] == "Not found"
    finally:
        upstream.shutdown()
        helper.shutdown()
