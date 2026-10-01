# Merger arb analysis

A separate page from the main desk. The desk is unchanged. The only link into this page is **Merger Arb** in the research nav.

Open it at `/gp/merger-arb`. A deal opens at `/gp/merger-arb/analysis/:dealId`. Sign in as a GP. With no `DATABASE_URL`, the sample deal `fixture-acme` is loaded. That sample is not a live deal. Its sources use `example.invalid`.

## Workflow

1. Pick a deal, or add one with a target ticker and an acquirer ticker.
2. **Deep dive** runs only when you click it. The page shows Grok or Claude before the click and calls only that provider. There is no paid fallback. Live web search is off. The app sends the deal record plus prices, SEC filings, and Yahoo headlines it fetched itself.
3. The reply must be one JSON packet. Invalid JSON is repaired once. A number with no source, or a source that was not in the bundle, is marked `UNVERIFIED` and left out of the math.
4. Code computes the offer value, spread, annualized return, implied probability, and the sensitivity table, then saves a version.
5. **Refresh with Local Model (free)** calls `gpt-oss-20b-finance` through the existing `LOCAL_LLM_*` settings (`LOCAL_LLM_BASE_URL`, default `http://localhost:11434/v1`). It never calls Grok or Claude. If Ollama is down, the page gets that error and stops.
6. The app fetches a fresh bundle first. The model only sees that bundle and the packet. It may refresh, confirm, or flag each field on the list. It may not change a judgment or a `model_estimate`.
7. Code applies the allowed updates, recomputes, scores freshness, and saves the next version with a field diff. **Refresh complete** appears only when every refresh field has a status, stale core inputs are flagged, derived fields were recomputed, refreshed values kept a bundle source and date, and no judgment changed.
8. **Ask a follow-up** uses the same local model. Answers cite field ids. If the packet does not contain the answer, the model says `not in packet, escalate to Deep Dive` and the page shows that button. The button runs the deep dive you already selected.

## Packet

Every fact is a sourced value: `id`, `value`, `unit`, `source` (`type`, `name`, `url`, `locator`), `pulled_at`, `as_of`, `freshness_class`, `confidence`, `notes`. Times are stored in UTC and shown in Pacific time.

Source types: `market_data`, `sec_filing`, `press_release`, `regulator`, `news`, `company_ir`, `derived`, `model_estimate`. `model_estimate` is only for a labeled judgment such as the break price. It needs a rationale and input field ids. `derived` is written by code.

`packet_meta` stores `deal_id`, `version`, `model`, `created_at`, `stage` (`deep_dive` or `local_refresh`), and `parent_version`.

`stage1_notes` are the deep dive's judgments, each tied to field ids. A refresh may reword the sentence. It may not change the field ids or the estimate.

The nine sections are Deal overview, Spread and implied probability, Deal structure, Regulatory path, Shareholder votes, Key catalysts, Downside if the deal breaks, Upside on close, and Sources.

## What feeds each field

| Fields | Source |
| --- | --- |
| Target, acquirer, and peer prices | `market_data.get_quotes` (Yahoo chart, Tiingo only if a key is set) |
| Offer, ratio, collar, fees, financing, votes, close, outside date | SEC submissions JSON `https://data.sec.gov/submissions/CIK##########.json`, forms 8-K, DEFM14A, PREM14A, S-4, SC TO, 425, DEFA14A, and their amendments |
| Headlines and bump talk | Yahoo Finance RSS via `api/domains/yahoo_finance_news.py` |
| Break price, CVR estimate, stage-1 notes | The deep-dive model, labeled `model_estimate` or a note. Refresh does not replace them |
| Offer value, spread, annualized return, implied probability, downside, upside, sensitivity | Computed in `merger_arb/calc.py` from the sourced inputs |

An empty price or a failed filing fetch is an error on the bundle. It is not filled in.

## Math

`P` is the target price, `V` is the offer value, `D` is the break price, `T` is years to the expected close.

- Cash: `V = cash`. Stock: `V = ratio × acquirer price`. Mixed: cash plus the stock leg. Election uses the cash fraction (0.5 if it is missing).
- Fixed-value collar: inside the band, `V` is the collar value. Above the high, `collar value / high × price`. Below the low, `collar value / low × price`.
- Fixed-ratio collar: inside the band, `ratio × price`. Outside, `ratio ×` the breached bound.
- A price outside the walk-away bounds is flagged. The offer is still computed.
- Gross spread: `V − P` and `(V − P) / P`.
- Annualized: `(1 + S) ^ (1 / T) − 1`, and the simple form `S / T`. `S` includes expected dividends.
- Implied probability: `(P − D) / (V − D)`, held between 0 and 1. Warn if `D ≥ P` or `V ≤ P`.
- Derived values keep the oldest input time and the strictest freshness class. An unverified input is skipped until you confirm it.

## Freshness

Hours, override with `MERGER_ARB_FRESHNESS_JSON` as a JSON object of class to hours. `null` means never.

| Class | Examples | Default | Also stale when |
| --- | --- | --- | --- |
| market | Prices, peer index | 26 hours | The next 16:00 America/New_York close after the pull has passed |
| event | Status, catalysts, votes, expected close, proxy recommendations | 7 days | A new filing or headline is on the bundle and the field was not refreshed |
| terms | Offer, ratio, collar, fees, financing | 30 days | An amendment, 8-K, DEFM14A, or S-4 is the new filing |
| static | Announced date, parties, unaffected price | never | A correction is flagged |

The header badge is **Stale** when the target price, offer value, or break price is red or unverified. It is **Partly stale** when any other dot is not green. Otherwise **Fresh**. Dots turn amber in the last 20% of the time limit.

## Local model

`MERGER_ARB_LOCAL_CTX_TOKENS` defaults to 8192 and is capped at 32768. Ollama `num_ctx` is set to that value. About 25% of the window is left for the reply. Temperature is 0. Invalid JSON is retried once.

Chunks follow this order, oldest `pulled_at` first inside each group: market prices, deal terms, regulatory status, shareholder vote, catalysts, expected close and outside date, downside inputs (peer move only), sources. Each call gets `packet_meta`, a short deal header, that group's fields, and only the fresh data for the group. Updates are merged before the next call. Filings and articles are trimmed to excerpts. If anything is cut, the page says so.

The local system prompt is stored verbatim in `merger_arb/prompts.py` as `LOCAL_RULES`. Follow-up calls append one line, `ASK_JSON`, asking for `{"answer","citations","escalate"}`.

## API

All routes are under `/api/merger-arb` and require a GP session. Demo accounts cannot POST. That is intentional.

- `GET /deals`, `POST /deals`
- `GET /analysis/:dealId`
- `POST /analysis/:dealId/deep-dive` with `{"provider":"grok"}` or `"claude"`
- `POST /analysis/:dealId/confirm` with `{"field_id":"..."}`
- `POST /analysis/:dealId/refresh`
- `POST /analysis/:dealId/ask` with `{"question":"..."}`
- `GET /analysis/:dealId/export?format=md` or `json`

Versions, field values, sources, and flags are stored in `merger_arb_deals`, `merger_arb_packet_versions`, `merger_arb_field_values`, `merger_arb_sources`, and `merger_arb_flags` when `DATABASE_URL` is set. Otherwise they stay in memory for the process.

## Tests

```bash
python3 -m pytest tests/test_merger_arb_calc.py tests/test_merger_arb_fixture.py tests/test_merger_arb_deep.py tests/test_merger_arb_refresh.py tests/test_merger_arb_ask.py -q
```

The model and the network are fakes in these tests. A deep dive or a refresh on a live deal spends a cloud call or needs Ollama, and only happens when you click the button.

## Sample local budget

On the sample packet, with one price, one 8-K excerpt, and one headline, the default 8192-token window splits the refresh into 8 calls. Token counts are `len(text) / 4`, not a tokenizer. Nothing was cut. The largest call is the terms group.

| Group | Fields | Estimated input tokens |
| --- | --- | --- |
| Market prices | 2 | 964 |
| Deal terms | 20 | 2605 |
| Regulatory | 5 | 1313 |
| Shareholder vote | 6 | 1379 |
| Catalysts | 4 | 1200 |
| Expected close | 5 | 1295 |
| Downside inputs | 2 | 914 |
| Sources | 2 | 1121 |

About 10,800 input tokens across the eight calls. The rules themselves are about 390 tokens, and each call leaves roughly 2,048 tokens for the reply. `gpt-oss-20b-finance` is installed in Ollama on this Mac and was not loaded, so this pass did not time a live refresh.
