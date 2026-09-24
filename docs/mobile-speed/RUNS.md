# Mobile speed runs

Newest run first. Each block comes from `python3 docs/mobile-speed/measure.py`. The steps are defined in `CHECKLIST.md`. Do not renumber them.

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
