# Weddings Option A — Launch checklist

## What’s live

| Piece | Path / URL |
|-------|------------|
| Storefront | `apps/sliw-agent/weddings-site/` |
| Preview on DGA | `https://portfolio.dgacapital.com/weddings-site/` |
| Production host | `https://weddings.edytasliwinska.com/` |
| Public API config | `GET /api/sliw/public/wedding-config` |
| Public lead form | `POST /api/sliw/public/wedding-lead` |
| Stripe webhook | `POST /api/sliw/public/stripe-webhook` |
| Edyta desk | `https://portfolio.dgacapital.com/sliw/` → **Weddings** → **Couples inbox** |
| Logins | `alecmazo1@gmail.com` + `edytasliw@gmail.com` only |

---

## Funnel (how a person reaches the page → pays)

```text
  Awareness                          Landing                         Convert
 ──────────                         ────────                        ────────
  Instagram bio / Reel CTA  ──┐
  X / Twitter link          ──┤
  edytasliwinska.com link   ──┼──►  weddings.edytasliwinska.com
  Planner referral email    ──┤         │
  Google (brand / local)    ──┘         ├── #how  (3 steps)
                                        ├── #studio (media, when added)
                                        ├── #packages
                                        ├── #proof (quotes)
                                        └── #book
                                              ├── Form → CRM stage `scored`
                                              ├── Calendly → discovery call
                                              └── Stripe Pay → CRM stage `won`
                                                    (webhook, payment_status=paid)
```

### Entry URLs (always use tagged links)

| Channel | Link |
|---------|------|
| Instagram bio / Stories | `https://weddings.edytasliwinska.com/?src=instagram` |
| Instagram Reels CTA | `https://weddings.edytasliwinska.com/?src=instagram&utm_campaign=reel_firstdance` |
| X / Twitter | `https://weddings.edytasliwinska.com/?src=x` |
| Main site button | `https://weddings.edytasliwinska.com/?src=main_site` |
| Planner email | `https://weddings.edytasliwinska.com/?src=planner&utm_campaign=partner` |
| Paid ads (later) | `...?utm_source=meta&utm_medium=paid&utm_campaign=…` |

UTMs land on the CRM prospect (`utm_source` / medium / campaign).

### Paths after landing (best → good)

1. **Fast pay (hottest):** Packages → Stripe $150 or $1,250 → green success banner → form for wedding date (same email) → Sliw **Couples inbox** shows paid lead first.
2. **Discovery first:** Calendly 15 min → form → call → send Payment Link if not already paid.
3. **Form only:** Soft leads, stage `scored` → same-day call/text from desk.

Webhook endpoint (live):  
`https://weddings.edytasliwinska.com/api/sliw/public/stripe-webhook`  
Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`  
Env: `STRIPE_WEBHOOK_SECRET=whsec_…` (Railway only — never commit).

### Live Payment Links

| Product | Amount | Link |
|---------|--------|------|
| Single lesson | $150 | `SLIW_WEDDING_STRIPE_LINK_SINGLE` |
| Package ×10 | $1,250 | `SLIW_WEDDING_STRIPE_LINK_PACKAGE10` |
| Mode | `live` | `SLIW_WEDDING_STRIPE_MODE=live` |

---

## Marketing to finish the sale (priority order)

### 1) Make the page visual (not text-heavy)

Drop assets into `apps/sliw-agent/weddings-site/media/` and edit `manifest.json`:

- **Hero** — one strong photo or 8–12s silent loop (first-dance energy).
- **3 clips** — week-1 vs week-8, studio vibe, planner-friendly shot.
- Prefer **YouTube unlisted / IG Reel embeds** (`type: "embed"`) so Railway doesn’t host huge MP4s.

Empty manifest = gallery stays hidden (no empty placeholders). Quotes stay as-is.

### 2) Social content that sells (this week)

| Asset | Purpose | CTA |
|-------|---------|-----|
| Reel: “Never danced → first dance” 15–30s | Remove fear | Link in bio → trial $150 |
| Reel: DWTS pro coaching close-up | Authority | Book discovery |
| Carousel: 3 steps (Discovery → Trial → Package) | Clarity | Site link |
| Story poll: “Wedding in 2026?” | Warm list | DM → link |
| Planner story: “I send couples to Edyta” | B2B | Partner email |

Pin one “Book your first dance” highlight on IG with the tagged URL.

### 3) Close the loop same day (ops)

Sliw daily (Alec or Edyta):

1. **Couples inbox** — new form + **paid** leads sorted first.
2. Call / text within hours: “Saw your booking — when’s the wedding?”
3. Paid but no form → still call using Stripe email/phone; mark notes.
4. After first lesson scheduled → set `lessons_scheduled=true` (or stage note) so they leave the “needs scheduling” queue.
5. Planners & venues — separate channel for B2B pipeline.

### 4) Offer ladder (copy you can paste)

- Soft: “15-min discovery — no commitment”
- Core: “$150 private trial — leave with steps”
- Hero: “$1,250 ×10 — polished first dance”
- Upsell: “Dream + day-of” (custom, form only)

Never invent testimonials, logos, or prices.

---

## Media setup (operators)

See `weddings-site/media/README.md`.

Railway env override (optional): `SLIW_WEDDING_MEDIA_JSON='{"hero":{...},"clips":[...]}'`

---

## Stripe status

- [x] Live products + prices  
- [x] Live Payment Links wired to storefront  
- [x] Webhook → CRM `won` + `payment_status=paid`  
- [x] Return URL banner `?paid=single` / `?paid=package10`  
- [ ] Optional later: Stripe Tax, receipts branding, restricted API key for advanced Checkout Sessions  

Webhook secret only needs `STRIPE_WEBHOOK_SECRET`. Payment Links do **not** require `STRIPE_SECRET_KEY` on the server.

---

## DNS (already done if site loads)

CNAME `weddings` → Railway service domain; verify TXT if requested.

---

## Edyta daily loop (Sliw)

1. Log in at portfolio.dgacapital.com (Edyta or Alec).
2. Open **Sliw** (top nav — only Alec + Edyta see it).
3. **Weddings** tab → **Couples inbox**.
4. Open each new form / paid lead → call / text → schedule lessons.
5. Then **Planners & venues** for partnership outreach.

---

## Test checklist

1. Open `https://weddings.edytasliwinska.com/` — packages + Calendly + Pay buttons live.  
2. `GET /api/sliw/public/wedding-config` — stripe mode `live`, both links non-empty.  
3. Form submit with test email → appears in Couples inbox.  
4. (Optional live $150) pay with real card → webhook logs → prospect `won` / paid badge; success banner on return. Refund in Stripe Dashboard if needed.  
5. Drop a hero image into `media/` + update manifest → redeploy → visual hero.

## Success (90 days)

20 trials · 8 ×10 packages · 3 planner partners · couples visible in Sliw Couples inbox.
