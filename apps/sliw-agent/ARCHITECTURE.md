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

### Now (done / low risk)
- Canonical desk: **sliw.edytasliwinska.com**
- Shared Postgres for CRM + media
- No auto-import on load
- Portfolio `/sliw` redirects to Edyta host

### Next (clean separation)
1. **New Railway project** under Alec/Edyta (not DGA monorepo): `sliw-agent` only  
2. Move `apps/sliw-agent` + thin API shell  
3. Domains on that project only: `sliw.` + `weddings.`  
4. Own Postgres volume; stop sharing DGA `DATABASE_URL`  
5. Auth: keep same email allowlist or dedicated login  

### Why not stay in DGA forever?
- Deploys, secrets, and risk are coupled to fund infrastructure  
- Billing and access control blur  
- Grok/agent context gets polluted with portfolio code  

### What *not* to do
- Don’t run two full desks without shared storage (that lost form leads)  
- Don’t keep auto-import on every page load  
- Don’t host large MP4s on Railway — use URLs  

## Daily ops (Edyta)

1. https://sliw.edytasliwinska.com → login  
2. **Weddings → Couples inbox** → call/text new form leads  
3. Planners only if doing outreach (import seeds once)  
4. Media: paste URLs when you have new photos/reels  
