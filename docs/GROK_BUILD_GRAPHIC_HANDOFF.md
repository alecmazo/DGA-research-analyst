# Grok Build handoff — DGA public site graphics

Date: 2026-10-07
Audience: Grok Build working in `alecmazo/DGA-research-analyst`
Owner: Alec Mazo / DGA Capital
Status: Review before any production rewrite. Do not replace live pages until this brief is implemented as real site components.

## What this is

Recent graphic work for the official DGA Capital portfolio site and the DGA research site is exploratory. It must be reintegrated as first-class pages in the existing monorepo, not left as Gamma embeds, one-off prototypes, or chat screenshots.

This file is the source of truth for that reintegration. Read it before touching public UI.

## Destinations (do not invent new properties)

| Surface | Role | Current state (checked 2026-10-07) |
|---|---|---|
| https://dgacapital.com/ | Fund site. Accredited-investor LP. Not promotional. | Long-form principles, housing Gamma embed, annual letters, contact, legal disclaimer last updated 2025-08-11. |
| https://dgacapital.com/portfolio | Public portfolio / research front door | Thin page. One Gamma embed. Copy dated April 09, 2026: institutional research across 22 positions. |
| https://dgacapital.com/restoring-the-american-dream-a-250-billion-housing-initiative | Housing / GSE special-situation page | Standalone narrative page. $250B warrant-funded housing proposal. Keep substance; restyle to the system below. |
| Gamma portfolio doc | Source content, not the destination | https://gamma.app/docs/DGA-Capital-Portfolio-l8o67e0fyttmzi7 and embed https://gamma.app/embed/DGA-Capital-Portfolio-fuyuhqibmd2tv2e |
| Research app | Internal / product research site | `apps/research` in this repo. README only as of this handoff. This is where the serious research UI should live, then be published. |
| Fund app | LP site companion | `apps/fund` |
| Brand assets | Logos only | `branding/dga_logo.png`, `branding/dga_logo_small.png`. Transparent PNG, navy headers. See `branding/README.md`. |

Repo: https://github.com/alecmazo/DGA-research-analyst (default branch `main`).
Related backend widget: https://github.com/alecmazo/dga-backend

## Work packages to reintegrate

Treat these as the graphic packages from the recent design pass. Rebuild them in code. Do not ship the prototypes as-is.

### 1. Portfolio ship

Replace the Gamma iframe on `/portfolio` with a native page.

Required structure:

- Masthead: DGA wordmark from `branding/dga_logo_small.png`, "DGA Capital Portfolio", date of coverage, one-line institutional description.
- Sector rail, in this order, matching the Gamma coverage universe: Technology, Semiconductors, Financials, Telecom, Healthcare, Energy & Materials, Consumer & Media, Real Estate & Fintech.
- Position cards: ticker, company, last price (labeled as of date; never a live quote presented as advice), sector, one-sentence thesis, link to the full research report.
- Coverage table under the cards: Ticker, Company, Price, Sector, Report.
- Methodology strip: deep fundamental analysis, disciplined valuation, catalyst identification. Pull language from the Gamma "Research Methodology" section. Do not invent a new process.
- About strip: institutional-grade equity research, discount to intrinsic value, 3–5 year horizon, fortress balance sheet / FCF bias.
- CTAs: View all research, Contact research team (`info@dgacapital.com`). No subscribe funnel. No performance claims.

Legal: every portfolio and research page keeps the accredited-investor / not-an-offer disclaimer already on dgacapital.com. References to securities are illustrative, not recommendations. Do not add track record numbers unless they already exist in an annual letter.

### 2. Housing / city prototype

The housing page is a real DGA special-situation piece (FHFA / Fannie / Freddie warrant capital, affordable supply). The city prototype and plan are visual only.

Reintegrate as a section on the existing housing URL, not a new marketing microsite.

Keep:

- Thesis: warrant value from a Fannie/Freddie restructuring as a funding source for supply.
- Figures already published on the page (7.1M shortage, income multiple, mortgage-rate context, $250B public capital, private-capital complement, builder names already used).
- "Not for promotional purposes" posture of the parent site.

Do not:

- Turn it into a civic product, a token, or a fund offering.
- Add new dollar figures that are not already on https://dgacapital.com/restoring-the-american-dream-a-250-billion-housing-initiative or in a published DGA letter.
- Use illustrative city renderings as if they were a committed development.

Visual system for this section: dark navy field, serif headlines, one diagram (capital stack: warrants to public capital to private build), one map or city-plan frame labeled "illustrative". Caption every figure with source and date.

### 3. Credit and merger-arb page styling

Backend already exists. UI does not.

- Credit engine: `credit/` (`screen.py`, `present.py`, `scenarios.py`, `universe.py`, `calc.py`). Presentation layer is `credit/present.py`. Style the public or research-app credit view to match that output, not a new schema.
- Merger-arb: style only. No new arb math in this pass. Page pattern is situation card (target, acquirer, spread, expected close, downside, thesis link) on the same grid as portfolio cards.

If a public credit or arb page is exposed, it is research commentary for accredited visitors, behind the same disclaimer. Default the first integration to `apps/research`, then link out from `/portfolio` only after review.

## Visual system (implement, do not freestyle)

- Ground: near-black navy `#0B1220`. Surface: `#121A2B`. Hairline: `#243044`.
- Text: `#F4F1EA` primary, `#A8B0BE` secondary.
- Accent: antique gold `#C4A46A` for rules, tickers, and one CTA. No second accent color.
- Type: a transitional serif for headlines (Source Serif or Newsreader), a neutral sans for UI (IBM Plex Sans or similar). Tabular figures for prices.
- Logo: existing PNGs only. Do not redraw the mark.
- Density: research terminal, not a startup landing page. No gradients, no stock photos of handshakes, no glassmorphism, no animated counters.
- Motion: none required. If any, 150ms opacity on card hover only.

## Implementation order for Grok Build

1. Read this file, `branding/README.md`, `apps/research/README.md`, `MONOREPO.md`, and `credit/present.py`.
2. Add the visual tokens in one place shared by `apps/research` and `apps/fund`. Do not fork a third design system.
3. Build the portfolio page as components: `Masthead`, `SectorRail`, `PositionCard`, `CoverageTable`, `MethodStrip`, `Disclaimer`.
4. Seed the 22-name coverage universe from the April 2026 Gamma portfolio. Mark prices `as of` the date in the source. Do not scrape live prices into the static page.
5. Restyle the housing page with the same tokens. Keep URL and copy.
6. Skin credit output from `credit/present.py`. Add merger-arb card component with placeholder situations flagged `draft`.
7. Open a PR. Do not push to the production dgacapital.com host from this brief.

## Out of scope

- Rewriting research conclusions or valuations.
- Changing the accredited-investor gating language.
- Replacing Word report generation or Gamma as an internal drafting tool. Gamma stays the draft format. The site stops depending on the embed.
- Mobile app logo copy (`mobile/assets/dga_logo_small.png`) unless the header work touches it.

## Acceptance

- `/portfolio` renders without a Gamma iframe.
- Housing page still states the published thesis and figures, in the new system.
- Credit view reads from `credit/present.py` output.
- Disclaimer block is present on every public page touched.
- Logos resolve from `branding/`.
- PR description links this file.
