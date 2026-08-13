"""
snaptrade_client.py — thin wrapper over the SnapTrade SDK for DGA's Fidelity
holdings import. SnapTrade (https://snaptrade.com) connects brokerage accounts —
including Fidelity, which Fidelity stopped supporting via Plaid in Oct 2023.

Environment (set in Railway, backend-only — never shipped to any client):
    SNAPTRADE_CLIENT_ID      your SnapTrade clientId (not secret)
    SNAPTRADE_CONSUMER_KEY   your SnapTrade consumerKey (SECRET)
    SNAPTRADE_REDIRECT_URI   optional — where the connection portal returns the
                             user (defaults to the GP terminal)
    SNAPTRADE_BROKER         optional broker slug to deep-link (e.g. FIDELITY);
                             if unset, the user picks the brokerage in the portal

Read-only access only (connection_type="read") — we pull holdings, never trade.
The SDK + model imports are lazy so this module imports cleanly even where the
SDK isn't installed (e.g. local syntax checks), matching the codebase style.
"""
from __future__ import annotations

import os

CLIENT_NAME = "DGA Capital"
DEFAULT_REDIRECT = "https://portfolio.dgacapital.com/gp"


def _env_cred(name: str) -> str:
    """Read a SnapTrade env var; strip whitespace and accidental shell quotes."""
    v = (os.environ.get(name) or "").strip()
    if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
        v = v[1:-1].strip()
    return v


def available() -> bool:
    """True if the SDK is importable and credentials are configured."""
    try:
        import snaptrade_client  # noqa: F401
    except Exception:
        return False
    return bool(_env_cred("SNAPTRADE_CLIENT_ID") and _env_cred("SNAPTRADE_CONSUMER_KEY"))


def _client():
    """Build a SnapTrade SDK client with commercial (partner) credentials.

    SnapTrade Python SDK ≥12 prefers::

        SnapTrade(auth=SnapTradeAuth.commercial_api_key(client_id=…, consumer_key=…))

    Older SDKs take ``client_id`` / ``consumer_key`` kwargs. Using only the old
    kwargs on a v12 install can send *no* partner signature → API 401
    ``Authentication credentials were not provided.``
    """
    from snaptrade_client import SnapTrade
    cid = _env_cred("SNAPTRADE_CLIENT_ID")
    sec = _env_cred("SNAPTRADE_CONSUMER_KEY")
    if not cid or not sec:
        raise RuntimeError("SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY are not set.")

    # Prefer explicit commercial auth (SDK 12+ / canary).
    try:
        from snaptrade_client import SnapTradeAuth  # type: ignore
        factory = getattr(SnapTradeAuth, "commercial_api_key", None) or getattr(
            SnapTradeAuth, "commercialApiKey", None)
        if callable(factory):
            try:
                return SnapTrade(auth=factory(client_id=cid, consumer_key=sec))
            except TypeError:
                # Some builds use camelCase kwargs
                return SnapTrade(auth=factory(clientId=cid, consumerKey=sec))
    except Exception:
        pass

    # Legacy constructors (SDK ≤11)
    try:
        return SnapTrade(client_id=cid, consumer_key=sec)
    except TypeError:
        return SnapTrade(consumer_key=sec, client_id=cid)


def check_status() -> dict:
    """API reachability check (partner credentials only — no userSecret)."""
    return _to_dict(_client().api_status.check().body)


def register_user(user_id: str) -> dict:
    """Register a SnapTrade user; returns {userId, userSecret}. The userSecret is
    a per-user credential — caller must encrypt it at rest."""
    r = _client().authentication.register_snap_trade_user(user_id=str(user_id))
    body = r.body
    secret = _pluck(body, "userSecret", "user_secret")
    uid = _pluck(body, "userId", "user_id") or str(user_id)
    return {"userId": uid, "userSecret": secret}


def _pluck(body, *keys):
    """Extract a field from an SDK body whether it's a dict, a schema object, or
    needs coercion."""
    for k in keys:
        try:
            v = body[k]
            if v is not None:
                return v
        except Exception:
            pass
        v = getattr(body, k, None)
        if v is not None:
            return v
    d = _to_dict(body)
    if isinstance(d, dict):
        for k in keys:
            if d.get(k) is not None:
                return d.get(k)
    return None


def delete_user(user_id: str) -> dict:
    return _to_dict(_client().authentication.delete_snap_trade_user(user_id=str(user_id)).body)


def login_url(user_id: str, user_secret: str, custom_redirect: str = "",
              broker: str = "", connection_type: str = "read") -> str:
    """Generate a Connection Portal URL (expires in 5 min). Open it in a new tab;
    the user links their brokerage there and is returned to custom_redirect."""
    kw = {
        "user_id": str(user_id),
        "user_secret": user_secret,
        "connection_type": connection_type or "read",
    }
    if custom_redirect:
        kw["custom_redirect"] = custom_redirect
    if broker:
        kw["broker"] = broker
    body = _client().authentication.login_snap_trade_user(**kw).body
    # body may be a dict {"redirectURI": "..."} or the URL string itself.
    if isinstance(body, dict):
        return body.get("redirectURI") or body.get("redirect_uri") or body.get("redirectUri") or ""
    return str(body)


def _fetch_account_positions(ai, uid: str, sec: str, aid: str) -> list:
    """Positions for one account across SnapTrade SDK generations.

    SDK ≥13 renamed ``get_user_account_positions`` → ``get_all_account_positions``
    and wraps the list as ``{results: [...], data_freshness: ...}``. Positions
    use ``instrument`` (kind/symbol/raw_symbol) instead of nested ``symbol``.
    """
    body = None
    last_err: Exception | None = None

    # Preferred: SDK 13+ all-positions endpoint
    fn = getattr(ai, "get_all_account_positions", None)
    if callable(fn):
        try:
            body = _to_dict(fn(account_id=aid, user_id=uid, user_secret=sec).body)
        except Exception as e:
            last_err = e

    # Legacy: SDK ≤12
    if body is None:
        fn_legacy = getattr(ai, "get_user_account_positions", None)
        if callable(fn_legacy):
            try:
                body = _to_dict(
                    fn_legacy(account_id=aid, user_id=uid, user_secret=sec).body
                )
            except Exception as e:
                last_err = e

    # Last resort: per-account holdings envelope (often disabled on new plans)
    if body is None:
        fn_hold = getattr(ai, "get_user_holdings", None)
        if callable(fn_hold):
            try:
                body = _to_dict(
                    fn_hold(account_id=aid, user_id=uid, user_secret=sec).body
                )
            except Exception as e:
                last_err = e

    if body is None:
        raise RuntimeError(
            f"SnapTrade positions API unavailable for account {aid}: {last_err!r}"
        )

    if isinstance(body, list):
        raw = body
    elif isinstance(body, dict):
        raw = (
            body.get("results")
            or body.get("positions")
            or body.get("data")
            or []
        )
    else:
        raw = []

    out = []
    for p in raw or []:
        if not isinstance(p, dict):
            continue
        out.append(_normalize_position_dict(p))
    return out


def _normalize_position_dict(p: dict) -> dict:
    """Normalize a single position so the rest of DGA can keep using
    nested ``symbol`` + ``average_purchase_price`` fields."""
    # Already legacy shape
    if p.get("symbol") and not p.get("instrument"):
        # Ensure average_purchase_price alias for cost_basis
        if p.get("average_purchase_price") is None and p.get("cost_basis") is not None:
            p = {**p, "average_purchase_price": p.get("cost_basis")}
        return p

    inst = p.get("instrument")
    if isinstance(inst, dict):
        # Build a PositionSymbol-like nest for _snaptrade_symbol()
        ticker = inst.get("raw_symbol") or inst.get("symbol")
        desc = inst.get("description")
        kind = (inst.get("kind") or "").lower()
        p = {
            **p,
            "symbol": {
                "raw_symbol": ticker,
                "description": desc,
                "symbol": ticker,
                "type": {"code": kind} if kind else None,
                "instrument": inst,
            },
            # New API: cost_basis is book/avg purchase price per share
            "average_purchase_price": (
                p.get("average_purchase_price")
                if p.get("average_purchase_price") is not None
                else p.get("cost_basis")
            ),
            "cash_equivalent": bool(
                p.get("cash_equivalent")
                or (kind == "mutualfund" and p.get("cash_equivalent") is True)
                or inst.get("cash_equivalent")
            ),
            "instrument_kind": kind,
        }
        # Options: mark for downstream asset_class handling
        if kind == "option":
            p["is_option"] = True
            p["option_type"] = inst.get("option_type")
            p["strike_price"] = inst.get("strike_price")
            p["expiration_date"] = inst.get("expiration_date")
            und = inst.get("underlying") or {}
            if isinstance(und, dict):
                p["underlying_symbol"] = und.get("raw_symbol") or und.get("symbol")
    return p


_MM_TICKERS = {
    "SPAXX", "FDRXX", "FDLXX", "FZFXX", "FZDXX", "SPRXX", "VMFXX",
    "FCASH", "CASH", "USD",
}


def _pos_symbol(p: dict) -> str:
    inst = p.get("instrument") if isinstance(p.get("instrument"), dict) else {}
    node = p.get("symbol") if isinstance(p.get("symbol"), dict) else {}
    return str(
        inst.get("raw_symbol")
        or node.get("raw_symbol")
        or (p.get("symbol") if isinstance(p.get("symbol"), str) else None)
        or p.get("raw_symbol")
        or ""
    ).strip().upper()


def _sum_balance_cash(balances) -> float:
    """USD (and unknown-currency) cash from get_user_account_balance."""
    if isinstance(balances, dict):
        balances = balances.get("balances") or balances.get("data") or [balances]
    total = 0.0
    for b in balances or []:
        if not isinstance(b, dict):
            continue
        cur = b.get("currency")
        code = ""
        if isinstance(cur, dict):
            code = str(cur.get("code") or "").upper()
        elif isinstance(cur, str):
            code = cur.upper()
        if code and code not in ("USD", "US"):
            continue
        c = b.get("cash")
        if isinstance(c, dict):
            c = c.get("amount") or c.get("value")
        if c is not None:
            try:
                total += float(c)
            except (TypeError, ValueError):
                pass
    return total


def get_account_holdings(user_id: str, user_secret: str, account_id: str):
    """Holdings for ONE account — {positions, total_value}.

    Built from the GRANULAR per-account endpoints. Combined holdings endpoints
    are often disabled; SDK 13 uses get_all_account_positions (+ balance).

    Fidelity core sweep (SPAXX) is a cash_equivalent *position*, but sale
    proceeds often sit as uninvested cash on the balance endpoint only.
    ``balances.cash`` is SPAXX + that residual. We inject only the residual
    so we don't double-count the sweep.
    """
    ai = _client().account_information
    uid, sec, aid = str(user_id), user_secret, str(account_id)

    positions = _fetch_account_positions(ai, uid, sec, aid)

    pos_mv = 0.0
    cash_pos_mv = 0.0
    for p in positions:
        if not isinstance(p, dict):
            continue
        sym = _pos_symbol(p)
        is_cash = bool(p.get("cash_equivalent")) or sym in _MM_TICKERS
        if is_cash:
            p["cash_equivalent"] = True
        units, price = p.get("units"), p.get("price")
        try:
            if units is not None and price is not None:
                mv = float(units) * float(price)
                pos_mv += mv
                if is_cash:
                    cash_pos_mv += mv
        except Exception:
            pass

    cash_bal = 0.0
    try:
        balances = _to_dict(
            ai.get_user_account_balance(account_id=aid, user_id=uid, user_secret=sec).body
        ) or []
        cash_bal = _sum_balance_cash(balances)
    except Exception:
        pass

    residual = round(cash_bal - cash_pos_mv, 2)
    if residual > 0.50:
        positions.append({
            "units": residual,
            "price": 1.0,
            "average_purchase_price": 1.0,
            "cost_basis": 1.0,
            "cash_equivalent": True,
            "instrument_kind": "currency",
            "symbol": {
                "raw_symbol": "CASH",
                "symbol": "CASH",
                "description": "Uninvested cash",
            },
        })
        pos_mv += residual

    return {"positions": positions, "total_value": pos_mv or None}


def get_option_holdings(user_id: str, user_secret: str, account_id: str):
    """Option positions for ONE account (separate endpoint from equity positions).
    The deprecated combined get_user_holdings used to return these as
    `option_positions`; get_user_account_positions does NOT include them."""
    r = _client().options.list_option_holdings(
        user_id=str(user_id), user_secret=user_secret, account_id=str(account_id))
    return _to_dict(r.body)


def get_balances(user_id: str, user_secret: str, account_id: str):
    """Raw per-currency balances for ONE account."""
    r = _client().account_information.get_user_account_balance(
        account_id=str(account_id), user_id=str(user_id), user_secret=user_secret)
    return _to_dict(r.body)


def get_account_activities(user_id: str, user_secret: str, account_id: str,
                           start_date: str | None = None, end_date: str | None = None):
    """Transaction history for ONE account in [start_date, end_date] (YYYY-MM-DD).

    Returns BUY / SELL / DIVIDEND / CONTRIBUTION / WITHDRAWAL / INTEREST / FEE /
    TRANSFER activities — what the position/balance endpoints do NOT give. This is
    the basis for YTD trade lists and external-cash-flow-aware return math.

    Tries the PER-ACCOUNT paginated endpoint first
    (account_information.get_account_activities): the legacy combined
    transactions_and_reporting.get_activities returns 'This endpoint is no
    longer available for your account' on current SnapTrade plans (verified
    live 2026-07-02 — the per-account method was the only one returning data).
    Falls back to the legacy endpoint for older plans/SDKs.
    """
    uid, sec, aid = str(user_id), user_secret, str(account_id)
    try:
        return _get_account_activities_paged(uid, sec, aid, start_date, end_date)
    except Exception as first_err:
        # Fallback: the legacy combined endpoint (older plans/SDKs).
        try:
            kw = {"user_id": uid, "user_secret": sec, "accounts": aid}
            if start_date:
                kw["start_date"] = start_date
            if end_date:
                kw["end_date"] = end_date
            r = _client().transactions_and_reporting.get_activities(**kw)
            body = _to_dict(r.body)
            if isinstance(body, dict):
                items = body.get("data") or body.get("activities") or []
            else:
                items = body or []
            return [_to_dict(x) for x in items]
        except Exception:
            raise first_err


def _get_account_activities_paged(uid: str, sec: str, aid: str,
                                  start_date: str | None, end_date: str | None):
    """account_information.get_account_activities with pagination — loops until
    the window is exhausted. Handles both paginated ({data, pagination}) and
    plain-list response shapes, and SDKs without offset/limit kwargs."""
    ai = _client().account_information
    out: list = []
    offset = 0
    page_size = 500
    pages = 0
    first_id_prev = None
    while True:
        pages += 1
        if pages > 10:   # wall-clock sanity: 10 pages = 5,000 activities max/run
            break
        kw = {"account_id": aid, "user_id": uid, "user_secret": sec,
              "offset": offset, "limit": page_size}
        if start_date:
            kw["start_date"] = start_date
        if end_date:
            kw["end_date"] = end_date
        try:
            r = ai.get_account_activities(**kw)
        except TypeError:
            # Older SDK without pagination kwargs — single unpaged call.
            kw.pop("offset", None)
            kw.pop("limit", None)
            r = ai.get_account_activities(**kw)
            body = _to_dict(r.body)
            items = body.get("data") if isinstance(body, dict) else body
            return [_to_dict(x) for x in (items or [])]
        body = _to_dict(r.body)
        total = None
        if isinstance(body, dict):
            items = body.get("data") or body.get("activities") or []
            pag = body.get("pagination") or {}
            try:
                total = int(pag.get("total")) if pag.get("total") is not None else None
            except (TypeError, ValueError):
                total = None
        else:
            items = body or []
        items = [_to_dict(x) for x in items]
        # No-progress guard: if the endpoint IGNORES offset (or paginates by
        # cursor), every "page" is the same — detect via the first activity id
        # and stop instead of looping 20k dupes (the 36-minute-sync incident).
        first_id = None
        for x in items:
            if isinstance(x, dict) and (x.get("id") or x.get("activity_id")):
                first_id = str(x.get("id") or x.get("activity_id"))
                break
        if first_id is not None and first_id == first_id_prev:
            break
        first_id_prev = first_id
        out.extend(items)
        if (not items or len(items) < page_size
                or (total is not None and len(out) >= total)):
            break
        offset += len(items)
    return out


def probe_activity_methods(user_id: str, user_secret: str, account_id: str,
                           start_date: str | None = None, end_date: str | None = None):
    """Diagnostic: enumerate every SDK method that looks transaction/activity-related
    across all API groups, try calling each for ONE account, and report what works.
    Used to find a non-gated path after get_activities returned 'no longer available'."""
    client = _client()
    uid, sec, aid = str(user_id), user_secret, str(account_id)
    groups = ("transactions_and_reporting", "account_information")
    found, results = [], []
    for gname in groups:
        grp = getattr(client, gname, None)
        if grp is None:
            continue
        for mname in dir(grp):
            if mname.startswith("_"):
                continue
            low = mname.lower()
            if "activit" not in low and "transaction" not in low:
                continue
            full = f"{gname}.{mname}"
            found.append(full)
            fn = getattr(grp, mname)
            # Try the two common call shapes; stop at the first that doesn't raise.
            attempts = [
                {"account_id": aid, "user_id": uid, "user_secret": sec},
                {"accounts": aid, "user_id": uid, "user_secret": sec},
            ]
            for ai, kw in enumerate(attempts):
                if start_date: kw = {**kw, "start_date": start_date}
                if end_date:   kw = {**kw, "end_date": end_date}
                try:
                    r = fn(**kw)
                    body = _to_dict(getattr(r, "body", r))
                    n = len(body) if isinstance(body, (list, dict)) else None
                    sample = str(body)[:600]
                    results.append({"method": full, "shape": ai, "ok": True,
                                    "count": n, "sample": sample})
                    break
                except TypeError as e:
                    # wrong kwargs for this shape — try the next shape
                    if ai == len(attempts) - 1:
                        results.append({"method": full, "shape": ai, "ok": False,
                                        "error": f"TypeError: {e!s:.140}"})
                    continue
                except Exception as e:
                    results.append({"method": full, "shape": ai, "ok": False,
                                    "error": f"{type(e).__name__}: {e!s:.160}"})
                    break
    return {"methods_found": found, "results": results}


def list_accounts(user_id: str, user_secret: str):
    r = _client().account_information.list_user_accounts(
        user_id=str(user_id), user_secret=user_secret)
    return _to_dict(r.body)


def list_connections(user_id: str, user_secret: str):
    r = _client().connections.list_brokerage_authorizations(
        user_id=str(user_id), user_secret=user_secret)
    return _to_dict(r.body)


def remove_connection(user_id: str, user_secret: str, authorization_id: str) -> None:
    _client().connections.remove_brokerage_authorization(
        authorization_id=str(authorization_id), user_id=str(user_id), user_secret=user_secret)


def refresh_connection(user_id: str, user_secret: str, authorization_id: str):
    """Ask SnapTrade to RE-PULL the brokerage now (holdings often refresh only
    ~once/day on their side). Async on SnapTrade's end — new data lands seconds→
    minutes later, so sync again after. May be rate-limited on the free tier."""
    r = _client().connections.refresh_brokerage_authorization(
        authorization_id=str(authorization_id), user_id=str(user_id), user_secret=user_secret)
    return _to_dict(r.body)


def _to_dict(body):
    """SDK bodies are schema objects; coerce to plain JSON-able structures."""
    if body is None:
        return body
    if isinstance(body, (dict, list, str, int, float, bool)):
        return body
    for attr in ("to_dict", "model_dump"):
        fn = getattr(body, attr, None)
        if callable(fn):
            try:
                return fn()
            except Exception:
                pass
    # Konfig schema objects are dict-like / iterable
    try:
        return dict(body)
    except Exception:
        try:
            return list(body)
        except Exception:
            return body
