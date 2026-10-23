"""Client letter: one account, one audience, written when he asks.

Save stores the letter. Send is a separate action and is the only path
that emails. A local model is prepared here and written in the browser.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

GAMMA_GENERATIONS = "https://public-api.gamma.app/v1.0/generations"

MAIL_OFF = (
    "Mailing is not connected. The letter is saved. Copy it or download it."
)
MAIL_ON = "Send emails this letter to the investors on the account."
GAMMA_OFF = (
    "Presentation path is waiting on the Gamma key this server uses for "
    "research decks. The letter stands on its own."
)
GAMMA_ON = "Presentation path. This turns the saved letter into a Gamma deck."

AUDIENCES: dict[str, dict[str, str]] = {
    "retiree": {
        "label": "Retiree",
        "blurb": "Someone living on this account.",
        "voice": (
            "Write to someone living on this account. Short sentences. "
            "Talk about income, the size of the moves, and what stayed steady. "
            "Skip jargon. A market move matters when it changes what they hold."
        ),
    },
    "school": {
        "label": "School",
        "blurb": "A school that depends on this account.",
        "voice": (
            "Write to a school that depends on this account. Talk about the "
            "spending the book can support and the long horizon. A market move "
            "matters when it touches a holding the school owns."
        ),
    },
    "principal": {
        "label": "Family principal",
        "blurb": "The family principal who owns this capital.",
        "voice": (
            "Write to the family principal who owns this capital. Be direct. "
            "Say what the book did and what you are watching in the names they hold."
        ),
    },
    "foundation": {
        "label": "Foundation",
        "blurb": "A foundation board.",
        "voice": (
            "Write to a foundation board. Talk about staying power and what the "
            "book can keep funding. Connect the market only through holdings in "
            "this account."
        ),
    },
    "trustee": {
        "label": "Trustee",
        "blurb": "A trustee of this account.",
        "voice": (
            "Write to a trustee. Use plain fiduciary language: prudence, the "
            "purpose of the account, and why each large holding is there. "
            "If a holding has no thesis, say so."
        ),
    },
}

_TICKER_LINE = re.compile(r"(?m)^\s+([A-Z][A-Z0-9.]{0,5})\s{2,}")


def audience_rows() -> list[dict]:
    return [
        {"id": key, "label": row["label"], "blurb": row["blurb"]}
        for key, row in AUDIENCES.items()
    ]


def mail_connected() -> bool:
    if os.environ.get("RESEND_API_KEY", "").strip():
        return True
    user = os.environ.get("GMAIL_USER", "").strip()
    pwd = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    return bool(user and pwd)


def gamma_connected() -> bool:
    return bool(os.environ.get("GAMMA_API_KEY", "").strip())


def activity_tickers(text: str) -> list[str]:
    out: list[str] = []
    for match in _TICKER_LINE.finditer(text or ""):
        tk = match.group(1)
        if tk not in out:
            out.append(tk)
    return out


def cached_market_line(indices: list | None) -> str:
    """One line from figures already on the desk. Empty when the cache is cold."""
    bits: list[str] = []
    for row in indices or []:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or "").strip()
        price = row.get("price")
        if not label or price is None:
            continue
        try:
            px = float(price)
        except (TypeError, ValueError):
            continue
        extra = ""
        try:
            if row.get("pct") is not None:
                extra = f", {float(row['pct']):+.1f}% on the day"
        except (TypeError, ValueError):
            extra = ""
        bits.append(f"{label} at {px:,.0f}{extra}")
        if len(bits) >= 4:
            break
    return "; ".join(bits)


def letter_prompt(audience: str, book: dict) -> tuple[str, str]:
    """System and user text. The audience changes the voice. Holdings stay his."""
    profile = AUDIENCES[audience]
    name = str(book.get("name") or "this account").strip()
    holdings = list(book.get("holdings") or [])
    lines = [
        f"Account: {name}.",
        f"Audience: {profile['label']}.",
        "Holdings in this account:",
    ]
    if not holdings:
        lines.append("- No holdings were loaded. Say so. Do not invent a position.")
    for holding in holdings:
        tk = str(holding.get("ticker") or "").upper().strip()
        if not tk:
            continue
        try:
            weight = float(holding.get("weight_pct") or 0)
        except (TypeError, ValueError):
            weight = 0.0
        share = f"{weight:.1f}% of the account" if weight else "a holding in this account"
        thesis = str(holding.get("thesis") or "").strip()
        if thesis:
            lines.append(f"- {tk}, {share}. Thesis on file: {thesis}")
        else:
            lines.append(
                f"- {tk}, {share}. No thesis is saved for {tk}. "
                "Say so in plain language. Do not invent one."
            )
    market = str(book.get("market") or "").strip()
    lines.append("")
    if market:
        lines.append("Market figures already on the desk. Use these figures:")
        lines.append(market)
        lines.append(
            "Connect a figure to this letter only when it touches a holding above."
        )
    else:
        lines.append(
            "No separate market tape was loaded. Use this account's own results "
            "as the market story. Do not invent a headline or an index level."
        )
    lines.append("")
    lines.append("What this account did:")
    trades = str(book.get("trades") or "").strip()
    if trades:
        lines.append(trades)
        lines.append("Do not invent a trade or a number that is not written above.")
    else:
        lines.append("No trade record was loaded. Do not invent trades.")
    lines.append("")
    lines.append(
        "Write the letter in markdown. Open with what is happening, then how it "
        "shows up in this account. Short enough to read in a few minutes. "
        "Use the account name above. Do not invent a client name."
    )
    system = (
        "You write a client letter for DGA Capital. "
        + profile["voice"]
        + " Use the account name you are given. Do not invent a client name, "
        "a family name, or a holding. If a holding has no thesis, say so in "
        "plain language. This is a letter for that reader."
    )
    return system, "\n".join(lines)


def load_book(
    fund_id: str,
    year: int,
    *,
    positions_fn,
    activity_fn,
    name_fn,
    theses_fn,
    market_fn,
) -> dict:
    fid = str(fund_id or "").strip()
    if not fid:
        return {"ok": False, "error": "Choose an account."}
    name = (name_fn(fid) if name_fn else None) or fid
    positions = positions_fn(fid) if positions_fn else []
    trades = activity_fn([fid], year) if activity_fn else ""
    holdings: list[dict] = []
    seen: set[str] = set()
    for pos in positions or []:
        tk = str((pos or {}).get("ticker") or "").upper().strip()
        if not tk or tk in seen:
            continue
        seen.add(tk)
        holdings.append({
            "ticker": tk,
            "weight_pct": (pos or {}).get("weight_pct") or 0,
        })
    if not holdings:
        for tk in activity_tickers(trades or ""):
            if tk in seen:
                continue
            seen.add(tk)
            holdings.append({"ticker": tk, "weight_pct": 0})
    if not holdings:
        return {"ok": False, "error": f"{name} has no live holdings to write from."}
    theses = theses_fn([h["ticker"] for h in holdings]) if theses_fn else {}
    theses = theses or {}
    for holding in holdings:
        holding["thesis"] = str(theses.get(holding["ticker"]) or "").strip()
    market = ""
    try:
        market = market_fn() if market_fn else ""
    except Exception:
        market = ""
    return {
        "ok": True,
        "fund_id": fid,
        "name": name,
        "holdings": holdings,
        "trades": trades or "",
        "market": market or "",
    }


class MemoryStore:
    """In-memory letters for tests. Save never marks a letter sent."""

    def __init__(self):
        self.rows: dict[str, dict] = {}

    def save(self, row: dict) -> dict:
        prev = dict(self.rows.get(row["id"]) or {})
        stored = {**prev, **row}
        stored["sent_at"] = prev.get("sent_at")
        self.rows[row["id"]] = stored
        return stored

    def get(self, letter_id: str) -> dict | None:
        row = self.rows.get(letter_id)
        return dict(row) if row else None

    def mark_sent(self, letter_id: str) -> None:
        row = self.rows.get(letter_id)
        if not row:
            return
        row["sent_at"] = datetime.now(timezone.utc).isoformat()
        row["status"] = "sent"

    def save_gamma(self, letter_id: str, generation_id: str, url: str = "") -> None:
        row = self.rows.get(letter_id)
        if not row:
            return
        row["gamma_generation_id"] = generation_id
        if url:
            row["gamma_url"] = url

    def list(self) -> list[dict]:
        return [dict(row) for row in self.rows.values()]


class PgStore:
    def __init__(self, connect):
        self._connect = connect
        self._ready = False

    def _ensure(self, conn) -> None:
        if self._ready:
            return
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS client_letters (
                    id TEXT PRIMARY KEY,
                    fund_id TEXT,
                    fund_name TEXT,
                    audience TEXT,
                    model TEXT,
                    title TEXT,
                    body_md TEXT,
                    status TEXT,
                    sent_at TIMESTAMPTZ,
                    gamma_generation_id TEXT,
                    gamma_url TEXT,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
                """
            )
        conn.commit()
        self._ready = True

    def save(self, row: dict) -> dict:
        with self._connect() as conn:
            self._ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO client_letters
                        (id, fund_id, fund_name, audience, model, title,
                         body_md, status, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,'draft', now())
                    ON CONFLICT (id) DO UPDATE SET
                        fund_id = EXCLUDED.fund_id,
                        fund_name = EXCLUDED.fund_name,
                        audience = EXCLUDED.audience,
                        model = EXCLUDED.model,
                        title = EXCLUDED.title,
                        body_md = EXCLUDED.body_md,
                        status = 'draft',
                        updated_at = now()
                    """,
                    (
                        row["id"], row.get("fund_id"), row.get("fund_name"),
                        row.get("audience"), row.get("model"), row.get("title"),
                        row.get("body") or "",
                    ),
                )
            conn.commit()
        return row

    def get(self, letter_id: str) -> dict | None:
        with self._connect() as conn:
            self._ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, fund_id, fund_name, audience, model, title,
                           body_md, status, sent_at, gamma_generation_id, gamma_url
                      FROM client_letters WHERE id = %s
                    """,
                    (letter_id,),
                )
                rec = cur.fetchone()
        if not rec:
            return None
        sent = rec[8]
        return {
            "id": rec[0],
            "fund_id": rec[1],
            "fund_name": rec[2],
            "audience": rec[3],
            "model": rec[4],
            "title": rec[5],
            "body": rec[6] or "",
            "status": rec[7],
            "sent_at": sent.isoformat() if hasattr(sent, "isoformat") else sent,
            "gamma_generation_id": rec[9],
            "gamma_url": rec[10],
        }

    def mark_sent(self, letter_id: str) -> None:
        with self._connect() as conn:
            self._ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE client_letters
                       SET sent_at = now(), status = 'sent', updated_at = now()
                     WHERE id = %s
                    """,
                    (letter_id,),
                )
            conn.commit()

    def save_gamma(self, letter_id: str, generation_id: str, url: str = "") -> None:
        with self._connect() as conn:
            self._ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE client_letters
                       SET gamma_generation_id = %s,
                           gamma_url = COALESCE(NULLIF(%s, ''), gamma_url),
                           updated_at = now()
                     WHERE id = %s
                    """,
                    (generation_id, url or "", letter_id),
                )
            conn.commit()

    def list(self) -> list[dict]:
        with self._connect() as conn:
            self._ensure(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, title, audience, fund_name, status, updated_at
                      FROM client_letters
                     ORDER BY updated_at DESC
                     LIMIT 40
                    """
                )
                rows = cur.fetchall() or []
        out = []
        for rec in rows:
            updated = rec[5]
            out.append({
                "id": rec[0],
                "title": rec[1],
                "audience": rec[2],
                "fund_name": rec[3],
                "status": rec[4],
                "updated_at": updated.isoformat() if hasattr(updated, "isoformat") else updated,
            })
        return out


def _new_id() -> str:
    return "CL_" + uuid.uuid4().hex[:12]


def save_letter(
    store,
    *,
    fund_id: str,
    fund_name: str,
    audience: str,
    model: str,
    body: str,
    letter_id: str | None = None,
    title: str | None = None,
) -> dict:
    """Store a draft. This function does not email."""
    if audience not in AUDIENCES:
        return {"ok": False, "emailed": False, "error": "Choose an audience."}
    text = (body or "").strip()
    if not text:
        return {"ok": False, "emailed": False, "error": "The letter is empty."}
    row = {
        "id": (letter_id or "").strip() or _new_id(),
        "fund_id": fund_id,
        "fund_name": fund_name,
        "audience": audience,
        "model": model or "",
        "title": title or f"Client letter · {AUDIENCES[audience]['label']}",
        "body": text,
        "status": "draft",
    }
    stored = True
    try:
        store.save(row)
    except Exception as exc:
        stored = False
        row["store_error"] = str(exc)[:160]
    saved = store.get(row["id"]) if stored else None
    return {
        "ok": True,
        "id": row["id"],
        "emailed": False,
        "stored": stored,
        "sent_at": (saved or {}).get("sent_at"),
        "body": text,
        "title": row["title"],
        "fund_id": fund_id,
        "fund_name": fund_name,
        "audience": audience,
        "error": row.get("store_error") or "",
    }


def draft_letter(store, *, audience: str, book: dict, provider: str, complete) -> dict:
    """Write with the chosen cloud model, or hand the prompt back for a local one.

    Neither path emails.
    """
    if audience not in AUDIENCES:
        return {"ok": False, "emailed": False, "error": "Choose an audience."}
    system, user = letter_prompt(audience, book)
    if provider == "local":
        return {
            "ok": True,
            "local": True,
            "emailed": False,
            "system": system,
            "user": user,
            "fund_id": book.get("fund_id"),
            "fund_name": book.get("name"),
            "audience": audience,
        }
    text = (complete(provider, system, user) or "").strip()
    if not text:
        return {"ok": False, "emailed": False, "error": "The model returned an empty letter."}
    saved = save_letter(
        store,
        fund_id=str(book.get("fund_id") or ""),
        fund_name=str(book.get("name") or ""),
        audience=audience,
        model=provider,
        body=text,
    )
    saved["emailed"] = False
    saved["local"] = False
    return saved


def send_letter(store, letter_id: str, *, connected: bool, deliver) -> dict:
    """Email a saved letter. A disconnected sender does not call deliver."""
    row = store.get(letter_id)
    if not row or not str(row.get("body") or "").strip():
        return {"ok": False, "emailed": False, "error": "Save the letter first."}
    if not connected:
        return {
            "ok": False,
            "connected": False,
            "emailed": False,
            "detail": MAIL_OFF,
        }
    result = deliver(row) or {}
    sent = int(result.get("sent") or 0)
    if sent:
        store.mark_sent(letter_id)
    detail = ""
    if not sent:
        errs = result.get("errors") or []
        if errs and isinstance(errs[0], dict):
            detail = str(errs[0].get("error") or "")[:200]
        elif errs:
            detail = str(errs[0])[:200]
        if not detail:
            detail = "The letter stayed on the desk."
    return {
        "ok": sent > 0,
        "connected": True,
        "emailed": True,
        "sent": sent,
        "errors": result.get("errors") or [],
        "fallback": bool(result.get("fallback")),
        "detail": detail,
    }


def presentation_body(text: str) -> dict:
    """Gamma generations payload. Same fields the research decks already send."""
    return {
        "inputText": (text or "").strip()[:20000],
        "textMode": "generate",
        "format": "presentation",
        "numCards": 8,
        "exportAs": "pptx",
    }


def start_presentation(text: str, *, api_key: str, post) -> dict:
    if not (api_key or "").strip():
        return {"ok": False, "connected": False, "detail": GAMMA_OFF}
    if not (text or "").strip():
        return {"ok": False, "connected": True, "error": "Save the letter first."}
    generation_id = post(presentation_body(text), api_key)
    return {
        "ok": True,
        "connected": True,
        "started": True,
        "generation_id": generation_id,
        "detail": GAMMA_ON,
    }


def post_gamma(body: dict, api_key: str) -> str:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        GAMMA_GENERATIONS,
        data=data,
        headers={"Content-Type": "application/json", "X-API-KEY": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            payload = json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise RuntimeError(f"Gamma API {exc.code}: {detail}") from exc
    generation_id = str(payload.get("generationId") or "").strip()
    if not generation_id:
        raise RuntimeError("Gamma did not return a generation id.")
    return generation_id


def poll_gamma(generation_id: str, api_key: str) -> dict:
    req = urllib.request.Request(
        f"{GAMMA_GENERATIONS}/{generation_id}",
        headers={"X-API-KEY": api_key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise RuntimeError(f"Gamma API {exc.code}: {detail}") from exc
    return {
        "status": payload.get("status") or "",
        "gamma_url": payload.get("gammaUrl") or "",
    }


def create_router(
    claims_fn,
    request_json,
    *,
    positions_fn,
    activity_fn,
    name_fn,
    theses_fn,
    market_fn,
    complete_fn,
    deliver_fn,
    connect,
):
    router = APIRouter(prefix="/api/client-letter", tags=["client-letter"])
    store = PgStore(connect)

    def _gp(request: Request) -> dict:
        claims = claims_fn(request)
        if claims.get("role") not in ("gp", "admin"):
            raise HTTPException(403, "GP only")
        return claims

    def _body(request: Request) -> dict:
        try:
            body = request_json(request) or {}
        except Exception:
            body = {}
        return body if isinstance(body, dict) else {}

    @router.get("/status")
    def status(request: Request):
        _gp(request)
        mail = mail_connected()
        gamma = gamma_connected()
        return {
            "ok": True,
            "mail_connected": mail,
            "mail_detail": MAIL_ON if mail else MAIL_OFF,
            "presentation_connected": gamma,
            "presentation_detail": GAMMA_ON if gamma else GAMMA_OFF,
            "audiences": audience_rows(),
        }

    @router.get("/list")
    def list_letters(request: Request):
        _gp(request)
        try:
            letters = store.list()
        except Exception as exc:
            return JSONResponse({"ok": False, "letters": [], "error": str(exc)[:160]})
        return {"ok": True, "letters": letters}

    @router.post("/draft")
    def draft(request: Request):
        _gp(request)
        body = _body(request)
        audience = str(body.get("audience") or "").strip()
        provider = str(body.get("llm_provider") or body.get("provider") or "").strip().lower()
        if provider.startswith("local:"):
            provider = "local"
        if provider not in ("claude", "grok", "deepseek", "local"):
            return JSONResponse({"ok": False, "error": "Choose a model."}, status_code=400)
        year = int(body.get("year") or datetime.now(timezone.utc).year)
        book = load_book(
            str(body.get("fund_id") or ""),
            year,
            positions_fn=positions_fn,
            activity_fn=activity_fn,
            name_fn=name_fn,
            theses_fn=theses_fn,
            market_fn=market_fn,
        )
        if not book.get("ok"):
            return JSONResponse(
                {"ok": False, "error": book.get("error") or "Choose an account."},
                status_code=400,
            )
        try:
            out = draft_letter(
                store,
                audience=audience,
                book=book,
                provider=provider,
                complete=complete_fn,
            )
        except KeyError:
            return JSONResponse({"ok": False, "error": "Choose an audience."}, status_code=400)
        except Exception as exc:
            return JSONResponse({"ok": False, "error": str(exc)[:200]}, status_code=500)
        if not out.get("ok"):
            return JSONResponse(out, status_code=400)
        return out

    @router.post("/save")
    def save(request: Request):
        _gp(request)
        body = _body(request)
        out = save_letter(
            store,
            fund_id=str(body.get("fund_id") or ""),
            fund_name=str(body.get("fund_name") or ""),
            audience=str(body.get("audience") or ""),
            model=str(body.get("model") or ""),
            body=str(body.get("body") or ""),
            letter_id=str(body.get("id") or "") or None,
            title=str(body.get("title") or "") or None,
        )
        if not out.get("ok"):
            return JSONResponse(out, status_code=400)
        return out

    @router.get("/{letter_id}")
    def get_letter(letter_id: str, request: Request):
        _gp(request)
        row = store.get(letter_id)
        if not row:
            raise HTTPException(404, "Letter not found.")
        return {"ok": True, "letter": row}

    @router.post("/{letter_id}/send")
    def send(letter_id: str, request: Request):
        claims = _gp(request)
        out = send_letter(
            store,
            letter_id,
            connected=mail_connected(),
            deliver=lambda row: deliver_fn(row, claims.get("email")),
        )
        if out.get("error") == "Save the letter first.":
            return JSONResponse(out, status_code=400)
        return out

    @router.post("/{letter_id}/presentation")
    def presentation(letter_id: str, request: Request):
        _gp(request)
        row = store.get(letter_id)
        if not row or not str(row.get("body") or "").strip():
            return JSONResponse(
                {"ok": False, "error": "Save the letter first."},
                status_code=400,
            )
        try:
            started = start_presentation(
                row.get("body") or "",
                api_key=os.environ.get("GAMMA_API_KEY", ""),
                post=post_gamma,
            )
        except Exception as exc:
            return JSONResponse({"ok": False, "connected": True, "error": str(exc)[:240]})
        if started.get("generation_id"):
            try:
                store.save_gamma(letter_id, started["generation_id"])
            except Exception:
                pass
        return started

    @router.get("/{letter_id}/presentation")
    def presentation_status(letter_id: str, request: Request):
        _gp(request)
        if not gamma_connected():
            return {"ok": False, "connected": False, "detail": GAMMA_OFF}
        row = store.get(letter_id)
        if not row:
            raise HTTPException(404, "Letter not found.")
        if row.get("gamma_url"):
            return {"ok": True, "connected": True, "status": "completed", "gamma_url": row["gamma_url"]}
        generation_id = str(row.get("gamma_generation_id") or "").strip()
        if not generation_id:
            return {"ok": False, "connected": True, "error": "Start the presentation first."}
        try:
            polled = poll_gamma(generation_id, os.environ.get("GAMMA_API_KEY", ""))
        except Exception as exc:
            return {"ok": False, "connected": True, "error": str(exc)[:240]}
        if polled.get("gamma_url"):
            try:
                store.save_gamma(letter_id, generation_id, polled["gamma_url"])
            except Exception:
                pass
        return {"ok": True, "connected": True, **polled}

    return router
