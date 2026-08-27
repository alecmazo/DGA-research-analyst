# DGA Capital — Continuity handoff

**Read this first** on any machine (Grok Build, Claude Code, Cursor) before
bumping UI versions or rewriting nav. Prevents counter collisions when the
same repo is worked on the Mac mini at home, a laptop, and Railway deploys.

---

## Canonical build counter

| Field | Value |
|-------|--------|
| **Source of truth** | `WEB_BUILD_VERSION` in `api/server.py` |
| **Live probe** | `GET https://portfolio.dgacapital.com/api/build` → `{"build":"uiNNN-…"}` |
| **Format** | `ui{N}-{YYYYMMDD}-{short-slug}` |
| **Rule** | **Never decrease N.** Next deploy = `max(N in this file, N on /api/build, N in git history comments) + 1`. |

### Current sequence (as of this handoff)

| When | Build | Notes |
|------|--------|--------|
| Product line (Mac mini / main history) | **ui377** (comments) … through mid-2026 | Real product counter used in HTML/JS comments (`ui340`, `ui353`, `ui361`, `ui377`) |
| This Grok session (work laptop) | ui100–ui114 | **Fork counter — must not overwrite higher N** |
| Nav + continuity files | **`ui378-20260728-nav-continuity`** | Nav reorg + CONTINUITY.md |
| **Settings handoff button** | **`ui379-20260728-continuity-button`** | Settings → Continuity handoff (copy/download) |
| **Builder sector boards** | **`ui380-20260728-builder-boards`** | Multi-list sector boards + breadth history |
| **Report history / thesis deltas** | **`ui381-20260728-report-history`** | Re-Analyze archives prior; Saved Reports vN + Δ; timeline; Value Rank self-history |
| **Desk X FinTwit card** | **`ui382-20260728-x-fintwit-feed`** | Free FinTwit feed via X public syndication · $0 API |
| **Builder tracking table** | **`ui383-20260728-builder-tracking`** | Names, cost basis, since-add %, date first added, notes/FV, sort/filter |
| ui384–ui387 | FAILED healthchecks | Thin-ASGI / rollbacks — do not re-ship as-is |
| **Boot + pool health** | **`ui388-20260729-boot-pool-health`** | ui383 product + defer import DB work; fix pool leak; larger pool; post-listen workers |
| **Analyze + mobile** | **`ui389-20260730-analyze-mobile-mcap`** | LLM heartbeats; job poll 404 recovery; v1→GP claims for Financials; Yahoo mcap fill |
| **Watchlist speed** | **`ui390-20260730-watchlist-fast`** | Drop FinTwit card; fast quote path (cache/store/Yahoo only); no earnings block on GET /api/watchlist |
| **Watchlist unhang** | **`ui391-20260731-watchlist-unhang`** | Hard 6–7s quote walls; always return tickers; client 12s abort; store fallback without age |
| **Executor hang root fix** | **`ui392-20260731-executor-hang-fix`** | Never `with ThreadPoolExecutor` after timeout (shutdown wait=True froze watchlist); migration lock |
| **Reports + idea feed fast** | **`ui393-20260731-reports-idea-fast`** | list_reports: no Dropbox/Yahoo on hot path; idea-feed stop force spam; load reports on init |
| **DB lock clear** | **`ui394-20260731-db-lock-clear`** | Hydrate no longer holds txn across Dropbox; no length(report_md) on list; idle_in_txn timeout 15s |
| **Report DB upsert reliability** | **`ui395-20260731-report-db-upsert-retry`** | Fresh-conn + SSL retries; True only after commit; ROKU recovery |
| **Watchlist earnings chips restored** | **`ui396-20260731-watchlist-earnings-chips`** | Nasdaq calendar chips back on Desk watchlist (cached, ≤4s) |
| **Claude Opus 5 default** | **`ui397-20260731-claude-opus-5`** | CLAUDE_MODEL/AGENTIC → claude-opus-5; labels + pricing |
| **Analyze uses Financials DB** | **`ui398-20260731-financials-db-primary`** | PRIMARY from company_financials; fix FY mislabel (ROKU) |
| **SEC 10-Q into Analyze PRIMARY** | **`ui399-20260731-sec-10q-into-analyze`** | Merge live 10-Q earnings with DB annuals; upsert store |
| **Claude Opus 5 empty report fix** | **`ui400-20260731-claude-opus5-empty-fix`** | 64k max_tokens + empty/max_tokens retry (FOXA ticket) |
| **Claude Analyze speed** | **`ui401-20260731-claude-report-speed`** | Opus 5: thinking off + medium effort for reports; honest progress |
| **Grok 90d catalysts + Munger 8.5** | **`ui402-20260731-grok-news-munger`** | Free headlines + live search reinforce; Grok-only Munger latticework |
| **Fast financials for Analyze** | **`ui403-20260801-fast-financials-db`** | DB first; SEC Excel hard-timeout; no multi-min 429 wait |
| **DeepSeek V4 Pro default** | **`ui404-20260802-deepseek-v4-pro`** | deepseek-chat → deepseek-v4-pro everywhere |
| **Rename DGA_analyst** | **`ui405-20260802-dga-analyst-rename`** | claude_analyst.py → DGA_analyst.py (multi-LLM core) |
| **Compare 3 engines + DeepSeek EDGAR** | **`ui406-20260802-compare-deepseek-edgar`** | Desk+Lab multi-pane compare (Grok/Claude/DeepSeek/Kimi); DeepSeek-only live EDGAR financials |
| **Settings drop both card** | **`ui407-20260802-settings-drop-both-card`** | Remove yellow Grok+Claude (both) provider card from Settings |
| **EDGAR-first + Kimi + BS** | **`ui408-20260802-edgar-first-kimi-bs`** | All engines live SEC Excel primary; enable Kimi Analyze; mandatory §5C balance sheet structure |
| **EDGAR retry + Kimi stream** | **`ui409-20260802-edgar-retry-kimi-stream`** | SEC lock+retry (Grok rate-limit miss); Kimi stream+HTTP timeout (was 900s hang) |
| **Security: email + secrets** | **`ui410-20260802-security-email-auth`** | Strip seed plaintext pw comments; auth on YTD email; fail-closed weak secrets; mask emails/keys in logs/diag |
| **Fin nightly Excel + 8-K flag** | **`ui411-20260802-fin-nightly-excel`** | Nightly/monthly also pull latest 10-K/10-Q Excel; flag earnings 8-K pending 10-Q; per-ticker refresh |
| **Nightly updated on store card** | **`ui412-20260802-nightly-updated-card`** | Financials store card lists tickers with new 10-Q/10-K from last nightly |
| **GP change password Settings** | **`ui413-20260803-gp-change-password`** | Clear GP-only password change card on Settings → Security |
| **Daily Pulse live prices** | **`ui414-20260803-daily-brief-live-prices`** | Inject verified Yahoo quotes into Daily Brief prompt — stop LLM inventing prices |
| **Daily Pulse price enforce** | **`ui415-20260803-daily-brief-price-enforce`** | Prompt + rewrite invented $ + visible VERIFIED LIVE PRICES table in output |
| **Daily Pulse hide price table** | **`ui416-20260803-daily-brief-no-price-table`** | Keep live-price correctness; stop showing duplicate VERIFIED LIVE PRICES table |
| **Daily Pulse YOUR BOOK format** | **`ui417-20260805-daily-book-format`** | One ticker per line + Quiet group; post-normalize garbled preferred dumps (SUP_20260805) |
| **Earnings actual revenue 8-K** | **`ui418-20260805-earnings-rev-8k`** | Fill Actual Revenue from Item 2.02 ex99 when Yahoo income stmt lags (TREX etc.) |
| **Builder since-add %** | **`ui419-20260805-builder-since-add`** | Cost basis = initiation-day close (not live); repair 0% boards (SUP_20260805) |
| **Options held first** | **`ui420-20260805-options-held-first`** | Wheel: held names first; show shares/contracts + premium you can write (SUP_20260805) |
| **SEC ticker map cache** | **`ui421-20260805-sec-ticker-map-cache`** | Fix ui418-era SEC 429 stampede: load company_tickers once; cap 8-K concurrency |
| **Watchlist morning day %** | **`ui422-20260806-watchlist-morning-pct`** | Closed/pre-market: prior = bar before session close (not same bar → fake 0%) |
| **GP React+TS shell** | **`ui423-20260806-gp-react-shell`** | Replace /gp with Vite React TypeScript shell; legacy at /gp-legacy |
| **GP React all tabs** | **`ui424-20260806-gp-react-all-tabs`** | Port Desk/Options/Builder/Financials/Positions/Fund/Memos/Podcasts/Transcripts/Settings |
| **Analyst / Strategist answer window** | **`ui452-20260812-research-answer-window`** | Finished Analyst + Portfolio Strategist answers open in a chrome-less window like Saved Reports |
| **Research PDF matches window** | **`ui453-20260812-research-pdf-match-window`** | Analyst/Strategist PDF uses Inter, window header/question strip, navy zebra tables |
| **PDF letterhead restored** | **`ui454-20260812-research-pdf-restore-letterhead`** | Keep pre-ui453 DGA masthead; keep Inter body + navy tables |
| **PDF tables content-sized** | **`ui455-20260812-pdf-smart-table-cols`** | Research/IC PDF columns size from cell text — short cols tight, prose gets leftover |
| **PDF tables no bleed** | **`ui456-20260812-pdf-table-no-bleed`** | Drop nowrap; size Inter honestly; ZWSP wrap so cell text cannot paint outside |
| **PDF Name vs Action cols** | **`ui457-20260812-pdf-name-vs-action-cols`** | Name/ticker stay tight; Action sizes to its phrases instead of a chip |
| **Analyst false timeout** | **`ui458-20260812-analyst-no-false-timeout`** | SUP_20260812_c64355e0 — stop 14m client timeout killing a live/saved Analyst run |
| **Fund equal pos/reb cards** | **`ui459-20260812-fund-equal-pos-reb-cards`** | SUP_20260812_9ad006bd — Open Positions and Rebalance Suggestions same height |
| **SnapTrade tax-lot balance** | **`ui460-20260813-snaptrade-taxlot-balance`** | Ledger debit/credit off by $0.0002 aborted tax_lots so Fidelity cash never updated |
| **SnapTrade uninvested cash** | **`ui461-20260813-snaptrade-uninvested-cash`** | Sale proceeds sit in balances.cash minus SPAXX — inject residual CASH lot |
| **Cash / MM always $1** | **`ui462-20260813-cash-par-price`** | Never Yahoo-price CASH (listed ~$86) — NAV/positions force par |
| **Fund table scroll** | **`ui463-20260813-fund-table-scroll`** | Equal-height Positions/Rebalance cards scroll inside the table |
| **Desk Market Wire restored** | **`ui464-20260814-desk-market-wire`** | Free official + wire RSS card back on React Desk |
| **Desk Market Pulse restored** | **`ui465-20260814-desk-market-pulse`** | Watchlist scan card back on React Desk (no auto-run) |
| **Transcript freshness + top-up** | **`ui466-20260814-transcript-topup`** | Use latest quarter when call_date is blank; top-up stale names |
| **Transcript top-up is free** | **`ui467-20260814-transcript-topup-free`** | Fool/FMP/AV only; skip unreported current quarter; no Grok |
| **Desk static tape + compact chrome** | **`ui468-20260817-desk-static-tape`** | SUP_20260817_fc0ccc2a — no marquee; ribbon+watchlist same 45s clock; Desk+watchlist one row |
| **Market Pulse movers first** | **`ui469-20260817-pulse-movers-first`** | Pulse list ranked by |day %| like the watchlist |
| **Desk trim pulse + ideas** | **`ui470-20260817-desk-trim-pulse-ideas`** | Drop toolbar Daily Pulse; hide Idea Generator card |
| **No FREE badges** | **`ui471-20260818-no-free-badges`** | Price only when LLM is used; drop “free” on wire/financials/reports |
| **Watchlist earnings 14d** | **`ui472-20260818-watchlist-earn-14d`** | Chips look 14 days ahead; don’t cache failed Nasdaq days as empty |
| **Desk watchlist peek card** | **`ui473-20260818-desk-watchlist-peek`** | Click a Desk ticker → same stock-info card as mobile |
| **Snapshot fact sheet** | **`ui474-20260818-snapshot-factsheet`** | Watchlist peek: range bar + labeled rows, no stat boxes |
| **Builder boards first** | **`ui475-20260819-builder-boards-first`** | Track boards is the default tab; Construct basket is second |
| **Claude reports + Fund SPY YTD** | **`ui476-20260820-claude-reports-spy-ytd`** | Claude Analyze persist; Fund SPY YTD |
| **Pulse DeepSeek-only** | **`ui477-20260820-pulse-deepseek-only`** | Daily Pulse + Market Pulse never fall back to Grok |
| **Analyze all engines one job** | **`ui479-20260821-analyze-multi-engine`** | Selected engines run sequential in one job |
| **Claude reuse + DeepSeek 402** | **`ui480-20260821-claude-reuse-ds402`** | Claude NameError on reuse cache; name DeepSeek 402 |
| **Automation in Models** | **`ui481-20260822-models-automation`** | Move automation into Models; retire Idea Generator |
| **Mobile morning quotes** | **`ui482-20260822-mobile-morning-quotes`** | Refresh watchlist quotes on first morning open |
| **Watchlist calendar YTD** | **`ui483-20260823-watchlist-ytd`** | YTD on WMT and other names with a tape |
| **DGA Scored board** | **`ui484-20260823-dga-scored-board`** | Track board: top 30 DGA score strictly above 90 |
| **YTD + this-year IPO mark** | **`ui485-20260823-ytd-ipo-mark`** | CART/MGM/NET YTD; CBRS/SKHY IPO marker |
| **Builder board hover/click** | **`ui486-20260824-board-hover-click`** | Hover name → snapshot; click → Financials |
| **Score weights + hover follow** | **`ui487-20260824-score-hover-follow`** | Restore DGA weights (BKNG 500); hover follows row outside peek |
| **No Reuters on Market Wire** | **`ui488-20260824-no-reuters`** | Cut Reuters RSS / bylines from Market Wire |
| **One signed chart series** | **`ui489-20260824-signed-charts`** | FCF/OCF; drop duplicate (neg) legend chips |
| **Bar color = legend** | **`ui490-20260825-bar-legend-color`** | Bars keep series color above and below zero |
| **Price chart hover** | **`ui491-20260825-price-hover`** | Financials price history: hover date → close |
| **Report print** | **`ui492-20260825-report-print`** | Print on saved report window; print CSS matches on-screen |
| **Report share PDF** | **`ui493-20260825-report-share-pdf`** | Share emails the saved report as a PDF matching that window |
| **Financials hover stays on screen** | **`ui494-20260825-fin-chart-tip-flip`** | Chart/price tips flip left so right-side bars are fully readable |
| **Foundation analysis scene** | **`ui495-20260825-foundation-analysis-scene`** | Imagine Vault/Prime Radiant graphic while Grok/Claude/agent jobs run |
| **Grok tool-dump reports** | **`ui496-20260825-rivn-grok-tool-dump`** | Don’t show/save live-search traces as a report (RIVN); fall back to a real engine |
| **Print + analysis loop** | **`ui497-20260826-print-and-analysis-loop`** | Saved-report print no longer blank; 20s seamless no-human calculation loop |
| **Report print fits the page** | **`ui498-20260826-report-print-fit`** | Tighter print margins; tables wrap so the report does not bleed off letter |
| **Watchlist unhang** | **`ui499-20260826-watchlist-uncouple`** | Desk watchlist no longer waits on Daily Pulse; 4.5s API budget + last-list cache |
| **IPO YTD from print** | **`ui500-20260826-ipo-ytd-from-print`** | This-year IPOs show % since IPO price with a small IPO marker; next year is normal YTD |
| **Handoff pack current** | **`ui501-20260826-handoff-refresh`** | Settings continuity pack: React GP paths, standing rules, ui476–ui500 filled in |
| **Market Wire drop AP** | **`ui502-20260827-wire-drop-ap`** | Cut AP; add EIA/FDIC/ECB + Bloomberg/MarketWatch pulse; block AP bylines |
| **Clean Grok report markdown** | **`ui503-20260827-report-md-clean`** | Unwrap bold-wrapped cover tables; convert prompt ━ SECTION banners to `#` so TSLA matches RIVN |
| **BKNG DGA score + ROIC** | **`ui504-20260827-bkng-dga-score`** | ROIC when book IC ≤ 0 uses assets−cash; neg equity D/E scores 0; hover math on DGA score card |
| **Options after Positions** | **`ui505-20260827-nav-options-after-pos`** | Topbar: Options sits immediately right of Positions |
| **Fund hide CSV uploads** | **`ui506-20260827-fund-hide-csv`** | Manual Data Uploads no longer a Fund card; collapsed CSV backup; SnapTrade is the path |
| **Rebalance live PT upside** | **`ui507-20260827-rebalance-live-pt`** | Fund rebalance upside = Saved Report 12m PT vs live last (not frozen report %) |
| **All-time chart/table** | **`ui508-20260827-alltime-table`** | Managed-account All-Time Performance has Chart | Table like YTD monthly |
| **Neg-equity DGA cap** | **`ui509-20260827-neg-eq-score-cap`** | Negative book: ROE scores 0 (not omitted); profit ≤70, growth ≤75 |
| **Accounts tab** | **`ui510-20260827-nav-accounts`** | Topbar label Fund → Accounts (route still `/fund`) |
| **All-time folds Annual** | **`ui511-20260827-alltime-fold-annual`** | All-Time Performance absorbs benchmark + CAGR/cumulative; Annual card removed |
| **Account cards collapse** | **`ui512-20260827-acct-cards-collapse`** | Monthly-and-below account cards collapsible (open by default); gold Run button |
| **Bench period match** | **`ui513-20260827-bench-period-match`** | All-Time bench column is annual-only; MoM/QoQ stored in Postgres, never copy annual onto months |
| **Dual-engine upside** | **`ui514-20260827-dual-engine-upside`** | Saved Reports: Grok + Claude PT each with live upside; rebalance uses Grok PT; Strategist gets both |
| **Exchange analysis loop** | **`ui515-20260827-exchange-analysis-loop`** | Analyze overlay is a 15s seamless matching-engine backroom loop; unused chamber still removed |
| **Zero-debt strength** | **`ui516-20260827-zero-debt-strength`** | No/untagged debt is fortress: Cash-To-Debt ≥10×, D/E and D/EBITDA 0×; DGA FS 100 |
| **Accounts managed first** | **`ui517-20260827-accounts-managed-first`** | Accounts tab: Managed first, LP Funds second (toggle, KPIs, default view) |
| **Next deploy after this** | **`ui518-YYYYMMDD-slug`** | Always `max(live, this file, BUILD_VERSION) + 1` |

### One-click handoff (preferred)

In the live GP app: **Settings → Continuity handoff → Copy handoff for agent**.

That calls `GET /api/continuity/handoff` and copies a full markdown pack (live
build, git tip, next-N rule, nav layout, embedded `CONTINUITY.md`) to the
clipboard. Paste it into Claude Code / Grok Build / Cursor on any computer.

If Mac mini later ships a higher N while offline, **pull main first**, then set
`WEB_BUILD_VERSION` to `max(local, remote /api/build, CONTINUITY.md) + 1`.

---

## How to bump a build (every agent)

1. Read `CONTINUITY.md` **Current sequence** and curl `/api/build`.
2. Edit `api/server.py`:
   ```python
   WEB_BUILD_VERSION = "uiNNN-YYYYMMDD-slug"
   ```
3. Update the table in this file (append a row under Current sequence).
4. Commit + push `main` (Railway auto-deploys).
5. Poll until `/api/build` shows the new string.

---

## Nav layout (canonical — do not reshuffle casually)

**Work surface** (left of divider):

1. Desk (`research`)
2. Financials (`financials`)
3. Builder (`builder`)
4. Podcasts (`lab`) — *label only; internal tab id stays `lab`*
5. Transcripts (`transcripts`)
6. Positions (`positions`)
7. Options (`options`)

**Firm ops** (right of divider):

8. Accounts (`fund`) — *label only; route stays `/fund`*
9. Memos (`memos`)
10. Settings (`settings`)
11. Sliw (`/sliw/` link, gated)

Ideas tab still exists as `tab-ideas` for deep links / Desk actions; not in topbar.

---

## Open product state (handoff notes)

**Live (2026-08-27):** `ui517-20260827-accounts-managed-first` on Railway `web` (project `upbeat-ambition`). GP is the **React** app at `/gp` (`web/gp-app/`). Legacy HTML lives at `/gp-legacy`.

### Recently shipped (this stream, Aug 23–26)

| Build | Topic |
|-------|--------|
| ui484 | DGA Scored board — top 30 names with score **> 90** |
| ui485–ui500 | Watchlist YTD (WMT/CART/MGM/NET); this-year IPOs % since IPO print + **IPO** marker |
| ui486–ui487 | Builder board hover snapshot (follow pointer outside peek); click → Financials |
| ui488 | Reuters removed from Market Wire |
| ui502 | AP removed from Market Wire; EIA/FDIC/ECB + Bloomberg/MarketWatch instead |
| ui503 | Grok report cover/section markdown cleaned (TSLA matches RIVN) |
| ui504 | BKNG: ROIC for buyback years; DGA score hover math; neg equity no longer a free 100 |
| ui505 | Topbar: Options moved to the right of Positions |
| ui506 | Fund: hide Manual Data Uploads; SnapTrade is the live path |
| ui507 | Rebalance upside from saved-report PT vs live last (CRM +41% was stale) |
| ui508 | All-Time Performance: Chart | Table toggle (same as YTD monthly) |
| ui509 | DGA Score: negative book equity cannot print 100 on profit or growth |
| ui510 | Topbar: Fund renamed Accounts |
| ui511 | All-Time Performance: benchmark + CAGR/cumulative; Annual card retired |
| ui512 | Account cards collapsible; Rebalance Run is a gold control |
| ui513 | All-Time benchmark is annual-only; monthly/quarterly BM stored, not copied |
| ui514 | Saved Reports dual Grok/Claude upside under each PT; rebalance = Grok PT; Strategist gets both |
| ui515 | Analyze overlay: 15s seamless exchange matching-engine loop; drop unused chamber still |
| ui489–ui491 | Financials charts: one signed series, legend color both sides of zero; price hover |
| ui492–ui498 | Saved-report Print + Share PDF; print CSS scoped so Financials does not blank reports |
| ui495–ui497 | Analyze-in-progress overlay (later replaced by ui515 exchange backroom) |
| ui515 | 15s palindrome matching-engine loop (~940KB); unused `analysis-chamber.jpg` removed |
| ui516 | Zero/untagged debt is fortress on Financial Strength (not blank ratios) |
| ui517 | Accounts: Managed first, LP Funds second |
| ui496 | Grok live-search **tool traces are not reports** (RIVN); show another engine |
| ui499 | Watchlist no longer waits on Daily Pulse; 4.5s API budget + last-list cache |

### Known systems

- **Repo:** `https://github.com/alecmazo/DGA-research-analyst` · branch `main` · Railway auto-deploys
- **Railway:** project `upbeat-ambition`, GP service **`web`**, Postgres plugin, Sliw service `sliw`
- **GP login:** `/api/auth/v2/login` · header `x-auth-v2-token`
- **Support tickets:** `/api/support/tickets` + agent inbox; mark fixed with PATCH + trail
- **GP bundle:** `npm run build` in `web/gp-app/` then **commit `dist/`** (Nixpacks has no Node step)
- **Sliw:** Alec / Edyta only; CRM in shared Postgres; do not auto-send email; do not resurrect Contacted history unless asked

### Do not regress

- Watchlist day-% = session prior close (not Yahoo meta `previousClose`)
- Watchlist load **independent** of Daily Pulse (`Promise.all` used to freeze the list)
- Watchlist YTD: calendar Jan 1; **this-year IPOs** = % since first tape print + small IPO tag
- Grok Analyze: never persist `web_search` dumps as `report_md`
- Report markdown: cover is a GFM table (no `**` wrapping the row); sections are `# SECTION N` not unicode banners
- DGA Score: if book invested capital ≤ 0, ROIC uses total assets − cash; negative equity scores 0 on D/E **and ROE** (do not skip); profit ≤70, growth ≤75
- Financial Strength: **no debt is a strength** — untagged debt on a complete BS is 0× leverage (not blank); cash/debt uses a 1-unit floor then caps at 10×. Charts still leave missing debt as blank.
- Financials `@media print` must stay scoped to `.shell`, never `body *`
- Chart bars keep **legend color** above and below zero (sign is position vs zero)
- Fund rebalance upside = Saved Report 12-month PT vs live last — never frozen report %
- Accounts rebalance **target** = **Grok** 12m PT (other engines only if Grok has none)
- Saved Reports TGT/Upside: when both Grok and Claude exist, each target has its own live upside underneath — never hide one %
- Portfolio Strategist prompt includes **both** Grok and Claude PT/upside (and per-engine mechanical EV)
- Market Wire: no Reuters or AP (no AP Google News RSS; drop AP bylines)
- Do not auto-send email; Share on reports prompts for a recipient
- SnapTrade: `SnapTradeAuth.commercial_api_key` when available
- Options wheel: held names first; term tables + KPI strip

---

## Cross-agent checklist

When switching machine or agent (Claude ↔ Grok):

- [ ] `git fetch origin && git log -1 origin/main --oneline`
- [ ] `curl -s https://portfolio.dgacapital.com/api/build`
- [ ] Read this file’s **Current sequence** and **Open product state**
- [ ] Bump UI **only upward**
- [ ] Prefer committing from a clean push worktree synced to `origin/main`
- [ ] After push, confirm Railway `/api/build` before claiming “live”

---

## Repo pointers

| Path | Role |
|------|------|
| `web/gp-app/` | **Canonical GP** (React + TS, Vite). Served at `/gp` |
| `web/gp-app/src/pages/` | Desk, Financials, Report window, Settings, Podcasts… |
| `web/gp-app/dist/` | Committed production bundle — rebuild after UI edits |
| `api/server.py` | FastAPI, `WEB_BUILD_VERSION`, most APIs (very large) |
| `DGA_analyst.py` | Multi-LLM Analyze pipeline (Grok/Claude/Kimi/DeepSeek) |
| `web/gp/` | Legacy GP (`/gp-legacy`) — do not treat as source of truth |
| `web/portfolio.html` | Login gateway |
| `mobile/` | Expo app (OTA); keep YTD/IPO/watchlist in sync when you touch desk quotes |
| `market_data.py` / `snaptrade_link.py` | Quotes / SnapTrade |
| `docs/support-inbox/` | Support ticket notes (if present) |

---

### X FinTwit desk card (ui382)

- Right-rail **X · FinTwit** card on Desk (next to Market Wire).
- `GET /api/v2/news/x-fin-feed` — free public syndication (`syndication.twitter.com`), **no X API key**, no LLM tokens.
- Curated finance accounts (wires, macro, Fed, charts, flow); filter chips by tag.

### Report history (ui381)

- Re-Analyze **archives** the prior markdown into `analyst_report_versions` before overwrite.
- Current row keeps `delta_from_prior` (per-provider map) + `version_count`.
- UI: Saved Reports `vN` / Δ pills; report modal delta banner + thesis timeline; Financials Value Rank spark from `ticker_metric_snapshots`.
- APIs: `GET /api/report/{ticker}/history`, `GET /api/report/{ticker}/version/{id}`.

*Last updated: 2026-08-27 · Agent: Grok Build · Live: `ui517-20260827-accounts-managed-first` · Next: `ui518-YYYYMMDD-slug`*
