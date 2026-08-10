# Sliw desk on sliw.edytasliwinska.com

Sliw Agent is a **separate product surface** from DGA Capital Portfolio.

| Surface | URL |
|---------|-----|
| DGA Portfolio / GP / LP | `https://portfolio.dgacapital.com` |
| Wedding storefront | `https://weddings.edytasliwinska.com` |
| **Sliw desk** | `https://sliw.edytasliwinska.com` |
| Sliw (legacy path on portfolio) | `https://portfolio.dgacapital.com/sliw/` |

## Railway (already done)

- New service **`sliw`** in project `upbeat-ambition` (same monorepo as `web`)
- Custom domain `sliw.edytasliwinska.com` → port **8080**
- Env vars copied for auth + Sliw APIs
- Host middleware: desk at `/`, login at `/login`

## GoDaddy — DNS for edytasliwinska.com

Add these two records (same pattern as `weddings`):

### Record A — traffic (required)

| Field | Value |
|--------|--------|
| Type | **CNAME** |
| Name / Host | **`sliw`** |
| Value / Points to | **`2715rg6r.up.railway.app`** |
| TTL | 600 or 1 hour |

### Record B — SSL ownership verify (required)

| Field | Value |
|--------|--------|
| Type | **TXT** (or CNAME if GoDaddy only offers that for `_railway-verify`) |
| Name / Host | **`_railway-verify.sliw`** |
| Value | **`railway-verify=0007cb8bf9a7f9ca522bac37546974b8b36d68707db528c94b93bb7a0d4f6711`** |
| TTL | 600 |

> If GoDaddy’s Name field already appends `.edytasliwinska.com`, enter **only** `sliw` and `_railway-verify.sliw` — do not type the full domain twice.

### After save

1. Wait 5–30 minutes (sometimes longer for TLS).
2. Open `https://sliw.edytasliwinska.com/` → login at `/login` → desk.
3. Alec + Edyta only (`alecmazo1@gmail.com`, `edytasliw@gmail.com`).

Check Railway domain status:

```bash
railway domain status sliw.edytasliwinska.com --service sliw --json
```

`verified: true` + certificate ready = good.

## Login flow

1. Visit `https://sliw.edytasliwinska.com/`
2. No token → redirect to `/login?next=/`
3. Same email/password as portfolio (DGA v2)
4. Land on Sliw desk at `/`

Portfolio path still works: `https://portfolio.dgacapital.com/sliw/`

## Why a second Railway service?

Hobby plan limits **custom domains per service**. `web` already has:

- `portfolio.dgacapital.com`
- `weddings.edytasliwinska.com`

So `sliw.edytasliwinska.com` lives on service **`sliw`**.
