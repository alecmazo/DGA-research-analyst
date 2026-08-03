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
| **Next deploy after this** | **`ui416-YYYYMMDD-slug`** | Always `max(live, this file, BUILD_VERSION) + 1` |

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
3. Options (`options`)
4. Builder (`builder`)
5. Podcasts (`lab`) — *label only; internal tab id stays `lab`*
6. Transcripts (`transcripts`)
7. Positions (`positions`)

**Firm ops** (right of divider):

8. Fund (`fund`)
9. Memos (`memos`)
10. Settings (`settings`)
11. Sliw (`/sliw/` link, gated)

Ideas tab still exists as `tab-ideas` for deep links / Desk actions; not in topbar.

---

## Open product state (handoff notes)

### Recently shipped (this session stream)

| Build | Topic |
|-------|--------|
| ui107–ui108 | Day-% prior close; Nasdaq gap-fill; watchlist parallel quotes |
| ui109–ui110 | Koyfin-style Options + Desk market bar / Analyst command surface |
| ui111 | Market Pulse stale-72d ghosts; pulse WL filter |
| ui112–ui113 | Compact watchlist rows; fully expand no inner scroll |
| ui114 | SnapTrade partner auth for SDK v12 (`commercial_api_key`) |

### Known systems

- **Push worktree for main:** often `/tmp/cra-push` (clone of `alecmazo/claude-research-analyst`)
- **User worktree:** `~/.grok/worktrees/.../dga-capital-portal` may lag `main`
- **Railway:** auto-deploy from `main`; probe with `/api/build`
- **GP login (dev):** email/password via `/api/auth/v2/login` (token header `x-auth-v2-token`)
- **Support tickets:** `/api/support/tickets` + agent inbox; mark fixed with PATCH + trail

### Do not regress

- Watchlist day-% = session prior close (not Yahoo meta `previousClose`)
- Watchlist: two-line rows, expanded, no inner scroll, no stale chip
- SnapTrade: use `SnapTradeAuth.commercial_api_key` when available
- Options wheel: term tables + KPI strip (ui109+)

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
| `api/server.py` | `WEB_BUILD_VERSION`, most APIs |
| `web/portfolio-gp.html` | GP shell + topbar |
| `web/gp/js/gp-main.js` | SPA logic |
| `web/gp/css/gp-design-v2.css` | Design system |
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

*Last updated: 2026-07-28 · Agent: Grok Build (laptop session) · Live: ui380 · ship through ui383 · Next: ui384*
