# Mobile speed runs

Newest run first. Each block comes from `python3 docs/mobile-speed/measure.py`. The steps are defined in `CHECKLIST.md`. Do not renumber them.

The Budget column in each run is the limit that was in force that day. Current limits are in `CHECKLIST.md` (revised 2026-09-24, after Run 002). Do not rewrite these cells when a budget changes.

## Run 003 — 2026-10-14

Demo book, 10 names. Live `ui731-20261008-city-view` before the load-time change. An earlier pass the same day, right after a 16 s demo login, was home first 1871 ms / server 1722 ms (over the 1 s budget). That cold handler is the API step this change targets. The table below is a second `ui731` pass with a warm worker.

### Before — build `ui731-20261008-city-view`

| Step | Result | Client | Server | Size | Counts | Budget |
|---|---|---|---|---|---|---|
| 1 health | OK | 121 ms | — | 123 B | | under 300 ms, inside |
| 2 login demo | OK | 3990 ms | — | 694 B | | not the GP budget |
| 3 home first | OK | 433 ms | 175 ms | 2076 B | 11 indices, 10 tickers, 10 priced | under 1 s, inside |
| 3 home second | OK | 322 ms | 1 ms | 2089 B | same | under 400 ms, inside |
| 4 reports first | OK | 271 ms | — | 1671 B | 10 rows | under 300 ms, inside |
| 4 reports second | OK | 330 ms | — | 1671 B | 10 rows | under 300 ms, over |
| 5 watchlist first | OK | 2160 ms | 1974 ms | 2292 B | 10 tickers, 10 priced | under 2 s, over |
| 5 watchlist second | OK | 168 ms | 1 ms | 2309 B | 10 tickers, 10 priced | under 400 ms, inside |
| 6 report open | OK | 195 ms | — | 1193 B | RKLB, 1067 chars, not incomplete | under 800 ms, inside |

### Compared with Run 002

| Step | Run 002 after | This before | Change |
|---|---|---|---|
| 1 health | 100 ms | 121 ms | same |
| 3 home first | 311 ms | 433 ms warm; 1871 ms cold | warm same; cold worse, over |
| 3 home second | 87 ms | 322 ms | worse |
| 4 reports | 93 ms then 112 ms | 271 ms then 330 ms | worse; second over |
| 5 watchlist | 1626 ms then 91 ms | 2160 ms then 168 ms | worse; first over |
| 6 report open | 104 ms | 195 ms | same, inside |

### What changed

One API step: `GET /api/mobile/home`. Lite watchlist now reads the ticker list and store quotes on one pooled connection and skips migrate / Yahoo / YTD / report flags / the duplicate last-close query. Indices and lite watchlist run at the same time. Full `/api/watchlist` is unchanged.

GP site first paint is a separate client split: Desk is the only eager page, Inter fonts start as print-media, popup helpers left the report pages. Not a mobile OTA.

### After — build `ui732-20261014-load`

| Step | Result | Client | Server | Size | Counts | Budget |
|---|---|---|---|---|---|---|
| 1 health | OK | 94 ms | — | 114 B | | under 300 ms, inside |
| 2 login demo | OK | 7605 ms | — | 694 B | | not the GP budget |
| 3 home first | OK | 1980 ms | 1852 ms | 2036 B | 11 indices, 10 tickers, 10 priced | under 1 s, over |
| 3 home second | OK | 99 ms | 1 ms | 2048 B | same | under 400 ms, inside |
| 4 reports first | OK | 118 ms | — | 1671 B | 10 rows | under 300 ms, inside |
| 4 reports second | OK | 202 ms | — | 1671 B | 10 rows | under 300 ms, inside |
| 5 watchlist first | OK | 2591 ms | 2449 ms | 1792 B | 10 tickers, 10 priced | under 2 s, over |
| 5 watchlist second | OK | 134 ms | 1 ms | 1809 B | 10 tickers, 10 priced | under 400 ms, inside |
| 6 report open | OK | 125 ms | — | 1182 B | RKLB, 1056 chars, not incomplete | under 800 ms, inside |

Two threads each opened a new pooled connection, so the cold home stay over budget. ui733 keeps lite on one connection and fills the index ribbon from that same read.

## Run 003b — 2026-10-14

Same demo book. After `ui733-20261014-home`.

### After — build `ui733-20261014-home`

| Step | Result | Client | Server | Size | Counts | Budget |
|---|---|---|---|---|---|---|
| 1 health | OK | 120 ms | — | 114 B | | under 300 ms, inside |
| 2 login demo | OK | 10673 ms | — | 694 B | | not the GP budget |
| 3 home first | OK | 205 ms | 79 ms | 2060 B | 11 indices, 10 tickers, 10 priced | under 1 s, inside |
| 3 home second | OK | 220 ms | 1 ms | 2074 B | same | under 400 ms, inside |
| 4 reports first | OK | 129 ms | — | 1668 B | 10 rows | under 300 ms, inside |
| 4 reports second | OK | 128 ms | — | 1668 B | 10 rows | under 300 ms, inside |
| 5 watchlist first | OK | 2467 ms | 2215 ms | 1677 B | 10 tickers, 10 priced | under 2 s, over |
| 5 watchlist second | OK | 148 ms | 1 ms | 1694 B | 10 tickers, 10 priced | under 400 ms, inside |
| 6 report open | OK | 213 ms | — | 1194 B | RKLB, 1068 chars, not incomplete | under 800 ms, inside |

### Compared with ui732 after

| Step | ui732 after | ui733 after | Change |
|---|---|---|---|
| 3 home first | 1980 ms / 1852 ms | 205 ms / 79 ms | better, inside |
| 3 home second | 99 ms | 220 ms | same, inside |
| 5 watchlist first | 2591 ms | 2467 ms | same, still over |

Home first is the step this pass changed. Full watchlist is still the report-table flag query. Do not retune it in this run.

GP site first JS is 410 KB (128 KB gzip), down from 942 KB (270 KB gzip). CSS is 83 KB (17 KB gzip), down from 245 KB (46 KB gzip). City still loads Three.js only when opened. No mobile OTA.

## Run 002 — 2026-09-24

Demo book, 10 names. Two passes: `ui662` before the read-path change, `ui663` after it. The `ui663` block below is the one that counts. A first pass on `ui663` returned 0 tickers because the demo login's watchlist rows were still on a previous user id; those 10 names were copied onto the current demo user before this pass.

### Before — build `ui662-20260924-demo-login`

| Step | Result | Client | Server | Size | Counts | Budget |
|---|---|---|---|---|---|---|
| 1 health | OK | 183 ms | — | 121 B | | under 300 ms, inside |
| 2 login demo | OK | 5875 ms | — | 694 B | | not the GP budget |
| 3 home first | OK | 1817 ms | 1700 ms | 2208 B | 11 indices, 10 tickers, 10 priced | under 2 s, inside |
| 3 home second | OK | 97 ms | 1 ms | 2220 B | same | under 800 ms, inside |
| 4 reports first | OK | 1703 ms | — | 1671 B | 10 rows | under 500 ms, over |
| 4 reports second | OK | 86 ms | — | 1671 B | 10 rows | under 500 ms, inside |
| 5 watchlist first | OK | 1705 ms | 1605 ms | 1860 B | 10 tickers, 10 priced | under 2.5 s, inside |
| 5 watchlist second | OK | 85 ms | 1 ms | 1877 B | 10 tickers, 10 priced | under 1 s, inside |
| 6 report open | OK | 1855 ms | — | 1190 B | ADBE, 1064 chars | under 800 ms, over |

Home and the full watchlist spent about 1.6 s of that first call on `SELECT ticker FROM analyst_reports`. The quote read itself was 60–75 ms. Reports first was a cold read of the demo list. Report open was ADBE, which is not one of the 10 saved demo names, so the server wrote a sample note during the timing.

### After — build `ui663-20260924-mobile-read`

| Step | Result | Client | Server | Size | Counts | Budget |
|---|---|---|---|---|---|---|
| 1 health | OK | 100 ms | — | 122 B | | under 300 ms, inside |
| 2 login demo | OK | 4885 ms | — | 694 B | | not the GP budget |
| 3 home first | OK | 311 ms | 109 ms | 2075 B | 11 indices, 10 tickers, 10 priced | under 2 s, inside |
| 3 home second | OK | 87 ms | 1 ms | 2088 B | same | under 800 ms, inside |
| 4 reports first | OK | 93 ms | — | 1839 B | 11 rows | under 500 ms, inside |
| 4 reports second | OK | 112 ms | — | 1839 B | 11 rows | under 500 ms, inside |
| 5 watchlist first | OK | 1626 ms | 1529 ms | 1759 B | 10 tickers, 10 priced | under 2.5 s, inside |
| 5 watchlist second | OK | 91 ms | 1 ms | 1776 B | 10 tickers, 10 priced | under 1 s, inside |
| 6 report open | OK | 104 ms | — | 1190 B | ADBE, 1064 chars, not incomplete | under 800 ms, inside |

### Compared with Run 001

| Step | Run 001 | This run | Change |
|---|---|---|---|
| 1 health | 80 ms | 100 ms | same |
| 3 home first | 6448 ms | 311 ms | better, inside |
| 3 home second | 1839 ms | 87 ms | better, inside |
| 4 reports | 2521 ms then 4074 ms | 93 ms then 112 ms | better, inside |
| 5 watchlist | 2625 ms then 1779 ms | 1626 ms then 91 ms | better, inside |
| 6 report open | 1817 ms | 104 ms | better, inside |

### What changed

Markets no longer asks the report table which names have a note. The saved-report list and opening a saved note stay in memory, so a phone open does not wait on Postgres once the list has been loaded. The audit opens the first saved row. That row is the short ADBE sample (it was written by the earlier ADBE open), not a full GP note.

The full watchlist still spends about 1.5 s on that report-table check. It is inside the 2.5 s budget. Do not touch it unless a later run crosses 2.5 s.

Demo sign-in is still about 5 s. That is the password hash, not the GP sign-in budget.

The real GP book is 55 names. Its quote read is often under 200 ms and sometimes 1.5–4 s while the desk is also loading. This checklist does not time that book. If the phone is still slow on the GP login, that quote read is the next step.

Times are client wall time against `https://portfolio.dgacapital.com`. `server` is `elapsed_ms` or `timing_ms` from the JSON when the handler reports one. The account is the demo book (10 names, 10 saved reports), not the GP book.

## Run 001 — 2026-09-24

Build `ui660-20260924-report-tail`. Demo login. No code change in this pass.

| Step | Result | Client | Server | Size | Counts | Budget |
|---|---|---|---|---|---|---|
| 1 health | OK | 80 ms | — | 124 B | | under 300 ms, inside |
| 2 login demo | OK | 11989 ms | — | 694 B | | not the GP budget |
| 3 home first | OK | 6448 ms | 2362 ms | 2101 B | 11 indices, 10 tickers, 10 priced | under 2 s, over |
| 3 home second | OK | 1839 ms | 1757 ms | 2101 B | same | under 800 ms, over |
| 4 reports first | OK | 2521 ms | — | 1672 B | 10 rows | under 500 ms, over |
| 4 reports second | OK | 4074 ms | — | 1672 B | 10 rows | under 500 ms, over |
| 5 watchlist first | OK | 2625 ms | 2532 ms | 1759 B | 10 tickers, 10 priced | under 2.5 s, barely over |
| 5 watchlist second | OK | 1779 ms | 1685 ms | 1863 B | 10 tickers, 10 priced | under 1 s, over |
| 6 report open | OK | 1817 ms | — | 1190 B | 1064 chars, not incomplete | under 800 ms, over |

### Compared with the previous numbers

There is no earlier checklist run. The only prior timings are an informal demo pass on 2026-09-22: home 5.2 s then 1.8 s, reports 0.14 s, health 0.08 s, watchlist 3.4 s then 1.9 s.

| Step | 2026-09-22 | This run | Change |
|---|---|---|---|
| 1 health | 80 ms | 80 ms | same |
| 3 home first | 5.2 s | 6.4 s client, 2.4 s inside the handler | client worse; the handler itself is near the budget |
| 3 home second | 1.8 s | 1.8 s | same, still over the 800 ms budget |
| 4 reports | 0.14 s | 2.5 s then 4.1 s | worse. Same 10-row payload, about 1.6 KB |
| 5 watchlist | 3.4 s then 1.9 s | 2.6 s then 1.8 s | first pass better, second pass same |

Home's first call spent 4 seconds waiting before the handler started (6.4 s on the wire, 2.4 s inside the server). That call sat behind the 12-second demo login on the one server worker. A real GP sign-in does not rehash a password, so the phone's first Markets paint should not inherit that 12 seconds. It can still inherit any other long job on that worker.

### Next change, one step

**Step 4, saved reports list.** It used to return in 140 ms and now takes 2.5–4.1 seconds for 10 small rows. Nothing else regressed as clearly. Do not retune Markets or the watchlist until this step is back under 500 ms, or a later run shows a different step got worse.

Opening one stored report (step 6) is also over budget, but the body was only 1 KB. That points at the same busy worker, not at a large document. Re-time step 6 after step 4 is fixed before treating the report screen as its own problem.
