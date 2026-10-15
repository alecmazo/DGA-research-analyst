# Fund City feed

Read-only JSON for DGA Fund City, Alec Mazo's Unreal client. Each holding is a building. Each GICS sector is a district. The feed is the same positions book as the Portfolio Ship page (`GET /api/v2/gp/portfolio-ship`): managed accounts and LP funds, stake already applied, one row per symbol.

This document is the contract. `schema_version` is `1.0`. Do not rename the path or the fields below. Clients must ignore unknown fields.

The visual Portfolio City scene (`api/domains/portfolio_city.py`, `GET /api/v2/gp/portfolio-city`) is a different payload and stays unmounted. Fund City does not call it.

Shipping the branch does not deploy production. Once it is released, the live URL is:

`GET https://portfolio.dgacapital.com/api/v2/gp/fund-city`

Optional query: `privacy=auto` (default), `privacy=weights`, or `privacy=dollars`. `dollars` does not override a hide decision. There is no other parameter.

## Auth

Machine clients send a bearer token. Interactive GP sessions also work. An LP session is refused (403) so a partial LP book is never presented as the fund.

### Env var

`FUND_CITY_FEED_TOKEN` on the API process that serves portfolio.dgacapital.com (the same Railway service as `TOKEN_SECRET`).

- At least 24 characters.
- Placeholder values (`changeme`, `your_token_here`, `replace-with-a-random-token`, `fund-city-feed-token`) never authorize.
- If the variable is unset or too short, machine access is off. A GP login still works.
- The value is a secret. It sees the live GP book, the same book as Alec's login. Do not commit it, put it in a query string, or paste it into the Unreal project if that tree is shared.

### How Alec issues a token

There is no mint endpoint. Issuing means generating a secret and placing it in two environments.

1. Generate a value and do not write it into git:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. On Railway, open the service that hosts `portfolio.dgacapital.com`. Add variable `FUND_CITY_FEED_TOKEN` with that value. Saving the variable redeploys the service. The feed rejects the token until that process is up.

3. On the PC that runs the local Python server, set the same value in the environment the server starts with (a shell export or a local env file that is gitignored). Not in the game's committed config.

4. Rotate by generating a new value, updating Railway and the PC, and letting Railway redeploy. The old value stops working when the new process is live. The token does not expire on its own.

### Request headers

Either header works. Do not send the token as `?token=`.

```bash
curl -sS \
  -H "Authorization: Bearer $FUND_CITY_FEED_TOKEN" \
  "https://portfolio.dgacapital.com/api/v2/gp/fund-city"
```

```bash
curl -sS \
  -H "x-fund-city-token: $FUND_CITY_FEED_TOKEN" \
  "https://portfolio.dgacapital.com/api/v2/gp/fund-city"
```

A logged-in GP can call the same path with `x-auth-v2-token` from `POST /api/auth/v2/login`. That session lasts 12 hours (`auth_v2`). Use it for a manual check. The game loop should use `FUND_CITY_FEED_TOKEN`.

The feed token is not accepted on any other path.

### Status codes

| Code | Meaning |
|---|---|
| 200 | Payload below. Check `provenance.book_status` before replacing the city. |
| 400 | `privacy` is not `auto`, `weights`, or `dollars`. |
| 401 | No GP session and no valid feed token. |
| 403 | Signed in, but not a GP or admin. |

Poll every 30 seconds or slower. The API reuses a successful book for 25 seconds, the same window as other GP responses.

## Privacy

The hide/show bit is `decide_privacy` in `api/domains/portfolio_city.py`, the same function Ship and City use.

The feed token is a non-demo GP. **Default response includes dollar values** (NAV, cash, market value, and shares) plus weights.

Dollars are withheld, and the payload is weights only, when any of these is true:

| Condition | `provenance.withheld_reason` |
|---|---|
| `?privacy=weights` | `privacy=weights` |
| `PORTFOLIO_CITY_PUBLIC=1` on the server | `PORTFOLIO_CITY_PUBLIC` |
| Demo session (`demo_mode`) | `demo_mode` |

A demo login still resolves, but it is the synthetic demo book and `is_live` is false. The feed token is never demo.

When dollars are withheld:

- `fund.nav`, `fund.cash`, `holdings[].market_value`, and `holdings[].shares` are `null`.
- `holdings[].weight` and `fund.cash_weight` stay. `weight` is a fraction of the book from 0 to 1, not a percent. The fractions sum to 1.
- `holdings[].market_cap` stays. That number is the public company market cap (the figure Ship draws), not the position. Cash and CUSIPs never carry one. It is safe to size a building from it in weights mode.

`provenance.show_dollars` is true only when those position fields are numbers.

`provenance.book_status`:

| Value | What the game should do |
|---|---|
| `ok` | Draw this snapshot. |
| `empty` | The book loaded and had nothing with a positive value. `nav` and `cash` are `0` when dollars are allowed. |
| `unavailable` | The book did not load. Keep the previous snapshot. `nav` is `null` even for a GP. This is not an empty fund. |

## Response

Schema checked in tests: `tests/fixtures/fund_city/fund-city.schema.json`. The fixture book is synthetic. Do not replace it with a live export.

### Redacted example

Synthetic round numbers, not a DGA book. Dollars mode (`show_dollars: true`):

```json
{
  "schema_version": "1.0",
  "ok": true,
  "fund": {
    "as_of": "21:00 UTC",
    "book_as_of": "2026-10-07",
    "generated_at": "2026-10-13T16:00:00Z",
    "nav": 100.0,
    "cash": 10.0,
    "cash_weight": 0.1,
    "currency": "USD",
    "holdings_count": 2
  },
  "holdings": [
    {
      "ticker": "TSLA",
      "name": "Tesla Inc",
      "sector": "Consumer Discretionary",
      "story_part": "bridge",
      "story_name": "Technology (core)",
      "shares": 4.0,
      "market_value": 90.0,
      "weight": 0.9,
      "currency": "USD",
      "market_cap": 88000000013,
      "flags": {
        "cash": false,
        "index_fund": false,
        "gse_preferred": false,
        "gse_common": false,
        "bond_cusip": false,
        "preferred": false,
        "non_equity": false
      }
    },
    {
      "ticker": "SPAXX",
      "name": "Sample Gov MM",
      "sector": "Cash",
      "story_part": "anchor",
      "story_name": "Cash / Money market",
      "shares": 10.0,
      "market_value": 10.0,
      "weight": 0.1,
      "currency": "USD",
      "market_cap": null,
      "flags": {
        "cash": true,
        "index_fund": false,
        "gse_preferred": false,
        "gse_common": false,
        "bond_cusip": false,
        "preferred": false,
        "non_equity": true
      }
    }
  ],
  "provenance": {
    "source": "Positions book across managed accounts and LP funds, stake already applied. Same book as Portfolio Ship. Sector is GICS from portfolio_classify. Story part is the Ship grouping. Public market cap is not a position value.",
    "is_live": true,
    "is_demo": false,
    "privacy": "dollars",
    "show_dollars": true,
    "withheld_reason": null,
    "book_status": "ok"
  }
}
```

The same book with dollars withheld. Excerpt — every other field is unchanged:

```json
{
  "fund": {
    "nav": null,
    "cash": null,
    "cash_weight": 0.1,
    "currency": "USD"
  },
  "holdings": [
    {
      "ticker": "TSLA",
      "shares": null,
      "market_value": null,
      "weight": 0.9,
      "market_cap": 88000000013
    }
  ],
  "provenance": {
    "is_live": true,
    "is_demo": false,
    "privacy": "weights",
    "show_dollars": false,
    "withheld_reason": "privacy=weights"
  }
}
```

## Field notes for Fund City

Map the feed into the game's schema as follows.

### Fund

| Game | Feed | Notes |
|---|---|---|
| as_of | `fund.book_as_of`, `fund.as_of`, `fund.generated_at` | `book_as_of` is the brokerage mark date. `as_of` is the book's clock stamp, often `HH:MM UTC`. `generated_at` is when this payload was built, UTC `YYYY-MM-DDTHH:MM:SSZ`. |
| NAV | `fund.nav` | Stake-adjusted market value of the whole book, including cash. Same figure Ship calls `total_value`. `null` when dollars are withheld or the book is unavailable. `0` only when a loaded book is empty. |
| cash | `fund.cash` | Sum of money-market and cash lines (SPAXX, FZDXX, CASH, and the other par symbols Ship treats as the anchor). `null` under the same rules as NAV. `fund.cash_weight` is the fraction of the book in those lines and is always a number. |
| currency | `fund.currency` | Always `USD`. |

### Holdings

Rows are rolled up by normalized ticker across accounts. Account names, cost, and fund ids are not included. A line with no positive market value is omitted. Order is weight descending, then ticker.

| Game | Feed | Notes |
|---|---|---|
| ticker | `holdings[].ticker` | Uppercased. A trailing `*` and a leading `$` are stripped, matching Ship. |
| name | `holdings[].name` | GICS hand-map name when `portfolio_classify` has one. Otherwise the name on the book. |
| sector (GICS) | `holdings[].sector` | `classify()` in `api/domains/portfolio_classify.py`. This is the district key for a plain equity. One of the GICS sectors, or `Cash`. |
| shares | `holdings[].shares` | Stake-adjusted quantity (`total_qty` on the positions book), summed across accounts. `null` when the book has no quantity, and `null` whenever dollars are withheld (quantity times a public price rebuilds the position). For cash, quantity is par units, which equals dollars at $1. |
| market_value or weight | `holdings[].market_value`, `holdings[].weight` | `market_value` is USD notionally, `null` when dollars are withheld. `weight` is always present: a fraction of NAV in `[0, 1]`, not a percent. Use `weight` when `market_value` is null. |
| currency | `holdings[].currency` | Always `USD`. |

`holdings[].market_cap` is extra and public. Size the building from it when it is non-null. A miss stays `null` (Ship draws that as a modest building). It is not the position.

### Provenance

| Game | Feed |
|---|---|
| source | `provenance.source` |
| is_live | `provenance.is_live` — true only when this caller is not demo and the book loaded |
| is_demo | `provenance.is_demo` |
| privacy mode | `provenance.privacy` is `dollars` or `weights`. `provenance.show_dollars` says whether this snapshot actually contains position dollars. `provenance.withheld_reason` says why it does not. |

### Districts, story parts, and special buildings

`sector` is the GICS district. `story_part` is the Ship sleeve (`bridge`, `bow`, `stern`, `anchor`, `market`, and the rest of Ship's draw order). `story_name` is that sleeve's label. The stable id is `story_part`. Names can be edited in Ship without a schema bump; do not key art off `story_name`.

Ship does not follow GICS for a few sleeves. Tesla's sector is Consumer Discretionary and its story part is `bridge`. GSE commons and preferreds are Financials and story part `stern`. Cash is sector `Cash` and story part `anchor`.

Symbols the hand map does not list fall back to sector Industrials inside `classify()`. Story part for those names can follow a sector lookup, the same hook Ship uses. The GICS field does not. SPY is flagged `index_fund` and its story part is `market`, but its sector stays the Industrials fallback until someone adds it to the hand map.

Use the flags to draw those lines differently. Do not park an index fund or a CUSIP in the Industrials district just because `sector` says so.

| Flag | Draw as |
|---|---|
| `flags.cash` | Civic plaza / anchor, not a tower. Also the fund-level cash sum. |
| `flags.index_fund` | Index sleeve. True for SPY, IWM, QQQM, QQQ, VOO, VTI, IVV, and any story part `market`. |
| `flags.gse_common` | FMCC and FNMA commons. Equity towers. Story part `stern`. |
| `flags.gse_preferred` | Freddie/Fannie preferreds (FMCCJ, FMCCS, FNMAP, and the other Ship GSE lines that are not the two commons). |
| `flags.preferred` | Any preferred, including GSE preferreds and names such as NLYPRF. Not the two GSE commons. |
| `flags.bond_cusip` | A symbol whose first character is a digit after normalization (CUSIP). No market cap. |
| `flags.non_equity` | Cash, CUSIP, or preferred. Index funds are not marked non-equity; use `index_fund`. |

Suggested district: if `flags.cash` then Cash; else if `flags.index_fund` then the index sleeve; else if `flags.bond_cusip` then a credit lot; else `sector`. Size from `market_cap` when present, and from `weight` when the cap is null.

## Stability

Grok Build: see the short section in `docs/GROK_BUILD_GRAPHIC_HANDOFF.md`. The path, `schema_version`, and the field names in this file stay. Adding a field is allowed. Renaming or dropping one is a new schema version and a doc change in the same PR.
