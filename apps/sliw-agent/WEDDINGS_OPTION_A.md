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

## 1. DNS (weddings.edytasliwinska.com) — EXACT RECORDS

**Railway side is already done** (custom domain added to `web` service, port 8080).

You only need to add DNS at the registrar that owns **edytasliwinska.com** (almost certainly **GoDaddy**, same place the site is hosted).

### Record A (required) — route traffic

| Field | Value |
|--------|--------|
| Type | **CNAME** |
| Name / Host | **`weddings`** |
| Value / Points to | **`61cyun23.up.railway.app`** |
| TTL | 600 or 1 hour |

### Record B (required for SSL) — ownership verify

| Field | Value |
|--------|--------|
| Type | **TXT** (or CNAME if GoDaddy only shows that for `_railway-verify`) |
| Name / Host | **`_railway-verify.weddings`** |
| Value | **`railway-verify=fbf73b839bdc2a65b6709b53d365c552d13cf54f861c5a20e7ffb6daebb83c44`** |
| TTL | 600 |

> If GoDaddy’s “Name” field already appends `.edytasliwinska.com`, enter **only** `weddings` and `_railway-verify.weddings` — do **not** type the full domain twice.

### After you save

1. Wait 5–30 minutes (sometimes up to a few hours).
2. Check: `https://weddings.edytasliwinska.com/`
3. Form posts same-origin to `/api/sliw/public/wedding-lead`.

### Until DNS works

Preview: `https://portfolio.dgacapital.com/weddings-site/`

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
