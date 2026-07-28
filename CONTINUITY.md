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
| **Next deploy after this handoff** | **`ui378-20260728-nav-continuity`** | Nav reorg + continuity file; jumps past both streams |

If Mac mini later ships `ui379+` while offline, **pull main first**, then set
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

*Last updated: 2026-07-28 · Agent: Grok Build (laptop session) · Next: ui378*
