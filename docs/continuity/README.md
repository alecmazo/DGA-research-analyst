# Continuity kit — DGA Capital GP desk

This folder is the **source of truth for a human or model taking over the
product**. Alec’s only move is Settings → **Copy briefing for next agent** →
paste into the new chat. The **new agent** clones or pulls GitHub and then
opens the files here. Do not skip them. Do not send Alec to Terminal.

| File | What it is | When to open |
|------|------------|--------------|
| **This README** | How the two-layer handoff works | First |
| **`PRODUCT_LOG.md`** | Every product surface, categorized | Before any feature work |
| **`../../CONTINUITY.md`** | `uiNNN` version log + bump rules | Before any deploy |
| **`../../LLM_COORDINATION.md`** | Multi-agent claims / do-not-stomp | Before overlapping edits |
| **`../../ACCESS_CONTROL_POLICY.md`** | GP / LP / demo isolation | Before auth or demo work |
| **`../../docs/support-inbox/README.md`** | How to fix GP/LP support tickets | Always: read the live fix trail |

## Two layers (do not collapse them)

1. **Briefing (clipboard).** Settings → **Copy briefing for next agent**.
   Short. Live build, next-N, standing rules, “you clone GitHub.” Fits in a
   new chat without eating the context window.
2. **Product log (this folder + CONTINUITY.md).** Long. Feature encyclopedia
   and the uiNNN sequence. The next model **must open these from the repo**
   after **it** clones or pulls. Do not paste the whole log into every chat.

## Switching computers or models

Alec does **not** clone, pull, or open Terminal.

```text
1. Settings → Copy briefing for next agent
2. Paste that clipboard into the new Grok / Claude / Cursor chat
3. Stop. The new agent clones or pulls
   https://github.com/alecmazo/DGA-research-analyst (main).
   If GitHub is locked, it asks Alec to log in — then it continues.
4. That agent curls /api/build, opens PRODUCT_LOG.md + CONTINUITY.md,
   and reads GET /api/support/tickets (the fix trail). Then it does the task.
```

**Download package** (Settings) is a dated zip of briefing + product log +
version log for **records**, or a file copy of the briefing if clipboard is
unavailable. It is not how a new agent catches up — GitHub has the live docs.

Live site: `https://portfolio.dgacapital.com/gp`  
Repo: `https://github.com/alecmazo/DGA-research-analyst` (`main`)  
Railway: project `upbeat-ambition`, service `web` (auto-deploys on push).
