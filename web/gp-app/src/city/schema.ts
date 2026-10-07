import { z } from 'zod'

const band = z.object({
  side: z.enum(['up', 'down']),
  fraction: z.number(),
})

const holder = z.object({
  ticker: z.string().optional(),
  account_name: z.string(),
  account_short: z.string().optional(),
  source_type: z.string(),
  position_value: z.number().nullable(),
  weight: z.number(),
  stake_pct: z.number().nullable().optional(),
}).loose()

export const citySchema = z.object({
  schema_version: z.literal('1.0'),
  metric: z.string().optional(),
  portfolio: z.object({
    total_value: z.number().nullable(),
    currency: z.string().optional(),
    accounts: z.number().nullable().optional(),
    raw_positions: z.number().optional(),
    as_of: z.string(),
    source: z.string(),
    market_cap_missing: z.number().optional(),
  }).loose(),
  companies: z.array(z.object({
    id: z.string(),
    ticker: z.string(),
    name: z.string(),
    sector: z.string(),
    archetype: z.string(),
    archetype_override: z.boolean().optional(),
    industry_note: z.string().nullable().optional(),
    position_value: z.number().nullable(),
    weight: z.number(),
    total_assets: z.number().nullable().optional(),
    total_assets_as_of: z.string().nullable().optional(),
    market_cap: z.number().nullable().optional(),
    market_cap_as_of: z.string().nullable().optional(),
    book_equity: z.number().nullable().optional(),
    book_equity_as_of: z.string().nullable().optional(),
    equity_to_market_cap: z.number().nullable().optional(),
    equity_band: band.nullable().optional(),
    daily_change_pct: z.number().nullable().optional(),
    volatility_1y: z.number().nullable().optional(),
    colors: z.object({
      base: z.string(),
      primary: z.string(),
      accent: z.string(),
    }),
    size: z.object({
      height_by_market_cap: z.number().nullable(),
      height_by_position_value: z.number().nullable(),
      height_by_total_assets: z.number().nullable(),
      footprint: z.number(),
      footprint_by_market_cap: z.number().nullable().optional(),
      footprint_by_position_value: z.number().nullable().optional(),
      footprint_by_total_assets: z.number().nullable().optional(),
    }).loose(),
    position: z.object({
      x: z.number(),
      z: z.number(),
    }).loose(),
    holders: z.array(holder).optional(),
    bands: z.array(z.object({
      account_name: z.string(),
      source_type: z.string(),
      share: z.number(),
    })).optional(),
    animation: z.object({
      flicker: z.number().optional(),
      sway: z.number().optional(),
    }).optional(),
    ship_dot: z.string().optional(),
  }).loose()),
}).loose()

export type CityPayload = z.infer<typeof citySchema>
export type CityCompany = CityPayload['companies'][number]
