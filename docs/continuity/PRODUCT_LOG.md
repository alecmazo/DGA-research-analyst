# DGA Capital — product log (feature encyclopedia)

**Audience:** the next human or model on a new computer.  
**Purpose:** do not drop features, versions, or constraints.  
**Companion:** `CONTINUITY.md` is the **uiNNN version log**. This file is **what the product is**.

**New session:** Alec copies Settings → **Copy briefing for next agent** and
pastes it here. **You** clone or pull `https://github.com/alecmazo/DGA-research-analyst`
(`main`). If GitHub is locked, ask him to log in in this tool — then you
continue. Do not send him to Terminal to clone.

Live probe: `GET https://portfolio.dgacapital.com/api/build`  
GP UI: `https://portfolio.dgacapital.com/gp`  
Repo: `https://github.com/alecmazo/DGA-research-analyst` (`main`)  
Railway: project `upbeat-ambition` · service `web` (GP+API) · service `sliw` · Postgres

If this file and `/api/build` disagree, **live `/api/build` wins** for the current N; then pull `main`.

---

## 0. What this software is

DGA Capital is a **single-GP family office / 3(c)(1) fund desk**:

- Research terminal (watchlist, filings, Analyze, Saved Reports, valuation)
- Fund administration (managed SMAs/IRAs, LP funds, planning, SnapTrade)
- LP portal + native iOS app
- Support-ticket inbox so Alec can file a bug and a coding agent can close it

Canonical GP is **React + TypeScript** at `web/gp-app/` served at `/gp`.  
Legacy HTML at `/gp-legacy` (`web/gp/`) is **not** the source of truth.

---

## 1. Versioning (do not go backwards)

| Item | Rule |
|------|------|
| Source of truth | `WEB_BUILD_VERSION` in `api/server.py` |
| Also bump | `BUILD_VERSION` (one-line file) **and** a row in `CONTINUITY.md` |
| Format | `ui{N}-{YYYYMMDD}-{short-slug}` |
| N | **Never decrease.** Next = `max(live /api/build, CONTINUITY.md, BUILD_VERSION, git) + 1` |
| UI deploys | `cd web/gp-app && npm run build` then **commit `dist/`** (Nixpacks has no Node) |
| After push | Poll `/api/build` until the new string is live. Do not claim shipped until then. |

Clients poll `/api/build` and hard-reload stale PWAs.

---

## 2. Standing constraints (never regress)

Copy these into every new agent session:

- **No auto-send email.** Share / quarterly letter / memo mail **prompts** for a recipient.
- **Sliw:** Alec and Edyta only. CRM in shared Postgres. Do not resurrect Contacted history unless asked.
- **Demo sandbox:** `demo@dgacapital.com` / `demo123`. Three synthetic books (`DEMO%` short names). Never clone live LPs. Kill switch `_DEMO_DISABLED`.
- **Grok Analyze:** never persist `web_search` tool dumps as `report_md`.
- **Financials `@media print`:** scoped to `.shell`, never `body *` (that blanked Saved Report print).
- **Watchlist day-%:** session prior close, not Yahoo `previousClose`.
- **Watchlist load:** independent of Daily Pulse.
- **Watchlist YTD:** calendar Jan 1; this-year IPOs = % since first print + IPO tag.
- **Accounts rebalance target:** Grok 12m PT vs **live last** (not frozen report %).
- **Saved Reports TGT:** when Grok and Claude both exist, each target has its own live upside.
- **Portfolio Strategist:** receives **both** Grok and Claude PT/upside.
- **Claude Analyst/Strategist:** thinking **off**, medium effort (Opus 5 thinking was $4–$6/run).
- **IC snapshot table required** on Strategist, quarterly letters, memos: Ticker | Δ YTD | Contribution | $ P&L (Modified Dietz).
- **Cash / money-markets:** always $1 par. Never Yahoo-price CASH.
- **Support:** GP sees the inbox; LPs can **file** only. Desk ticket **dot** is GP-only.
- **iOS:** do not App Store-submit without explicit confirmation. TestFlight is OK when asked.
- **Do not commit:** `api/domains/grok_bot.py`, `ticket_*.jpg`, `GrokBot.tsx` / `FabDock.tsx`, `mobile/logo-options/`.

---

## 3. People, roles, auth

| Role | Who | Sees |
|------|-----|------|
| `gp` / `admin` | Alec (`gp_alec`) | Full terminal `/gp` |
| `lp` | Anatoly, Eugene, Edyta (and others in `auth_v2`) | LP portal + mobile LP tabs only |
| `demo` | Public prospect login | Synthetic books only |

- Login: `POST /api/auth/v2/login` · header `x-auth-v2-token`
- Gateway: `web/portfolio.html` (`/`)
- GP change-password: Settings → Security
- MFA endpoints exist under `/api/auth/v2/mfa/*`
- Fail-closed if `TOKEN_SECRET` is missing or the public default

---

## 4. Surfaces map (code)

| Surface | Path | URL |
|---------|------|-----|
| GP React (canonical) | `web/gp-app/` | `/gp` |
| GP routes | `web/gp-app/src/App.tsx` | see §5 |
| Legacy GP HTML | `web/gp/` | `/gp-legacy` |
| Login | `web/portfolio.html` | `/` |
| LP portal | `web/portfolio-lp.html` | `/lp` |
| API | `api/server.py` + `api/domains/` | `/api/*` |
| Analyze pipeline | `DGA_analyst.py` | jobs under `/api/research/*` |
| Excel models | `excel_model.py` | Saved Report Excel + valuation pack |
| Quotes / earnings | `market_data.py` | watchlist, pulse, 8-K actuals |
| SnapTrade | `snaptrade_link.py` | holdings, tax lots, YTD |
| Auth | `auth_v2.py` | users, tokens, demo |
| Mobile | `mobile/` (Expo SDK 54) | TestFlight **DGA Capital** |
| Fund schema docs | `apps/fund/docs/` | waterfall, 3(c)(1), double-entry |
| Sliw | `apps/sliw-agent/` | `sliw.edytasliwinska.com` |
| Support | `api/domains/support_tickets.py` | inbox + Desk light |

---

## 5. GP terminal — every tab

Nav (do not reshuffle casually):

**Work (left):** Desk · Financials · Builder · Podcasts · Transcripts · Positions · Options  
**Firm (right):** Accounts · Memos · Settings · Sliw

Chrome-less windows: `/gp/report`, `/gp/research`, `/gp/valuation`.

### 5.1 Desk (`/` · `DeskPage.tsx`)

Free-form board (`DeskBoard`) with reset / collapse / expand. **Ticket status dot** sits after Reset layout (green = 0 open tickets, red = ≥1, hover = count). Polls `GET /api/support/open-count`.

| Card | What it does |
|------|----------------|
| Watchlist | Tickers, last, day %, YTD, earnings chips, report pill. Click row → StockPeek. Earnings chip → `EarningsCard`. |
| Daily Pulse | LLM brief of the book; live prices injected; YOUR BOOK format. |
| Saved Reports | Grok/Claude cards, style pills (VALUE/GROWTH/GARP/RICH/CORE), TGT/upside, clickable valuation chips. |
| Analyst | Agentic research; answer opens `/gp/research`. |
| Portfolio Strategist | Whole-book review + IC snapshot; EV; both engines’ PTs. |
| Live Markets | TradingView. |
| Market Wire | Official + wire RSS (**no Reuters, no AP**). |
| Market Pulse | Per-name headline + **three** chips: DCF, Comps, Street. DCF/Street → valuation bridge. Comps → last-FY peer window. |
| Top Movers | $1B+ names by \|day %\|. |
| Analyze Ticker | Multi-engine Analyze (Grok / Claude / DeepSeek / Kimi). Overlay while running. |
| Desk health | Quote / report / pulse counts. |

Support FAB files tickets with screenshot. Do not resurrect GrokBot/FabDock (untracked).

### 5.2 Financials (`/financials`)

Company dashboard (DGA Score, ranks, snapshots), Value Line sheet, SEC store, series tables, fund charts, history screen. Analyze uses `company_financials` as primary (SEC 10-K/10-Q Excel, 10-Q merge). Nightly/monthly refresh. Print CSS **must stay `.shell`-scoped**.

DGA Score: negative book equity is **not** a free 100 on ROE; no-debt is fortress on Financial Strength.

### 5.3 Builder (`/builder`)

Sector / GuruFocus boards. Date first added, cost, split-adjusted since-add %, notes/FV. Hover snapshot. New-tab financials. Watchlist dropdown, compact rows, add/delete lists. Board switch must stay fast (cache + `_batch_quotes_fast`, no force DCF).

### 5.4 Podcasts (`/podcasts`)

Lab: generate / play / upload roundups. Internal tab id remains `lab`.

### 5.5 Transcripts (`/transcripts`)

Earnings-call / transcript tools.

### 5.6 Positions (`/positions`)

Live lots across managed accounts + LP stakes (`GET /api/v2/lp/me/positions`). Demo-lane SQL must **not** use `LIKE 'DEMO%'` inside parameterized queries (that 500’d Eugene’s mobile Portfolio).

### 5.7 Options (`/options`)

Covered-call / cash-secured-put wheel. **Held = live Positions book**, not watchlist/demo lots. Rank: uncovered held → covered held → not held, then GS/MS risk/reward.

### 5.8 Accounts (`/fund`)

Managed SMAs/IRAs first, LP funds second, Planning third.

**Account detail (ui604):**

- Back to Accounts **plus** a pulldown of every managed book and LP fund
- **Download** pulldown (Excel / PDF). No Word — there is no fund Word export
- Monthly Performance YTD: Chart/Table + Monthly/Quarterly/Annual pulldowns (YTD grain rolls months)
- All-Time: Chart/Table + Monthly/Quarterly/Annual; Period and Return are pulldowns too
- SnapTrade is the live path; Manual Data Uploads stay hidden
- Rebalance Run is gold; upside = Grok 12m PT vs live last
- Planning: shared GP/LP snapshot; Tax info YTD from SnapTrade activity

### 5.9 Memos (`/memos`)

IC memos / PDF. Snapshot table required when assigned to a book.

### 5.10 Settings (`/settings`)

Handoff · Support tickets & trail · Models/routing/schedule · Connections (SnapTrade, Dropbox, …) · Publishing · Security · Users & Funds · System.

### 5.11 Sliw

Gated. Wedding / corporate desk. Alec/Edyta only.

### 5.12 Saved Report window (`/report`)

Print + Excel (Dropbox `/Apps/DGA Research/Excel/`, replace in place) + email prompt. Cover DCF Target on Rating row. Engine aliases on print (Grok→Rock, Claude→Laudia).

### 5.13 Research answer (`/research`)

Analyst / Strategist output window + PDF (masthead, Inter, content-sized tables).

### 5.14 Valuation bridge (`/valuation?ticker=`)

Opened from GARP/VALUE/GROWTH/RICH/CORE pills and Market Pulse chips.

- Approaches table is **not blended** except 12m PT
- Gordon / model DCF vs **DCF User** (FCF × yellow multiple − net debt ÷ **SEC diluted shares**)
- Report leftover share counts (BSX 7.1m) must yield to SEC (~1.48bn). `normalize_shares_millions`
- Insane stored DCF User $/share (60× last) must not overlay Market Pulse
- Market Pulse chips are **only** DCF / Comps / Street (not DCF base, EV/EBITDA Comps, P/E Comps, FY26E, street-anchored, 12m PT)
- Support FAB on the window. Download pulldown: **Print PDF** (`window.print`), **Excel** (`/valuation.xlsx`), **Email** (prompt for recipient — never auto-send)
- Stats line under the ticker: last, day %, market cap, P/E, EV/EBITDA, FCF yield, 52w

### 5.15 Comps window (`/comps?ticker=`)

Opened from the Market Pulse **Comps** chip.

- `GET /api/financials/{ticker}/comps` → `research_comps.load()` (company_financials last FY + live last)
- Columns: EV/EBITDA, P/E, P/S, FCF yield, rev growth, EBITDA margin
- Missing cells render **n/a** — never NTM / (E)
- Same Support FAB + Download pulldown (Excel = `/comps.xlsx`) + ticker stats line as the valuation window

---

## 6. LP portal & mobile

### LP web (`/lp`)

Performance by fund/SMA, documents / planning (shared worksheet), quarterly letter. Support FAB files tickets; LPs cannot list them.

### Native iOS (`mobile/`)

- Expo app **DGA Capital**, bundle `com.dgacapital.research`, ASC 6764731342
- Icon: glass Option A; splash navy `#0A1628`
- Production EAS profile (store). `preview` is simulator-only
- GP tabs: Markets, Research, Financials, Positions, Fund, More
- LP tabs: Positions, Performance, Documents, Podcast, Settings
- OTA via `updates.url` / runtimeVersion appVersion
- Last TestFlight path: EAS production iOS 1.0.0 (build numbers autoIncrement). Do not App Store review unless asked

---

## 7. Research / Analyze pipeline

Engines: **Grok**, **Claude (Opus 5 default, thinking off for reports)**, **DeepSeek V4 Pro**, **Kimi**.

- Primary financials: `company_financials` store + live SEC Excel
- Thesis continuity from prior Analyze versions (`analyst_report_versions`)
- Compare panes on Desk
- Jobs: heartbeats, poll recovery, never fake-timeout a live run
- Style classification: VALUE / GROWTH / GARP / RICH / CORE (`excel_model.style_from_metrics`)
  - `VALUE_CUT=0.05` (DCF/last − 1), `GROWTH_CUT=0.15` fwd rev/EPS
  - cheap+growth=GARP, cheap=VALUE, growth=GROWTH, rich=RICH, else CORE

---

## 8. Data, quotes, SnapTrade

| Feed | Notes |
|------|--------|
| Quotes | Fast path: cache/store; skip yfinance on Railway when it 401s |
| Earnings | Nasdaq surprise + Yahoo calendar; **8-K ex99** for actual revenue (company total, not Services line). Reject actuals 5× off Street |
| Market Pulse | Public RSS per ticker |
| Top Movers | Yahoo screeners, $1B+ |
| SnapTrade | Live holdings → tax_lots. Residual CASH lot. Tax YTD for Planning. Morning sync |
| Dropbox | Reports + Excel models; replace `{TICKER}_DGA_Model.xlsx` |
| Postgres | Users, funds, tax lots, reports, tickets, planning, SnapTrade cache |

---

## 9. Support tickets

| Action | How |
|--------|-----|
| File | Support FAB (GP or LP) — screenshot + description |
| GP light | Desk green/red dot · `GET /api/support/open-count` |
| Inbox | Settings → Support, or `GET /api/support/agent-inbox` |
| Screenshot | `GET /api/support/tickets/{id}/screenshot` |
| Close | `POST /api/support/tickets/{id}/update` `{status:"fixed", fixed_summary}` |
| Open statuses | `open`, `diagnosing`, `diagnosed`, `in_progress` |

Demo GP never sees live tickets.

---

## 10. Deploy & ops

1. Pull `main`.
2. Implement. Tests under `tests/`.
3. If UI: `npm run build` in `web/gp-app/`, commit hashed `dist/assets` + `index.html` (not `.map`).
4. Bump `WEB_BUILD_VERSION`, `BUILD_VERSION`, CONTINUITY.md row.
5. `git push origin main` → Railway `web`.
6. Poll `/api/build` and health `/health`.
7. If ticket: mark fixed + trail.

Sliw deploys separately (`watchPatterns` on `apps/sliw-agent/**`).

---

## 11. Common traps (already paid for)

| Symptom | Cause / fix |
|---------|-------------|
| LP mobile Portfolio 500 | `LIKE 'DEMO%'` inside psycopg2 `%s` query → `LEFT(short_name,4)` |
| Earnings $1.40B vs $21B Street | 8-K parser grabbed Services revenue; rank **total** |
| DCF User $2,577 on BSX | 7.1m leftover shares; use SEC ~1.48bn |
| Watchlist hung | `with ThreadPoolExecutor` after timeout; Daily Pulse blocking list |
| Report print blank | Financials `body *` print CSS |
| Excel “file format” warning | Download URL must end in `.xlsx` |
| Grok “report” is junk | Live-search tool dump persisted as markdown |
| Board switch slow | Don’t force DCF/Yahoo on every click |
| Wheel HELD on names we don’t own | Held must be Positions book, not watchlist |

---

## 12. “Fix ticket” runbook

1. `GET /api/support/agent-inbox` (or query `support_tickets` where status in open set).
2. Download screenshot.
3. Reproduce on the `page_path` / `active_tab`.
4. Minimal fix. Bump uiN. Push. Confirm `/api/build`.
5. Close ticket. Inbox empty → Desk dot green.

---

*Keep this file honest. When you ship a new surface, add a subsection here **and** a CONTINUITY.md row. Last expanded: 2026-09-14 · ui604 era.*
