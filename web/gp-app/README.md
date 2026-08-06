# DGA Capital — GP Terminal (React + TypeScript)

Modern GP shell replacing the vanilla `portfolio-gp.html` surface.

## Stack

- **Vite 8** + **React 19** + **TypeScript**
- **React Router** (`basename: /gp`)
- Design tokens: Editorial / Carta–Linear (Inter + Inter Tight)
- API: existing FastAPI (`x-auth-v2-token`)

## Dev

```bash
cd web/gp-app
npm install
npm run dev
# open http://localhost:5173/gp/  (proxies /api → portfolio.dgacapital.com)
```

## Production build

```bash
npm run build
# → web/gp-app/dist  served by FastAPI at /gp
```

## Routes

| Path | Surface |
|------|---------|
| `/gp/` | Desk (watchlist, pulse, health) |
| `/gp/options` | Options wheel scan |
| `/gp/financials` … | Shell pages (domain panels ported incrementally) |
| `/gp-legacy` | Full vanilla terminal |

## Auth

Uses the same `localStorage` keys as the legacy shell (`dga_v2_token`, `dga_v2_user`) so login on `/` continues to work.
