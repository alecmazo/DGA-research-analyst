"""Desk clean prices. Typed by a person. Not a TRACE print."""

from __future__ import annotations

from datetime import date

from credit.calc import money


def apply_typed_prices(store, prices: dict | None, entered_by: str, today: str | None = None) -> None:
    """Save a clean price, or forget it when the cell is cleared."""
    if not isinstance(prices, dict):
        return
    day = (today or date.today().isoformat())[:10]
    for instrument_id, row in prices.items():
        iid = str(instrument_id or "").strip()
        if not iid or not isinstance(row, dict):
            continue
        clean = money(row.get("clean_price"))
        if clean is None:
            store.forget_price(iid)
            continue
        store.add_price({
            "instrument_id": iid,
            "clean_price": format(clean, "f"),
            "trade_date": str(row.get("trade_date") or day)[:10],
            "source_note": "Typed on the pricing card. Not a TRACE print.",
            "entered_by": entered_by or "",
        })


def overrides_from_store(store, instrument_ids: list[str]) -> dict:
    latest = store.latest_prices()
    found = {}
    for iid in instrument_ids:
        row = latest.get(iid)
        if not row:
            continue
        clean = row.get("clean_price")
        if clean in (None, ""):
            continue
        found[iid] = {"clean_price": str(clean)}
    return found


def merge_price_overrides(stored: dict, incoming: dict | None) -> dict:
    """A typed price replaces the saved one. A blank cell drops it."""
    merged = dict(stored)
    if not isinstance(incoming, dict):
        return merged
    for instrument_id, row in incoming.items():
        iid = str(instrument_id or "").strip()
        if not iid or not isinstance(row, dict):
            continue
        if money(row.get("clean_price")) is None:
            merged.pop(iid, None)
        else:
            merged[iid] = {"clean_price": row.get("clean_price")}
    return merged


def priced_packet_body(store, packet: dict, body: dict | None, entered_by: str = "") -> dict:
    body = dict(body or {})
    if isinstance(body.get("prices"), dict):
        apply_typed_prices(store, body["prices"], entered_by)
    ids = [row.get("id") for row in packet.get("instruments") or [] if row.get("id")]
    stored = overrides_from_store(store, ids)
    incoming = body.get("prices") if isinstance(body.get("prices"), dict) else None
    body["prices"] = merge_price_overrides(stored, incoming)
    return body
