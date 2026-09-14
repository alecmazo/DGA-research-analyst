# DGA Capital — START HERE (agent briefing template)

This file is the **static** shape of the clipboard pack. Settings generates a
**live** copy (build, git SHA, next-N, date) via `GET /api/continuity/handoff`.
Prefer the live copy from Settings. Use this template only if the API is down.

You are taking over **DGA Capital** — GP research + fund-administration software
(portfolio.dgacapital.com). Do not invent a new product. Do not go backwards
on features or `WEB_BUILD_VERSION`.

Alec copied this from GP Settings (**Copy briefing for next agent**) and
pasted it here. That is his only step. **You** get the GitHub repo. Do not
ask him to open Terminal or clone anything himself.

## 1. First 90 seconds (you, the agent)

1. **Get the code yourself**
   - Repo: `https://github.com/alecmazo/DGA-research-analyst` (`main`)
   - If this workspace already is that repo: `git pull origin main`
   - Else: clone it into the workspace.
   - If GitHub is not authenticated: ask Alec to **log in to GitHub in this
     tool** (`gh auth login`, or connect the GitHub account / MCP). Then you
     clone. Do not send him to Terminal.app.
2. `curl -s https://portfolio.dgacapital.com/api/build`
3. Open **in this order** from the **repo** (GitHub is the source of truth):
   - `docs/continuity/README.md`
   - `docs/continuity/PRODUCT_LOG.md` ← every feature, categorized
   - `CONTINUITY.md` ← uiNNN log; never decrease N
   - `LLM_COORDINATION.md`
4. **Read the support fix trail** (`GET /api/support/tickets?limit=30` or
   Settings → Support tickets & fix trail). Status, diagnosis,
   `fixed_summary`, `fix_trail` — one problem at a time. Open work:
   `GET /api/support/agent-inbox`. Do not re-open a `fixed` ticket unless
   asked.
5. Then do the user’s task.

## 2. Live production

- Site: `https://portfolio.dgacapital.com/gp` (React GP)
- Probe: `GET /api/build` → `{"build":"uiNNN-YYYYMMDD-slug"}`
- Repo: `https://github.com/alecmazo/DGA-research-analyst` branch `main`
- Railway: project `upbeat-ambition`, service `web` (GP), `sliw` (Sliw), Postgres
- Next N: `max(live /api/build, CONTINUITY.md, BUILD_VERSION) + 1`

## 3. Hard rules (always)

1. Never decrease `WEB_BUILD_VERSION` in `api/server.py`. Also bump `BUILD_VERSION` and append a CONTINUITY.md row.
2. After UI edits: `npm run build` in `web/gp-app/` and **commit `dist/`**.
3. After push, poll `/api/build` until the new string is live.
4. Do **not** auto-send email. Share/report mail prompts for a recipient.
5. Sliw is Alec/Edyta only. CRM in shared Postgres.
6. Never persist Grok live-search tool dumps as `report_md`.
7. Demo login must never see live LP/GP PII (`demo@dgacapital.com` / `demo123`).
8. Do not App Store-submit iOS without explicit confirmation.
9. Do not commit `api/domains/grok_bot.py`, `ticket_*.jpg`, GrokBot/FabDock, or `mobile/logo-options/`.
10. Support tickets: `GET /api/support/agent-inbox` (or Settings). Close with PATCH + trail.

## 4. If the user says “fix ticket”

Open tickets are the job. Read `docs/support-inbox/README.md`, fetch the inbox, screenshot, fix, ship, mark `fixed`.
