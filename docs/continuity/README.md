# Continuity kit — DGA Capital GP desk

This folder is the **source of truth for a human or model taking over the
product**. Settings → Continuity handoff copies a **short briefing**. That
briefing tells the next agent to open the files here. Do not skip them.

| File | What it is | When to open |
|------|------------|--------------|
| **This README** | How the two-layer handoff works | First |
| **`PRODUCT_LOG.md`** | Every product surface, categorized | Before any feature work |
| **`../../CONTINUITY.md`** | `uiNNN` version log + bump rules | Before any deploy |
| **`../../LLM_COORDINATION.md`** | Multi-agent claims / do-not-stomp | Before overlapping edits |
| **`../../ACCESS_CONTROL_POLICY.md`** | GP / LP / demo isolation | Before auth or demo work |
| **`../../docs/support-inbox/README.md`** | How to fix GP/LP support tickets | When the user says “fix ticket” |

## Two layers (do not collapse them)

1. **Briefing (clipboard).** Settings → **Copy briefing for next agent**.
   Short. Live build, next-N, standing rules, “open these files.” Fits in a
   new chat without eating the context window.
2. **Product log (this folder + CONTINUITY.md).** Long. Feature encyclopedia
   and the uiNNN sequence. The next model **must open these from the repo**
   after `git pull`. Do not try to paste the whole log into every chat.

## Switching computers or models

```text
1. git pull origin main
2. curl -s https://portfolio.dgacapital.com/api/build
3. Open docs/continuity/PRODUCT_LOG.md
4. Open CONTINUITY.md (append a row if you ship)
5. Paste the Settings briefing into the new agent as the first user message
   (or skip paste if the agent already has this repo).
6. Do the task. Never decrease WEB_BUILD_VERSION.
```

Live site: `https://portfolio.dgacapital.com/gp`  
Repo: `https://github.com/alecmazo/DGA-research-analyst` (`main`)  
Railway: project `upbeat-ambition`, service `web` (auto-deploys on push).
