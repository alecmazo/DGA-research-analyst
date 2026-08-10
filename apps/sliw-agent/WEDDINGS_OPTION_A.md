# Weddings Option A — Launch checklist

## What’s live in this repo

| Piece | Path / URL |
|-------|------------|
| Storefront | `apps/sliw-agent/weddings-site/` |
| Preview on DGA | `https://portfolio.dgacapital.com/weddings-site/` |
| Production host | `https://weddings.edytasliwinska.com/` (after DNS) |
| Public API config | `GET /api/sliw/public/wedding-config` |
| Public lead form | `POST /api/sliw/public/wedding-lead` |
| Edyta desk | `https://portfolio.dgacapital.com/sliw/` → **Weddings** → **Couples inbox** |
| Logins | `alecmazo1@gmail.com` + `edytasliw@gmail.com` only |

## 1. DNS (weddings.edytasliwinska.com)

Point the subdomain at the same Railway service as portfolio:

1. In GoDaddy (or DNS for edytasliwinska.com), create **CNAME**:
   - Name: `weddings`
   - Value: your Railway public domain  
     (often `*.up.railway.app` for the DGA web service, **or** the same target used by `portfolio.dgacapital.com` if you use a custom domain proxy)
2. In Railway → web service → **Settings → Networking → Custom domain**:
   - Add `weddings.edytasliwinska.com`
3. Wait for TLS certificate issued.
4. Open `https://weddings.edytasliwinska.com/` — should serve the storefront.
5. Form posts same-origin to `/api/sliw/public/wedding-lead`.

Until DNS is ready, use the preview path on portfolio.

## 2. Calendly

1. Create a free/pro Calendly event: **“Wedding dance discovery (15 min)”**.
2. Location: phone or Zoom; buffer 10 min.
3. Copy the **event link** (e.g. `https://calendly.com/you/wedding-discovery`).
4. Railway env:
   ```bash
   SLIW_WEDDING_CALENDLY_URL=https://calendly.com/YOUR_LINK
   ```
5. Redeploy / restart. Storefront “Schedule” button lights up.

There is no bundled Grok Calendly skill yet — use the env URL + optional embed later.

## 3. Stripe (sandbox → live)

You’re mid-setup. When ready:

### Payment Links (simplest for Option A)

1. Stripe Dashboard → **Payment Links** (test mode first).
2. Create:
   - **Private wedding lesson ×1** — $150 one-time  
   - **Wedding package ×10** — $1,250 one-time  
3. Copy each Payment Link URL.
4. Railway env (sandbox):
   ```bash
   SLIW_WEDDING_STRIPE_MODE=sandbox
   SLIW_WEDDING_STRIPE_LINK_SINGLE=https://buy.stripe.com/test_...
   SLIW_WEDDING_STRIPE_LINK_PACKAGE10=https://buy.stripe.com/test_...
   ```
5. When going live, create **live** Payment Links and set:
   ```bash
   SLIW_WEDDING_STRIPE_MODE=live
   SLIW_WEDDING_STRIPE_LINK_SINGLE=https://buy.stripe.com/...
   SLIW_WEDDING_STRIPE_LINK_PACKAGE10=https://buy.stripe.com/...
   ```

### API keys (later)

Sandbox secret keys are **not** required for Payment Links alone.  
If you later want Checkout Sessions / webhooks:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Do not commit keys to git.** Paste into Railway variables only.  
When you have sandbox keys ready, say so and we can wire Checkout + webhook → CRM stage `discovery_booked` / `won`.

## 4. Edyta daily loop (Sliw)

1. Log in at portfolio.dgacapital.com (Edyta or Alec).
2. Open **Sliw** (top nav — only Alec + Edyta see it).
3. **Weddings** tab → **Couples inbox**.
4. Open each new form lead → call / text → mark stage in Work.
5. Then **Planners & venues** for partnership outreach.

## 5. Instagram / X

IG bio / link-in-bio:

```text
https://weddings.edytasliwinska.com/?src=instagram
```

X:

```text
https://weddings.edytasliwinska.com/?src=x
```

UTMs land on the lead in Sliw (`utm_source`).

## 6. Content (non-code, this week)

- 5 Reels: “week 1 → week 8”, zero experience, 15-sec DWTS intro  
- 3 real testimonials (names optional) to replace placeholders on the site  
- One planner one-pager PDF (optional, Materials in Sliw)

## Success (90 days)

20 trials · 8 ×10 packages · 3 planner partners · couples visible in Sliw Couples inbox.
