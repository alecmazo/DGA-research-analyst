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
| **Engine loops + research print** | **`ui518-20260827-engine-loops-print`** | Grok vs Claude 15s analysis loops; Print on Analyst/Strategist with DGA letterhead; Claude strategist thinking off |
| **PDF tables + question** | **`ui519-20260827-pdf-table-question`** | Report/IC PDF columns sized from cell text; Strategist Question strip no longer dumps the LLM prompt |
| **Next deploy after this** | **`ui520-YYYYMMDD-slug`** | Always `max(live, this file, BUILD_VERSION) + 1` |
| **Book snapshot required** | **`ui553-20260829-book-snapshot`** | Strategist / quarterly / memos lock IC snapshot table |
| **Anonymous demo login** | **`ui554-20260829-demo-preview`** | `demo@dgacapital.com` / `demo123` — 3 synthetic books, zero live PII |
| **LP planning edit** | **`ui555-20260829-lp-plan-edit`** | LP can edit/save the shared planning worksheet; latest save is what GP sees |
| **Desk column sort** | **`ui556-20260831-desk-sort`** | Watchlist headers sort (default |day %|); Saved Reports TGT/Upside sorts by Grok upside |
| **Print engine aliases** | **`ui557-20260831-print-aliases`** | Printed/PDF reports: Grok → Rock, Claude → Laudia |
| **PDF report chrome** | **`ui558-20260831-pdf-metrics`** | Drop colored engine chip; compact metrics; larger Research Report title |
| **Saved-report Excel model** | **`ui559-20260902-excel-model`** | EXCEL button builds IB workbook (financials + pro forma + valuation) and saves to Dropbox `/Apps/DGA Research/Reports/` |
| **Excel DCF detail** | **`ui560-20260902-excel-dcf`** | Valuation sheet: full WACC build, DCF ladder, live WACC×g sensitivity, pro forma years |
| **Excel DCF verdict** | **`ui561-20260902-dcf-verdict`** | Valuation: UNDERVALUED / FAIR VALUED / OVERVALUED vs last, from this DCF |
| **Saved-report style pills** | **`ui562-20260902-style-pills`** | VALUE / GROWTH / GARP / RICH / CORE on the card; Excel only on the open report |
| **Builder DCF value board** | **`ui563-20260902-dcf-value-board`** | Top 10 Value watchlist on Builder — cheapest saved-report DCFs vs last |
| **Word on open report** | **`ui564-20260902-report-word`** | DOC pill off the saved-reports card; Word download next to Excel on the open report |
| **Report card cleanup** | **`ui565-20260902-report-switch`** | Saved reports: style + ⚡ only; open defaults to Grok; Grok/Claude switch on the report |
| **Cover DCF target** | **`ui566-20260902-cover-dcf-pt`** | Cover table Rating row right cell = DCF-only $/sh (not blended PT) |
| **Desk Top Movers** | **`ui567-20260903-top-movers`** | Desk card: top 10 $1B+ stocks by |day %| (Yahoo screeners, no LLM) |
| **Market Pulse headlines** | **`ui568-20260903-pulse-headlines`** | Desk Market Pulse: newest public headline per watchlist name (Yahoo/Google RSS, no LLM) |
| **Pulse headline list** | **`ui569-20260903-pulse-head-list`** | Click empty space on a Market Pulse row to open latest Yahoo+Google headlines |
| **Valuation approaches** | **`ui570-20260903-val-approaches`** | Excel + Market Pulse: each PT method (DCF/comps/street/scenarios) with its own color-coded verdict; no blend |
| **Excel Dropbox overwrite** | **`ui571-20260903-xlsx-overwrite`** | Excel export replaces `{TICKER}_DGA_Model.xlsx` in Reports; purges `(1)` copies |
| **Approaches use implied** | **`ui572-20260903-implied-approaches`** | Approaches vs last: implied $/sh (not weighted); only 12m PT is the blend; DCF = model share + DCF (base) |
| **Pulse drop Base case** | **`ui573-20260903-pulse-no-base`** | Drop scenario Base/Bull/Bear from Approaches + Pulse chips; ticket create salvages description if screenshot truncates JSON |
| **IB table number format** | **`ui574-20260903-ib-table-fmt`** | Report tables: $ and thousands commas (and % / x) at render; existing reports included |
| **POST JSON body** | **`ui575-20260903-post-json-body`** | Analyst + support tickets read JSON via FastAPI Body (event loop); empty-body false rejects |
| **Excel replace + keep shot** | **`ui576-20260904-xlsx-replace`** | Excel button overwrites `{TICKER}_DGA_Model.xlsx` in Dropbox and the local open/save file; support tickets always keep the screenshot |
| **Excel units + Excel folder** | **`ui577-20260904-excel-units`** | NFLX-style unit bugs: growth not revenue, shares from SEC not 3.0bn leftovers, $B→$m; models save to Dropbox `/Apps/DGA Research/Excel/` and replace |
| **Cover DCF on Rating row** | **`ui578-20260904-cover-dcf`** | SUP_20260904_b6613db9 — DCF Target on the cover Rating row for every saved report; 12m PT stays the DGA blend |
| **DCF (base) reverse bridge** | **`ui579-20260904-dcf-base-bridge`** | Valuation tab: reverse-engineered DCF (base) bridge beside the live Gordon equity bridge, with $/% gap |
| **Excel button opens file** | **`ui580-20260904-excel-open`** | Excel click saves to Dropbox `/Apps/DGA Research/Excel/` then opens the workbook in Excel |
| **xlsx repair formulas** | **`ui581-20260904-xlsx-repair`** | Valuation DCF (base) step labels no longer start with `=` (Excel was repairing the file and stripping sheet3 formulas) |
| **Comps from financials store** | **`ui582-20260904-store-comps`** | Excel + saved reports comps use last reported FY from company_financials (live last), not NTM/(E) estimates |
| **Watchlist last-close feed** | **`ui583-20260908-watchlist-quotes`** | Skip yfinance on quote hot path (Railway 401); last-close store fallback; never stamp null prices over the watchlist |
| **Excel open as .xlsx** | **`ui584-20260908-xlsx-open`** | Excel button opens a URL that ends in `{TICKER}_DGA_Model.xlsx` so Mac Excel no longer warns that ``file`` format/extension don't match |
| **Watchlist YTD column** | **`ui585-20260908-watchlist-ytd`** | SUP_20260908_ad9c15d1 — calendar YTD from price_history runs before Yahoo so the column is not starved to dashes |
| **Watchlist YTD keep** | **`ui586-20260908-ytd-keep`** | Yahoo/store price updates merge into the row so they do not wipe YTD already stamped |
| **Positions Ind one row** | **`ui587-20260908-pos-ind-row`** | SUP_20260908_ffea3da3 — drop subtitle under Ind; 1m/YTD/1y/3y sit on the same row as the account name |
| **Page title row** | **`ui588-20260908-title-row`** | SUP_20260908_6aa2c0a8 — hide descriptions under page titles site-wide; right-side actions sit on the title row |
| **Wheel held = Positions** | **`ui589-20260909-wheel-held`** | SUP_20260909_37ea161d — covered-call HELD/share counts from live Positions book only (no DEMOF1 / watchlist) |
| **Demo creds in Settings** | **`ui590-20260909-demo-creds`** | GP Settings → Admin User Management shows `demo@dgacapital.com` / `demo123` in plaintext |
| **Wheel CC overwrite rank** | **`ui591-20260909-cc-setup-rank`** | Covered calls: held uncovered → held covered → not held, then GS/MS risk/reward (rich vol, 15–30Δ, cushion vs assignment) — not share count |
| **Builder hover dismiss** | **`ui592-20260909-builder-hover`** | Board snapshot closes when the pointer leaves the list (or the card); no leftover dim over the page |
| **Builder GuruFocus tab** | **`ui593-20260909-gf-watchlists`** | Builder → Gurufocus tab mirrors My Portfolios: 37 watchlists, Date First Added, GF table columns |
| **GF watchlist add ticker** | **`ui594-20260909-gf-add-ticker`** | SUP_20260909_8152b360 — add-ticker field sits on the same row as the watchlist name (e.g. Space) |
| **GF watchlist edit desk** | **`ui595-20260909-gf-edit-lists`** | SUP_20260909_a68add7e — create/delete lists, hover-remove stocks, editable note + fair value, drop dividend column |
| **Builder board switch** | **`ui596-20260909-board-switch`** | SUP_20260909_88b93702 — Track boards paint from cache/store + client prefetch; no Yahoo wait or DCF rebuild on every click |
| **Builder board quotes** | **`ui597-20260909-board-quotes`** | Same ticket — fill leftover last prices via `_batch_quotes_fast`; prefetch 3 boards at a time |
| **GF desk UX + splits** | **`ui598-20260909-gf-desk`** | Financials in a new tab; compact GF rows + watchlist dropdown; split-adjusted since-add (TSLA) |
| **Valuation bridge** | **`ui599-20260910-val-bridge`** | Click GARP/VALUE/etc and Market Pulse chips for a detailed bridge window; Excel DCF User FCF-multiple pulldown |
| **LP mobile Portfolio 500** | **`ui600-20260911-lp-pos-500`** | SUP_20260911_a8cea52d — `_sql_demo_short` no longer uses LIKE `%` (psycopg2 pyformat 500 on `/api/v2/lp/me/positions`) |
| **Earnings actual revenue** | **`ui601-20260911-earn-rev`** | SUP_20260911_1d199fdf — 8-K parser picks company total (ORCL $19.3B) not Services $1.4B; drop actuals 5× off Street |
| **Desk ticket light** | **`ui602-20260911-ticket-dot`** | Green/red dot next to Reset layout; hover shows open-ticket count (GP, incl. LP-filed) |
| **DCF User share count** | **`ui603-20260911-dcf-shares`** | Valuation DCF User uses SEC diluted shares (BSX 7.1m leftover → ~1.5bn); drop insane stored $/share on pulse |
| **Fund account menus** | **`ui604-20260912-fund-menus`** | SUP_20260912_9de2a14e — account switcher + Download pulldown; chart/table and monthly/quarterly/annual selects |
| **Continuity kit** | **`ui605-20260914-continuity-kit`** | Settings handoff is a short briefing + downloadable product log (`docs/continuity/PRODUCT_LOG.md`) and version log |
| **Pulse three chips** | **`ui606-20260914-pulse-comps`** | SUP_20260914_1f66fa9d — Market Pulse tags are DCF / Comps / Street only; Comps opens last-FY `company_financials` peer window (n/a if missing) |
| **Handoff copy-paste** | **`ui607-20260914-handoff-copy`** | Alec’s only step is Copy briefing → paste. The new agent clones/pulls GitHub (asks him to log in if needed). No Terminal clone. |
| **Pulse window export** | **`ui608-20260914-pulse-windows`** | DCF / Comps / Street windows: Support FAB, Download pulldown (Print PDF / Excel / Email), ticker stats line (mkt cap, P/E, EV/EBITDA, FCF, 52w) |
| **Handoff package** | **`ui609-20260914-handoff-pkg`** | One Download package zip (records only). Copy briefing is the handoff. New agent reads support fix trail. |
| **Desk pulldown + pulse stats** | **`ui610-20260914-desk-pulse`** | SUP_20260914_1253348c / _c201c300 — one Desk pulldown (Refresh / Collapse / Expand / Reset); Market Pulse top line shows mkt cap, Rev, NI, FCF |
| **Gurus + nav regroup** | **`ui611-20260914-gurus-lab`** | Topbar: Gurus + Lab▾ (Podcasts/Transcripts) + Accounts▾ (book/positions/options/memos). Gurus desk is SEC 13F/Form 4 (Ackman first); GF is UX only |
| **Nav menus visible** | **`ui612-20260914-nav-menus`** | Lab/Accounts pulldowns use position:fixed — nav overflow no longer clips the panel |
| **Gurus KPI + roster** | **`ui613-20260914-gurus-expand`** | SUP_20260914_78a40a9f — click Equity/Names/New buys/Turnover/Top 5/HHI to expand; ticker labels on time-flow lines; add Druckenmiller/Loeb/Einhorn/Tepper/Marks/Burry/Paulson/Klarman |
| **Public surface harden** | **`ui614-20260914-sec-harden`** | Close /docs /redoc /openapi.json; diagnostics GP-only; CORS allowlist; security headers; login rate-limit by IP + v1; cap support screenshot size |
| **Gurus tickers + colors** | **`ui615-20260914-gurus-tickers`** | SUP_20260914_ea14b128 / _9c823a25 — issuer/CUSIP→ticker (SEC titles + OpenFIGI); Add/New Buy light green, Reduce/Sold Out light red |
| **Wire + dense Gurus** | **`ui616-20260915-wire-gurus`** | Market Wire drops Bloomberg; WSJ/IBD/Fox Business/RCM + max 2 per source. Gurus packed: small chart, buys/sells, roster, overlap |
| **Roster turnover** | **`ui617-20260915-gurus-roster`** | Roster snapshot uses 13F impact for turnover; overlap de-dupes the same guru twice |
| **Concentrated $10B+ gurus** | **`ui618-20260915-gurus-10b`** | Add 13 managers with latest 13F ≥ $10B and ≤ 50 names (TCI, Gates, Tiger, Elliott, Lone Pine, Fundsmith, …). Screened on SEC EDGAR, not GuruFocus. |
| **Weight chart colors** | **`ui619-20260915-weight-chart`** | SUP_20260915_210f2f13 — line color = ticker label; no P&L green/red on the chart; drop unlabeled equity spark; series keyed by ticker |
| **Load times** | **`ui620-20260916-load-times`** | Desktop+mobile stall: earnings N+1 / SEC 8-K / universe HTTP pinned the 1 uvicorn worker (p95 ~15s). Card cache + batch API, short Nasdaq/SEC timeouts, dashboard cache, universe counts from cache. No features removed. |
| **LULU lease debt** | **`ui621-20260916-lulu-debt`** | Financials debt/LTD blank for names with $0 notes (LULU). Map ASC 842 operating-lease liabilities; a $0 revolver no longer hides current leases. Backfill stored NULL/0 debt. |
| **Lease vs notes split** | **`ui622-20260917-lease-rows`** | All names: Long-term/short-term debt = borrowings only; new Operating lease liabilities row; Total debt = notes + leases with asterisk. Backfill every stored ticker from SEC companyfacts. |
| **Compact financials + speed** | **`ui623-20260917-fin-compact-speed`** | Financials cards ~50% denser (GuruFocus). Quotes DB-first + 1.5s Yahoo wall; reports 12s cache; watchlist 2.5s paint. Report tables: cell suffix / WACC row labels beat generic "Value" so 7A-1 rates stay %, 7A-5 grid stays $. |
| **SEC overnight window** | **`ui624-20260917-sec-overnight`** | Nightly = EDGAR daily index of new 10-K/10-Q only, 11pm–6am PT, pause/resume. Full store rematerialize is manual (Settings). Desk desktop popup lists companies. $0 SEC. No whole-DB backfill unless launched. |
| **Reports list lock** | **`ui625-20260917-reports-lock`** | One list_reports recut at a time after deploy; extra polls get stale/empty so the threadpool does not starve /health. |
| **Perf root** | **`ui626-20260917-perf-root`** | list_reports: no JSON blob recut / 104-name store quotes. Watchlist 1.2s paint wall. Async /health+/api/build. Desk polls slowed. Settings cached. |
| **Page speed** | **`ui627-20260917-page-speed`** | Builder lists/boards no DCF/DGA/Yahoo on GET; candidates skip report_md. Gurus skip OpenFIGI/SEC titles on GET. Financials dashboard store-only + 10min cache; mobile fund bars get a Y-axis. |
| **Board quotes** | **`ui628-20260917-board-quotes`** | SUP_20260917_4e57d833 — Track boards LAST/DAY % blank. Any-age last-close then 1.5s fast quotes for misses. |
| **GF columns** | **`ui629-20260917-gf-cols`** | GuruFocus watchlists: drop Annualized + Rel S&P; add FY Revenue/FCF; sort Day's Change % and since-first. |
| **GF mcap** | **`ui630-20260917-gf-mcap`** | GuruFocus watchlists: Market Cap column (last × shares, same scale as Pulse). |
| **Mobile fast** | **`ui631-20260918-mobile-fast`** | Store-only index ribbon + `/api/mobile/home`. Cache-first Markets/Research/Positions/Financials. No 104-quote fan-out. OTA download without launch reload. |
| **Analyze resume** | **`ui632-20260918-analyze-resume`** | Leaving Desk no longer hides a running Analyze Ticker. Re-attach from session + GET /api/jobs and keep the progress bar. Mobile OTA rolled back to the TestFlight embedded bundle after ui31 crash loop. |
| **Desk Refresh** | **`ui633-20260918-desk-refresh`** | SUP_20260917_2563dba3 — Desk dropdown Refresh shows animated Refreshing…, disables the control, awaits watchlist/brief, min 700ms so the click is visible. |
| **Report export menu** | **`ui634-20260918-report-export`** | SUP_20260918_472dae47 — Report window: Gamma/PPT/Word/Excel/Print/Share in one Export pulldown; PowerPoint download wired; Grok/Claude stay buttons; in-page Close removed. |
| **SEC nightly list** | **`ui635-20260919-sec-filings-list`** | SUP_20260919_29f3af01 — Desk SEC popup lists overnight 10-K/10-Q (ticker, form, filed) even when periods were already current. |
| **Grok 4.7** | **`ui636-20260921-grok-4-7`** | Default `GROK_MODEL` / `GROK_SCREEN_MODEL` → `grok-4.7` (same $2/$6 list as 4.6). |
| **Agents on 4.7** | **`ui637-20260921-agents-grok47`** | Analyst + Strategist default to Grok 4.7 (reasoning on). Claude Opus 5 still selectable. |
| **Load times** | **`ui638-20260922-load-times`** | Mobile home skips YTD/earnings. Desk paints watchlist before secondary cards. Cached GP session skips the boot splash. |
| **Stored open** | **`ui639-20260922-stored-open`** | Mobile watchlist and saved reports open from Postgres. No Yahoo wait when a stored price exists. Report body is the saved note. |
| **One price** | **`ui640-20260922-one-price`** | Desk watchlist fills one quote book. Reports and the report window reuse it. Server reads the store before Yahoo. Quote debug fields stripped. |
| **No TradingView** | **`ui641-20260922-no-tv`** | Live Markets chart removed from the desk. Index ribbon stays. |
| **Debt maturities** | **`ui642-20260922-debt-maturities`** | Financials table debt cell hovers the latest 10-K contractual maturity schedule. Loaded on hover, not with the page. |
| **SEC notice + wire** | **`ui643-20260923-sec-wire`** | Overnight SEC card drops “already in store”. Snapshot links the filing. Market wire restyled, still free RSS. |
| **Login while busy** | **`ui644-20260923-login-busy`** | Analyze no longer occupies a request thread. Sign-in uses the last user list if the DB pool is full, and the login page retries instead of blaming the connection. |
| **Grok + Gamma** | **`ui645-20260923-grok-gamma`** | SUP_20260923_21fa9246 — live search is capped at 3 min then the report is written without it. Gamma still runs. Null folderIds no longer sent. |
| **Report stub** | **`ui646-20260923-report-stub`** | SUP_20260923_58319155 — a one-line “I will search” answer is not saved as the report. ADBE’s stored stub explains that and asks for a re-run. |
| **Fast report** | **`ui647-20260923-fast-report`** | Equity reports are one grok-4.7 chat call at low reasoning. No web/X search loop on the report write. |
| **Analyze trace** | **`ui648-20260923-analyze-trace`** | Each report step is a timestamped line on the desk and in the server log. |
| **Store-first report** | **`ui649-20260923-store-first`** | A fresh stored quarter skips the live SEC Excel pull (was 1–2 min plus a retry). Grok call capped at 150s. |
| **Clean prices** | **`ui650-20260923-clean-px`** | Watchlist last/day % rounded. Quotes older than 5 days are not painted. A day-% from a prior session is not shown as today’s move. |
| **Clean quote columns** | **`ui651-20260923-clean-quotes`** | Last, day %, and YTD right-align and no longer clip. The desk drops a cached price older than five days and does not keep yesterday’s day-% after the server blanks it. |
| **Quote paint** | **`ui652-20260923-quote-paint`** | A last price from the past five days still paints during the session. Only the day-% is blank when that print is not from today. A months-old print stays off the list. |
| **Sliw videos stay put** | **`ui653-20260923-sliw-videos`** | Wedding videos are not in the deploy archive. The live copies stay on `/data/sliw-media`. Re-upload only if Alec asks. |
| **Watchlist log** | **`ui654-20260923-wl-log`** | YTD no longer drops when the quote read is slow. Log button next to the watchlist timing; Support attaches that log. |
| **Analyze step graphics** | **`ui655-20260923-analyze-steps`** | The analyze progress graphic swaps with the step: filings, financials, market, writing, Word, slides, upload, ready. |
| **Grok write streams** | **`ui656-20260923-grok-stream`** | ADBE timed out because a 150s socket was retried twice (~7.5 min) and returned nothing. The write now streams once, with a 6-minute cap. The writing fox loop starts and ends on the same frame. |
| **Grok effort** | **`ui657-20260923-grok-effort`** | Grok 4.7 reports default to Normal effort. Settings → Models can switch Low, Normal, or High. |
| **Analyze auto log** | **`ui658-20260923-analyze-autolog`** | A failed Analyze files ticket `AUTO_ANALYZE_TICKER` with the step trace. A clean run deletes that ticket. |
| **Let the write finish** | **`ui659-20260923-grok-finish`** | ADBE reasoned 340s then wrote 37k chars. The 6-minute cap killed it while the text was still arriving. A growing report is no longer cut off. |
| **Unfinished report** | **`ui660-20260924-report-tail`** | A report that stops before the verdict and Munger section is not marked done. The next Analyze continues from the cutoff. |
| **Mobile budget** | **`ui661-20260924-mobile-budget`** | Phone home, watchlist, and demo reports reuse a short memory cache. Markets does not wait on Yahoo. Demo login no longer rehashes. |
| **Demo login once** | **`ui662-20260924-demo-login`** | Demo password is restored at most once, before the password check, then left alone. |
| **Mobile read** | **`ui663-20260924-mobile-read`** | Saved reports and opening one stay in memory. Markets no longer queries the report table on first paint. |
| **Demo book** | **`ui664-20260924-demo-book`** | If the demo login's watchlist is empty, boot copies the names off the previous demo id. No full reseed. |
| **Analyze cost** | **`ui665-20260924-analyze-cost`** | When a report finishes, the desk shows input tokens, output tokens, and the dollar cost. |
| **Speed prompt** | **`ui666-20260924-speed-prompt`** | Settings → Handoff copies a mobile-speed prompt for Grok Build or Claude. Budgets match the recorded runs. |
| **Munger tail** | **`ui667-20260924-munger-tail`** | A Grok report that stops inside 8.5 is not finished. MGM was cut off at 8.5.3; the missing subsections are written on. |
| **Business summary** | **`ui668-20260925-biz-summary`** | Financials shows a short description of what the company does, under the name. The Financials card opens on load. |
| **Financials blurb** | **`ui669-20260925-fin-blurb`** | Company description comes from the 10-K, not a name search. It is two lines until clicked. Peer prices are not fetched live on the dashboard. |
| **Statement lines** | **`ui670-20260925-stmt-lines`** | Assets and liabilities in the Value Line array expand. Income, balance sheet, cash flow, and comprehensive income open for the last five years. |
| **Statement sections** | **`ui671-20260925-stmt-sections`** | Balance sheet splits assets, liabilities, and equity. Income statement keeps revenue, cost of revenue, gross income, SG&A, and operating income in order. Cash flow splits operating, investing, and financing, then sums them. Hover a balance-sheet line for the 10-K note. |
| **Munger page** | **`ui672-20260925-munger-page`** | A Munger page: morning card (one rule, one holding), the fifty as an index, and each rule across the watchlist from saved report citations. No model call on load. |
| **Since cost** | **`ui673-20260926-since-cost`** | Open positions show percent change from average cost, between unrealized gain and weight. |
| **Watchlist first** | **`ui674-20260928-wl-first`** | First open of the Pacific day finishes the watchlist before the SEC notice and the other desk polls. Later the same day the old stagger stays. |
| **Local page** | **`ui675-20260928-local-page`** | A Local page on the GP site runs research, questions, and portfolio notes on the on-Mac finance model only. |
| **Local browser** | **`ui676-20260928-local-browser`** | The Local page calls Ollama on this Mac from the browser. The live site still supplies filings, Yahoo news, and portfolios. |
| **Local reports** | **`ui677-20260928-local-reports`** | A local run opens in the report window, labeled local, with the same export buttons. The Word file is saved to Dropbox Apps/DGA Research/Local_Reports. |
| **Transcript library** | **`ui678-20260928-transcript-tree`** | Interviews and earnings calls sit in one folder tree on Transcripts. Local opens that library. A red Ollama pill starts or restarts Ollama on this Mac. |
| **Local window** | **`ui679-20260928-local-window`** | A local note opens in its own window, labeled local plus the model name, in light red and grey. It is not listed on the desk, and a new run is compared only with the previous local note. |
| **Transcript ask** | **`ui680-20260928-transcript-ask`** | Expanding an earnings-call company offers Refresh for that ticker only. Ask a question uses the on-Mac model unless another engine is chosen. |
| **Local refusal** | **`ui681-20260928-local-refusal`** | A one-line local refusal is not saved over the note. HHH opens the stored research report. A refusal retries once, then keeps the previous note. |
| **Refusal why** | **`ui682-20260928-refusal-why`** | When the local model quits, the Local page shows its reasoning, the stop reason, and the prompt token count. |
| **Prompt split** | **`ui683-20260928-prompt-split`** | Grok and Claude both get a short Munger section. Neither is told it is Grok 4.20 or to run the other's news search. The local model writes the note, then the Munger section, and the opened report is both. |
| **Call refresh** | **`ui684-20260928-call-refresh`** | Transcripts Refresh pulls new earnings-call quarters from Motley Fool for any company. The lookup includes early-next-month publish dates and slug shapes that omit "call" or the quarter. Free sources only. |
| **Ask open transcript** | **`ui685-20260928-ask-open`** | Ask a question uses the transcript open in the library, not a search that has to match every word. If that transcript does not contain the answer, it says so. |
| **Show finder** | **`ui686-20260929-show-finder`** | Opening a stored interview shows the transcript. A failed open says so in the reader instead of leaving it blank. Search finds a show and pulls one episode into the library. |
| **Array period** | **`ui687-20260929-array-period`** | The Financials card has an Annual / Quarterly control. The statistical array switches with it. Quarterly is the latest quarters, and growth is versus the same quarter a year earlier. |
| **Podcast cleanup** | **`ui688-20260929-podcast-cleanup`** | Transcripts has a Clean up button. Select stored shows and delete their transcripts. Earnings calls stay. |
| **Call order** | **`ui689-20260930-call-order`** | The transcript library lists earnings calls from the watchlist first, then every other company in alphabetical order. |
| **Portfolio window** | **`ui690-20260930-portfolio-window`** | A portfolio recommendation saves and opens in its own window. The Local page lists it on a card next to Portfolio instead of inside that card. |
| **Mover headlines** | **`ui691-20260930-mover-headlines`** | Top Movers opens free headlines on the row. The ticker still opens the snapshot. |
| **Show captions** | **`ui692-20260930-show-captions`** | Pull in reads the RSS transcript, then the publisher's transcript, then YouTube captions. A shorter channel name still matches the show. |
| **Mac captions** | **`ui693-20260930-mac-captions`** | When the feed has no transcript, Pull asks this Mac for the YouTube captions and stores them. Spotify has no free transcript. |
| **Ask scope** | **`ui694-20260930-ask-scope`** | The question card sits under the transcript library. A question uses the open transcript. Choose transcripts to give the engine more than one. |
| **Lab nav** | **`ui695-20261001-lab-nav`** | Munger sits under Lab with Podcasts and Transcripts. Merger Arb is there too: the deal list and the analysis page. |
| **Load flow** | **`ui696-20261001-load-flow`** | The desk shows a Load flow card in the first open row under Portfolio Strategist. It stays expanded. Green is loaded, yellow is loading, red is a failed call. |
| **Local cover** | **`ui697-20261001-local-cover`** | Saved local notes show the last price and the 12-month target from the cover when the stored target is blank. Upside is that target versus the price, not the DCF sentence. A target already saved is left as-is. |
| **Deal scan** | **`ui698-20261001-deal-scan`** | Merger Arb has a Scan for deals button on the deal list. A scan does not add a deal. Add and Open write a desk deal only after you confirm. |
| **Deal lines** | **`ui699-20261002-deal-lines`** | A scan row opens that deal. Hide removes it. The line states the offer, the price, and what is being bought. Analyze runs on the local model and does not start a paid deep dive. |
| **Compact cards** | **`ui700-20261002-compact-cards`** | Deal overview and spread, including implied probability, sit in a grid. Each fact is one line with its green dot. The source opens on that line. |
| **Denser page** | **`ui701-20261002-denser-page`** | Downside and upside share one card. Sources, refresh, and flags share one card. Regulatory path, votes, and catalysts share one card. Each fact stays one line. |
| **Grok desk** | **`ui702-20261002-grok-desk`** | The Grok desk bot sits above Support on the main desk. GitHub `main` is the code the site runs. |
| **Credit** | **`ui703-20261002-credit`** | Credit is in the Work menu. The issuer page is keyed by CIK. Paramount Skydance is the seed. Bond prices are typed in. The verdict is code, not a model. |
| **GPT-oss** | **`ui704-20261002-gpt-oss`** | The bottom-right desk button is GPT-oss. It calls `gpt-oss-20b-finance` on this Mac and does not call the paid API. |
| **Handoff** | **`ui705-20261002-handoff`** | Credit is on the site. GitHub `main` is the full folder, including ticket screenshots and logo options. Pushing `main` deploys Railway service `web` with the Nixpacks start command. On this Mac the folder is `DGA-Research-Portal`. The GitHub repo name stays `DGA-research-analyst`. |
| **Repo flow** | **`ui706-20261002-repo-flow`** | Desk card under Load flow. Nodes are folder names on main. A branch moves while a call is in that folder. |
| **Statement quarters** | **`ui707-20261002-stmt-quarters`** | The equity/assets chart is the Balance sheet card and includes liabilities. Net income is off the free-cash-flow chart. Income statement, balance sheet, cash flow, and comprehensive income open on the quarterly array, with a TTM column. |
| **Load flow pages** | **`ui708-20261002-load-flow`** | Load flow runs top down from the center. Credit and every Work, Lab, and Accounts page are on the chart. The card is tall enough to show them. |
| **High yield book** | **`ui709-20261002-hy-memo`** | Credit is a high-yield issuer book with a 6% floor. Merger arb opens as a situation memorandum. |
| **Credit marks** | **`ui710-20261002-credit-marks`** | Typed clean prices stay on the pricing card. The Treasury curve and spread benchmarks load daily. Yield settlement is the next business day. WBD exchange notes do not use a January 1 maturity. |
| **Credit details** | **`ui711-20261002-credit-details`** | Opening any high-yield name loads the annual-report debt balances, cash, interest, and contractual maturity schedule. A named coupon, rating, or TRACE price stays not found. Paramount still opens its named structure. |
| **Podcast scene** | **`ui712-20261004-podcast-scene`** | The behind-the-scenes graphic closes when podcast script or audio generation finishes. A finished episode does not keep the animation running. |
| **Report prices** | **`ui713-20261005-report-prices`** | Saved Reports shows the stored last price for names that are not on the watchlist. A day move from an earlier session stays blank. |
| **Positions** | **`ui714-20261005-positions`** | The Positions tab uses the newest print. A stored quote older than the brokerage sync is replaced by that sync's price. BRKB uses the BRK-B quote. A day move from an earlier session stays blank. |
| **Transcripts** | **`ui715-20261005-transcripts`** | Local transcript analysis reads the full transcript in packets, saves each section, and stitches those notes. Caption lines are joined into paragraphs. Refresh reloads the library and the call-coverage table and says so. Enter on a ticker in the library pulls that ticker's calls and shows that it is working. |
| **Credit debt tags** | **`ui716-20261005-debt-tags`** | A 10-K that tags debt only as long-term debt and capital lease obligations shows that line. Transocean borrowings are the $5,212m long-term line plus the $445m current portion. The finance lease is not added again. A missing maturity schedule stays missing. |
| **Nav** | **`ui717-20261005-nav`** | Credit sits in the Lab menu. Podcasts takes its place in Work. The Builder label is Watchlists. The route stays `/builder`. |
| **Portfolio roundup** | **`ui718-20261005-roundup`** | Generate Portfolio Roundup stays on the strategist card. It uses the selected accounts, or an uploaded book, and Podcasts follows that script job until the script is on screen. |
| **Roundup book** | **`ui719-20261006-roundup-book`** | The portfolio review walks from the heaviest weight down and leaves out anything under 1%. It states the rebalance, the rate stance, the political stance, and the next 12 months in plain sentences. |
| **Roundup record** | **`ui720-20261006-roundup-record`** | Run the review first. Portfolio roundup is on that saved review. It speaks the review, using the book that was reviewed. |
| **Portfolio city** | **`ui721-20261007-city`** | Lab opens the positions book as a city. One tower per ticker, market cap by default, with position size and total assets as toggles. Managed accounts and LP funds share the tower. Book equity is a glass band. The index tape paints green and red from its own row. |
| **City offline** | **`ui722-20261007-city-off`** | The city page and its API are off. The scene did not write to the database. Lab is Credit, Transcripts, Munger, and Merger Arb. |
| **Portfolio ship** | **`ui723-20261007-ship`** | Lab opens the positions book as a ship. Empty sleeves stay off the legend. The sea slides with the S&P 500 day move: +2% and above is clear and smooth, −3% and below is the darkest chop, and a missing print is the flat-day sea. Demo and non-GP logins see weights only. The city route stays off. |
| **Ship plates** | **`ui724-20261007-ship-real`** | The ship is a photoreal plate. Clear, flat, and storm stills crossfade with the S&P day move. Held sleeves are clickable pins and the picture does not zoom. Industrials and aerospace are separate. Microsoft and the other software names sit on the bridge, Nike on Consumer Staples, Howard Hughes and the other property names on Real Estate, Uber with consumer discretionary, and the Fannie and Freddie lines stay on the stern. |
| **Ship sea** | **`ui725-20261007-ship-live`** | The same three plates loop as muted sea video. The stills stay underneath, and a reduced-motion setting shows the stills only. Pins stay clickable and the picture does not zoom. |
| **Ship washes** | **`ui726-20261007-ship-wash`** | The deck ship keeps its photograph. Each held sleeve is a color wash on that part of the hull, and the heavier company names sit in the wash. The sea still follows the S&P print. A click selects the sleeve and does not zoom. |
| **Index tape** | **`ui727-20261008-index-tape`** | The desk index row shows each print and its signed day percent, green when up and red when down. A chart session date stays that session, so today's move is kept. The tape does not scroll. |
| **Letter mail** | **`ui728-20261008-letter-mail`** | Publishing a quarterly-letter section emails the investors assigned to that account, and the section is in the message. An account with no investor login emails the GP who confirmed. Demo logins are not recipients. |

### One-click handoff (preferred)

**Two layers** so a new model does not eat its context window:

1. **Settings → Continuity handoff → Copy briefing for next agent**  
   Short paste (`GET /api/continuity/handoff`): live build, next-N, hard rules,
   “you (the agent) clone GitHub.”
2. **Paste into the new chat.** That is Alec’s only step. The new agent
   clones or pulls `alecmazo/DGA-research-analyst`. If GitHub is locked it
   asks him to log in — it does not send him to Terminal to clone.
3. **That agent then opens from the repo:**
   - `docs/continuity/PRODUCT_LOG.md` — every feature, categorized
   - `CONTINUITY.md` — this uiNNN log
   - `docs/continuity/README.md` — how the kit works
   - **Support fix trail** — `GET /api/support/tickets?limit=30` (what we
     already fixed, one problem at a time). Open work: agent-inbox.

**Download package** in Settings is a dated zip of those files for **records**
(or a file copy of the briefing). It is not the handoff. GitHub has the live
docs.

If Mac mini later ships a higher N while offline, the **agent** pulls `main`
first, then sets `WEB_BUILD_VERSION` to
`max(local, remote /api/build, CONTINUITY.md) + 1`.

---

## How to bump a build (every agent)

1. Read `CONTINUITY.md` **Current sequence** and curl `/api/build`.
2. Edit `api/server.py`:
   ```python
   WEB_BUILD_VERSION = "uiNNN-YYYYMMDD-slug"
   ```
3. Update the table in this file (append a row under Current sequence).
4. Commit + push `main` (deploys Railway service `web` only).
5. Poll until `/api/build` shows the new string.

---

## Nav layout (canonical — do not reshuffle casually)

React topbar at `/gp` (`web/gp-app/src/components/layout/Topbar.tsx`). Paths are relative to basename `/gp`.

**Work:**

1. Desk (`/`)
2. Financials (`/financials`)
3. Local (`/local`)
4. Watchlists (`/builder`) — *label only; route stays `/builder`*
5. Gurus (`/gurus`)
6. Podcasts (`/podcasts`)

**Lab:**

7. Credit (`/credit`, issuer at `/credit/:issuer`)
8. Transcripts (`/transcripts`)
9. Munger (`/munger`)
10. Merger Arb (`/merger-arb`, analysis at `/merger-arb/analysis/:dealId`)

**Accounts:**

11. Accounts (`/fund`) — *label only; route stays `/fund`*
12. Positions (`/positions`)
13. Options (`/options`)
14. Memos (`/memos`)

Settings stays in the account menu, not a top-level work tab. Sliw (`/sliw/`) stays a gated link, not a GP tab.

---

## Open product state (handoff notes)

**Live (2026-08-27):** `ui519-20260827-pdf-table-question` on Railway `web` (project `upbeat-ambition`). GP is the **React** app at `/gp` (`web/gp-app/`). Legacy HTML lives at `/gp-legacy`.

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
| ui518 | Grok/Claude 15s loops; Print on Analyst/Strategist; Claude Strategist thinking off (~$1 not $5) |
| ui519 | PDF/print tables sized from content; Strategist PDF Account strip (no prompt dump) |
| ui547 | Accounts Planning: Tax info YTD (SnapTrade activity rollup); Print removed; morning sync writes `snaptrade_tax_ytd` |
| ui548 | SUP_20260828_9d392054 — bind SnapTrade tax YTD helpers on lp_planning.mount so Tax info YTD is not 503 |
| ui549 | SUP_20260828_c77e6cf6 — Tax info YTD 500: escape `demo-%` in parameterized SnapTrade SQL |
| ui550 | LP Support button (desktop + mobile) files the same GP Settings ticket queue; LPs cannot see the list |
| ui551 | Support control is a flush vertical navy rail (GP + LP), not a floating pill |
| ui552 | Support tab sits bottom-right, horizontal |
| ui553 | SUP_20260829_c73797c1 — IC snapshot table (Ticker / Δ YTD / Contribution / $ P&L) required on strategist, quarterly letters, and memos |
| ui496 | Grok live-search **tool traces are not reports** (RIVN); show another engine |
| ui499 | Watchlist no longer waits on Daily Pulse; 4.5s API budget + last-list cache |

### Known systems

- **Repo:** `https://github.com/alecmazo/DGA-research-analyst` · branch `main` · pushing `main` deploys Railway service `web` (Nixpacks, `/health`, memory-capped start). Do not deploy `sliw` or Postgres unless asked. On this Mac the folder is `/Users/dplvideo/.grok/worktrees/DGA-Research-Portal`.
- **Railway:** project `upbeat-ambition`, GP service **`web`**, Postgres plugin, Sliw service `sliw`
- **GP login:** `/api/auth/v2/login` · header `x-auth-v2-token`
- **Support tickets:** `/api/support/tickets` + agent inbox; mark fixed with PATCH + trail
- **GP bundle:** `npm run build` in `web/gp-app/` then **commit `dist/`** (Nixpacks has no Node step)
- **Sliw:** Alec / Edyta only; CRM in shared Postgres; do not auto-send email; do not resurrect Contacted history unless asked
- **Mobile speed:** rerun `docs/mobile-speed/CHECKLIST.md`. Do not invent a new path. Append the result to `docs/mobile-speed/RUNS.md` and compare it to the previous run.

### Do not regress

- Watchlist day-% = session prior close (not Yahoo meta `previousClose`)
- Watchlist load **independent** of Daily Pulse (`Promise.all` used to freeze the list)
- Watchlist YTD: calendar Jan 1; **this-year IPOs** = % since first tape print + small IPO tag
- Grok Analyze: never persist `web_search` dumps as `report_md`
- **Sliw videos:** files already on the wedding site stay on the web volume `/data/sliw-media`. `.railwayignore` and `.dockerignore` keep `apps/sliw-agent/**/*.mp4` (and webm/mov/m4v) out of every deploy. Do **not** re-upload or replace one unless Alec specifically asks. A stored file is never overwritten by a new image.
- Report markdown: cover is a GFM table (no `**` wrapping the row); sections are `# SECTION N` not unicode banners
- DGA Score: if book invested capital ≤ 0, ROIC uses total assets − cash; negative equity scores 0 on D/E **and ROE** (do not skip); profit ≤70, growth ≤75
- Financial Strength: **no debt is a strength** — untagged debt on a complete BS is 0× leverage (not blank); cash/debt uses a 1-unit floor then caps at 10×. Charts still leave missing debt as blank.
- Financials `@media print` must stay scoped to `.shell`, never `body *`
- Chart bars keep **legend color** above and below zero (sign is position vs zero)
- Fund rebalance upside = Saved Report 12-month PT vs live last — never frozen report %
- Accounts rebalance **target** = **Grok** 12m PT (other engines only if Grok has none)
- Saved Reports TGT/Upside: when both Grok and Claude exist, each target has its own live upside underneath — never hide one %
- Portfolio Strategist prompt includes **both** Grok and Claude PT/upside (and per-engine mechanical EV)
- Claude Strategist/Analyst tool loops: **thinking disabled + medium effort** (Opus 5 default thinking was $4–$6/review). Do not set effort high.
- Market Wire: no Reuters or AP (no AP Google News RSS; drop AP bylines)
- Do not auto-send email; Share on reports prompts for a recipient
- SnapTrade: `SnapTradeAuth.commercial_api_key` when available
- Options wheel: held names first; term tables + KPI strip
- **Portfolio SNAPSHOT (required):** every book analysis (Portfolio Strategist), quarterly partner letter, and memo assigned to a portfolio MUST include the live attribution table — **Ticker | Position Δ YTD | Contribution | $ P&L** — with Modified Dietz YTD as a real book return (not a price-path). Same look as the IC Strategist snapshot. Do not substitute a different snapshot layout.
- **Demo sandbox (privacy):** public login `demo@dgacapital.com` / `demo123`. Three synthetic books only (Northridge SMA, Harbor Tax-Exempt, Ridgecrest Partners). Never clone or mask live LPs. Fail-closed on `DEMO%` short names. Kill switch `_DEMO_DISABLED` if isolation ever bleeds.
- **Planning worksheet is shared:** LP and GP edit the same snapshot (`lp.planning:{lp_id}`). Latest save is what both see. LP cannot see GP-hidden scratch lines.

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
| `docs/continuity/` | **Handoff kit** — README, short HANDOFF.md, PRODUCT_LOG.md |

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

*Last updated: 2026-10-08 · Agent: Grok Build · Built: `ui728-20261008-letter-mail` · Live until the next upload: `ui727-20261008-index-tape` · Next: `ui729-YYYYMMDD-slug`*
