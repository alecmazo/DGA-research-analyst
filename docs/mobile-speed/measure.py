#!/usr/bin/env python3
"""Time the mobile app's live API path. Same steps every audit.

Prints a block meant to be pasted into docs/mobile-speed/RUNS.md.
Uses the demo login. Demo sign-in is slower than a real GP sign-in.
"""
from __future__ import annotations

import json
import subprocess
import time
import urllib.parse

BASE = "https://portfolio.dgacapital.com"
EMAIL = "demo@dgacapital.com"
PASSWORD = "demo123"


def curl(method: str, path: str, token: str = "", body: dict | None = None, timeout: int = 40) -> dict:
    cmd = [
        "curl", "-sS", "-m", str(timeout),
        "-o", "/tmp/dga_mobile_body",
        "-w", "%{http_code} %{time_total} %{size_download}",
        "-X", method,
        "-H", "Accept: application/json",
    ]
    if token:
        cmd += ["-H", f"x-auth-v2-token: {token}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    cmd.append(BASE + path)
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    wall_ms = int((time.perf_counter() - t0) * 1000)
    parts = (proc.stdout or "").split()
    code = int(parts[0]) if parts else 0
    curl_s = float(parts[1]) if len(parts) > 1 else 0
    size = int(float(parts[2])) if len(parts) > 2 else 0
    raw = ""
    try:
        raw = open("/tmp/dga_mobile_body", encoding="utf-8").read()
    except OSError:
        raw = ""
    data = None
    if raw[:1] in "{[":
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
    err = (proc.stderr or "").strip()
    return {
        "code": code,
        "ms": int(curl_s * 1000) or wall_ms,
        "bytes": size,
        "json": data,
        "err": err,
    }


def server_ms(data) -> str:
    if not isinstance(data, dict):
        return "—"
    for key in ("elapsed_ms", "timing_ms"):
        if data.get(key) is not None:
            return str(data.get(key))
    wl = data.get("watchlist")
    if isinstance(wl, dict) and wl.get("timing_ms") is not None:
        return str(wl.get("timing_ms"))
    return "—"


def counts(path: str, data) -> str:
    if not isinstance(data, dict):
        if isinstance(data, list):
            return f"rows={len(data)}"
        return ""
    if path.startswith("/api/mobile/home"):
        wl = data.get("watchlist") if isinstance(data.get("watchlist"), dict) else {}
        tickers = wl.get("tickers") or []
        quotes = wl.get("quotes") or {}
        priced = sum(1 for q in quotes.values() if isinstance(q, dict) and q.get("price") is not None)
        return f"indices={len(data.get('indices') or [])} tickers={len(tickers)} priced={priced}"
    if path.startswith("/api/watchlist"):
        tickers = data.get("tickers") or []
        quotes = data.get("quotes") or {}
        priced = sum(1 for q in quotes.values() if isinstance(q, dict) and q.get("price") is not None)
        return f"tickers={len(tickers)} priced={priced}"
    if path.startswith("/api/reports"):
        return f"rows={len(data) if isinstance(data, list) else 'obj'}"
    if path.startswith("/api/report/"):
        md = data.get("report_md") or ""
        return f"md_chars={len(md)} incomplete={bool(data.get('incomplete'))}"
    return ""


def line(step: str, path: str, result: dict) -> str:
    flag = "OK" if result["code"] and result["code"] < 400 else "FAIL"
    extra = counts(path, result["json"])
    bits = [step, flag, f"{result['ms']} ms", f"server {server_ms(result['json'])}", f"{result['bytes']} B"]
    if extra:
        bits.append(extra)
    if result["err"] and not result["code"]:
        bits.append(result["err"][:80])
    return " | ".join(bits)


def first_saved_ticker(data) -> str:
    """The phone opens a row from the list it just loaded, not a hardcoded name."""
    if not isinstance(data, list):
        return ""
    for row in data:
        if isinstance(row, dict) and row.get("ticker"):
            return str(row["ticker"]).upper()
    return ""


def main() -> None:
    print(f"build | {curl('GET', '/api/build')['json']}")
    print(line("1 health", "/health", curl("GET", "/health")))
    login = curl("POST", "/api/auth/v2/login", body={"email": EMAIL, "password": PASSWORD})
    token = ""
    if isinstance(login["json"], dict):
        token = login["json"].get("token") or ""
    print(line("2 login demo", "/api/auth/v2/login", login) + (" | token" if token else " | no token"))
    if not token:
        return
    report_ticker = ""
    steps = [
        ("3 home first", "/api/mobile/home"),
        ("3 home second", "/api/mobile/home"),
        ("4 reports first", "/api/reports"),
        ("4 reports second", "/api/reports"),
        ("5 watchlist first", "/api/watchlist"),
        ("5 watchlist second", "/api/watchlist"),
    ]
    for name, path in steps:
        result = curl("GET", path, token=token)
        print(line(name, path, result))
        if name == "4 reports first":
            report_ticker = first_saved_ticker(result["json"])
    if not report_ticker:
        print("6 report open | FAIL | 0 ms | server — | 0 B | no saved ticker")
        return
    path = f"/api/report/{urllib.parse.quote(report_ticker)}?provider=grok&as_stored=1"
    print(line(f"6 report open {report_ticker}", path, curl("GET", path, token=token)))


if __name__ == "__main__":
    main()
