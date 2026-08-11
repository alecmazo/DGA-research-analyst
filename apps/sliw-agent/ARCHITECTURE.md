# Sliw architecture — keep it simple

## Product map (what belongs where)

| Surface | URL | Audience |
|---------|-----|----------|
| **Sliw desk** | https://sliw.edytasliwinska.com | Alec + Edyta only |
| **Wedding storefront** | https://weddings.edytasliwinska.com | Couples (public) |
| DGA portfolio / GP | https://portfolio.dgacapital.com | Fund / research (unrelated) |

`portfolio.dgacapital.com/sliw/` **redirects** to the Sliw desk. Use the Edyta host as the only bookmark.

## Why two Railway services today?

Hobby plan: max custom domains **per service**.  
`web` already has `portfolio.dgacapital.com` + `weddings.edytasliwinska.com`, so `sliw.edytasliwinska.com` is on service **`sliw`**.

Both share **Postgres** (`DATABASE_URL`) for CRM + storefront media so form posts and desk views stay in sync.

## Imports (planners / library)

| Action | When it runs |
|--------|----------------|
| **Import planner seeds** | Only when you click the button |
| **Import corporate library** | Only when you click Sync / Import |
| **Page load / Refresh** | Reads CRM only — does **not** re-import |

If a list looks empty after a deploy, click **Refresh list** (not Import) first.

## Storefront media workflow (straightforward)

1. Open **Sliw desk** → **Weddings**
2. Scroll to **Storefront media**
3. Paste **https** URLs:
   - Hero: photo or YouTube embed
   - Up to 3 clips (gallery)
4. Click **Save to live site**
5. Open https://weddings.edytasliwinska.com/ — no redeploy

**Where to host files**

| Source | How |
|--------|-----|
| Google Drive | File → Share → Anyone with link → copy link (or use a public CDN link) |
| Dropbox | Share → Copy link → change `?dl=0` to `?raw=1` for direct image |
| YouTube | Share → Embed → copy `src="https://www.youtube.com/embed/…"` |
| Imgur / Cloudinary | Direct `https://…jpg` link |

Empty hero + empty clips = gallery stays hidden (no placeholder junk).

## Is splitting off DGA wise? **Yes — next phase**

Sliw and DGA Capital are different businesses. Recommended path:

### Now (done / low risk) — **one database, two code trees**
- Canonical desk: **sliw.edytasliwinska.com**
- **One shared Railway Postgres** (`DATABASE_URL`) for CRM + storefront media  
  - Tables: `sliw_crm_books`, `sliw_kv`  
  - Used by **both** Railway services (`web` + `sliw`)  
  - Local `data/*.json` files are **fallback only** — never the live source of truth  
- No auto-import on load  
- Portfolio `/sliw` redirects to Edyta host  
- **Code mirror:** `apps/sliw-agent/` also lives in repo `alecmazo/sliwinska`  
  - **Live deploys still from this DGA monorepo → Railway**  
  - Marketing / Vercel deploys from Sliwinska `public/` only  
  - Sync script: `Sliwinska/scripts/sync-sliw-agent-from-dga.sh`  
  - Sync **never** copies CRM JSON into git; production data stays in Postgres  

### Later (clean separation — only when ready)
1. New Railway project under Alec/Edyta with `sliw-agent` only  
2. Domains `sliw.` + `weddings.` on that project  
3. **Migrate** Postgres (dump/restore) — do **not** spin a second empty DB while the first still has leads  
4. Point Railway deploys at Sliwinska repo; stop monorepo deploys for Sliw  
5. Auth: same email allowlist  

Until then: **keep one `DATABASE_URL`. Never dual-write to two Postgres instances.**

### Why not stay in DGA forever?
- Deploys, secrets, and risk are coupled to fund infrastructure  
- Billing and access control blur  
- Grok/agent context gets polluted with portfolio code  

### What *not* to do
- Don’t run two full desks **without** the same Postgres (that lost form leads)  
- Don’t create a second Railway Postgres “for Sliwinska” while the first still holds production CRM  
- Don’t treat local `wedding_crm.json` / `crm.json` as production  
- Don’t keep auto-import on every page load  
- Don’t host large MP4s on Railway — use URLs  

## Daily ops (Edyta)

1. https://sliw.edytasliwinska.com → login  
2. **Weddings → Couples inbox** → call/text new form leads  
3. Planners only if doing outreach (import seeds once)  
4. Media: paste URLs when you have new photos/reels  
