# Mobile speed audit

Run this whenever the phone feels slow. Do not invent a new path. Compare the new numbers to the last row in `RUNS.md`, then append a new row.

The phone is the DGA Capital app (Expo), not the desktop desk. These steps are the requests that screen actually makes.

## How to run

From the repo root:

```bash
python3 docs/mobile-speed/measure.py
```

That times the live server twice, back to back, with the demo login. Paste the printed block at the top of `RUNS.md`. Keep older runs. Do not delete them.

Demo login is slower than a real GP login because it rehashes the demo password. Do not treat demo login time as the GP sign-in time. Every other step is the same API the phone calls.

## Steps, in order

Do not skip a step because an earlier one was fast. A slow phone is usually one step, and it moves.

| Step | What the phone does | Request | Pass | Budget |
|---|---|---|---|---|
| 1 | App can reach the server | `GET /health` | either | under 300 ms |
| 2 | Sign in | `POST /api/auth/v2/login` | first | GP under 2 s. Demo is not this budget |
| 3 | Markets first paint | `GET /api/mobile/home` | first, then second | first under 2 s, second under 800 ms |
| 4 | Saved reports list | `GET /api/reports` | first, then second | under 500 ms |
| 5 | Full watchlist, if a screen asks for it | `GET /api/watchlist` | first, then second | first under 2.5 s, second under 1 s |
| 6 | Open one saved report | `GET /api/report/{ticker}?provider=grok&as_stored=1` | first | under 800 ms |

Record, for each step: client wall time, HTTP status, response bytes, and the server's own timer when the JSON has `elapsed_ms` or `timing_ms`. Also record counts: home tickers, quotes with a price, report rows.

## What a pass is not

- Do not time a cold Metro bundler or a new install. That is not the daily open.
- Do not publish a mobile update as part of the audit.
- Do not start Daily Brief, Market Pulse, or a live SEC pull to "see if it helps." Those are off the first paint on purpose.
- Curl does not include the phone drawing the list. If every API step is inside budget and the phone is still slow, say that, and look at cache paint and the JS bundle. Do not blame the API without a slow row.

## After the numbers

1. Compare each step to the previous run in `RUNS.md`. Write better, worse, or same. A step is worse when it is more than 30 percent slower than last time, or it crosses its budget.
2. Pick at most one step to change. The slowest step that is over budget wins. Do not retune three screens in one pass.
3. If you change that step, time it again and add a second block to the same run: `after`.
4. Leave the checklist alone unless a screen starts calling a new request. Add that request as a new numbered step. Do not rename old steps. Old runs must stay comparable.

## Screen map

Checked against the app code. Update this list when the calls change.

- **Markets** (`MarketsScreen.js`): cache first, then `GET /api/mobile/home` (indices + lite watchlist). Idea feed, brief, and pulse are not on that first call. Brief and pulse wait 12 seconds, and only after a full load.
- **Research home** (`HomeScreen.js`): cache first, then `GET /api/reports`. Earnings batch uses the watchlist already in memory, or one `GET /api/watchlist` if that memory is empty.
- **Report** (`ReportScreen.js`): `GET /api/report/{ticker}?as_stored=1`, then one quote.
- **Sign-in** is `POST /api/auth/v2/login`. The phone must not check for an update before this returns.
