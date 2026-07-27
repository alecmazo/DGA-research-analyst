# SUP_20260726 — Watchlist weekend quote fix

**Ticket:** GP watchlist on Sunday did not show Friday Yahoo closes.

## Fix (code in progress)

- `market_data._yahoo_chart_quote`: session-aware price — when RTH closed, pin last completed daily bar (Friday close); correct prior session for day %.
- `api.server.batch_quotes`: pass `as_of` / `price_source`; cap store fallback to 4 days (no multi-week stale prices).

## Status

Local fix verified with Sunday simulation (TSLA/DLR match Fri close). Deploy pending push of `market_data.py` + `api/server.py`.
